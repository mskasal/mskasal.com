//! Live annotation rooms: `GET /ws/room/:id` relays each client's messages to
//! the other members of the same room and tells everyone who is there.
//! Nothing is stored; the notes themselves live in every member's URL.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    extract::{
        ws::{CloseFrame, Message, WebSocket},
        Path, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::{sync::broadcast, time::timeout};
use uuid::Uuid;

pub const MAX_MEMBERS: usize = 16;
pub const MAX_ROOMS: usize = 1000;
pub const MAX_MSGS_PER_SEC: u32 = 30;
pub const MAX_FRAME: usize = 64 * 1024;
pub const PING_EVERY: Duration = Duration::from_secs(30);
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(60);
/// A member whose socket takes longer than this to accept a message has
/// stopped reading and is disconnected.
pub const SEND_TIMEOUT: Duration = Duration::from_secs(5);
const PEER_COLOURS: usize = 8;
const MAX_NAME: usize = 40;
const CLOSE_TRY_AGAIN: u16 = 1013;
const MESSAGE_TYPES: [&str; 4] = ["hello", "state", "upsert", "remove"];

/// A message on a room's channel; `from` is the sending connection, or nil for the server.
#[derive(Clone, Debug)]
pub struct Relay {
    pub from: Uuid,
    pub text: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum JoinError {
    Full,
    TooManyRooms,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct PeerInfo {
    pub peer: String,
    pub name: Option<String>,
    pub colour: usize,
}

struct Member {
    conn: Uuid,
    peer: String,
    name: Option<String>,
    colour: usize,
}

struct Room {
    tx: broadcast::Sender<Relay>,
    members: Vec<Member>,
}

#[derive(Clone, Default)]
pub struct Rooms(Arc<Mutex<HashMap<Uuid, Room>>>);

impl Rooms {
    /// Adds a connection to a room, creating the room if needed; returns its
    /// channel and the member's colour.
    pub fn join(
        &self,
        id: Uuid,
        conn: Uuid,
    ) -> Result<(broadcast::Sender<Relay>, usize), JoinError> {
        let mut rooms = self.0.lock().unwrap();
        if !rooms.contains_key(&id) && rooms.len() >= MAX_ROOMS {
            return Err(JoinError::TooManyRooms);
        }
        let room = rooms.entry(id).or_insert_with(|| Room {
            tx: broadcast::channel(256).0,
            members: Vec::new(),
        });
        if room.members.len() >= MAX_MEMBERS {
            return Err(JoinError::Full);
        }
        let colour = (0..PEER_COLOURS)
            .find(|c| room.members.iter().all(|m| m.colour != *c))
            .unwrap_or(room.members.len() % PEER_COLOURS);
        room.members.push(Member {
            conn,
            peer: conn.to_string(),
            name: None,
            colour,
        });
        Ok((room.tx.clone(), colour))
    }

    /// Removes a connection; an empty room is dropped.
    pub fn leave(&self, id: Uuid, conn: Uuid) {
        let mut rooms = self.0.lock().unwrap();
        if let Some(room) = rooms.get_mut(&id) {
            room.members.retain(|m| m.conn != conn);
            if room.members.is_empty() {
                rooms.remove(&id);
            }
        }
    }

    /// Records the peer id and name a connection introduced itself with;
    /// returns whether either changed.
    fn hello(&self, id: Uuid, conn: Uuid, peer: Uuid, name: Option<&str>) -> bool {
        let mut rooms = self.0.lock().unwrap();
        let Some(member) = rooms
            .get_mut(&id)
            .and_then(|room| room.members.iter_mut().find(|m| m.conn == conn))
        else {
            return false;
        };
        let peer = peer.to_string();
        let name: Option<String> = name.map(|n| n.chars().take(MAX_NAME).collect());
        let changed = member.peer != peer || member.name != name;
        member.peer = peer;
        member.name = name;
        changed
    }

    pub fn presence(&self, id: Uuid) -> Vec<PeerInfo> {
        let rooms = self.0.lock().unwrap();
        rooms
            .get(&id)
            .map(|room| {
                room.members
                    .iter()
                    .map(|m| PeerInfo {
                        peer: m.peer.clone(),
                        name: m.name.clone(),
                        colour: m.colour,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn room_count(&self) -> usize {
        self.0.lock().unwrap().len()
    }

    fn announce(&self, id: Uuid, tx: &broadcast::Sender<Relay>) {
        let text = json!({"type": "presence", "peers": self.presence(id)}).to_string();
        // No receivers left is fine: the room is empty.
        let _ = tx.send(Relay {
            from: Uuid::nil(),
            text,
        });
    }
}

pub async fn room_ws(
    Path(id): Path<String>,
    State(rooms): State<Rooms>,
    ws: WebSocketUpgrade,
) -> Response {
    let Ok(id) = Uuid::parse_str(&id) else {
        return (StatusCode::BAD_REQUEST, "room id must be a UUID").into_response();
    };
    ws.max_message_size(MAX_FRAME)
        .max_frame_size(MAX_FRAME)
        .on_upgrade(move |socket| serve(socket, id, rooms))
}

/// A client message worth relaying: a JSON object with a known `type`.
fn validate(text: &str) -> Option<Value> {
    let value: Value = serde_json::from_str(text).ok()?;
    let kind = value.get("type")?.as_str()?;
    MESSAGE_TYPES.contains(&kind).then_some(value)
}

/// Counts messages per one-second window.
struct RateLimit {
    window: Instant,
    count: u32,
}

impl RateLimit {
    fn allow(&mut self) -> bool {
        if self.window.elapsed() >= Duration::from_secs(1) {
            self.window = Instant::now();
            self.count = 0;
        }
        self.count += 1;
        self.count <= MAX_MSGS_PER_SEC
    }
}

async fn serve(mut socket: WebSocket, id: Uuid, rooms: Rooms) {
    let conn = Uuid::new_v4();
    let tx = match rooms.join(id, conn) {
        Ok((tx, _)) => tx,
        Err(error) => {
            let reason = match error {
                JoinError::Full => "room full",
                JoinError::TooManyRooms => "too many rooms",
            };
            let _ = socket
                .send(Message::Close(Some(CloseFrame {
                    code: CLOSE_TRY_AGAIN,
                    reason: reason.into(),
                })))
                .await;
            return;
        }
    };
    let mut rx = tx.subscribe();
    rooms.announce(id, &tx);

    let (mut sink, mut stream) = socket.split();
    let mut ping = tokio::time::interval(PING_EVERY);
    ping.tick().await;
    let mut last_heard = Instant::now();
    let mut limit = RateLimit {
        window: Instant::now(),
        count: 0,
    };

    loop {
        tokio::select! {
            incoming = stream.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    last_heard = Instant::now();
                    if !limit.allow() {
                        continue;
                    }
                    let Some(value) = validate(&text) else { continue };
                    if value["type"] == "hello" {
                        // Peer ids are UUIDs; anything else is not a client of ours.
                        let Some(peer) = value["peer"].as_str().and_then(|p| Uuid::parse_str(p).ok()) else {
                            continue;
                        };
                        if rooms.hello(id, conn, peer, value["name"].as_str()) {
                            rooms.announce(id, &tx);
                        }
                    }
                    let _ = tx.send(Relay { from: conn, text });
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                // Pings, pongs and binary frames only show the client is there.
                Some(Ok(_)) => last_heard = Instant::now(),
            },
            relayed = rx.recv() => match relayed {
                Ok(relay) if relay.from != conn => {
                    if !matches!(timeout(SEND_TIMEOUT, sink.send(Message::Text(relay.text))).await, Ok(Ok(()))) {
                        break;
                    }
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => break,
            },
            _ = ping.tick() => {
                if last_heard.elapsed() > IDLE_TIMEOUT
                    || !matches!(timeout(SEND_TIMEOUT, sink.send(Message::Ping(Vec::new()))).await, Ok(Ok(())))
                {
                    break;
                }
            }
        }
    }

    rooms.leave(id, conn);
    rooms.announce(id, &tx);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_room_removed() {
        let rooms = Rooms::default();
        let (room, conn) = (Uuid::new_v4(), Uuid::new_v4());
        rooms.join(room, conn).unwrap();
        assert_eq!(rooms.room_count(), 1);
        rooms.leave(room, conn);
        assert_eq!(rooms.room_count(), 0);
    }

    #[test]
    fn colours_reuse_the_lowest_free_slot() {
        let rooms = Rooms::default();
        let room = Uuid::new_v4();
        let conns: Vec<Uuid> = (0..3).map(|_| Uuid::new_v4()).collect();
        let colours: Vec<usize> = conns
            .iter()
            .map(|c| rooms.join(room, *c).unwrap().1)
            .collect();
        assert_eq!(colours, vec![0, 1, 2]);
        rooms.leave(room, conns[1]);
        assert_eq!(rooms.join(room, Uuid::new_v4()).unwrap().1, 1);
    }

    #[test]
    fn full_room_and_room_cap_refuse() {
        let rooms = Rooms::default();
        let room = Uuid::new_v4();
        for _ in 0..MAX_MEMBERS {
            rooms.join(room, Uuid::new_v4()).unwrap();
        }
        assert_eq!(
            rooms.join(room, Uuid::new_v4()).unwrap_err(),
            JoinError::Full
        );

        let rooms = Rooms::default();
        for _ in 0..MAX_ROOMS {
            rooms.join(Uuid::new_v4(), Uuid::new_v4()).unwrap();
        }
        assert_eq!(
            rooms.join(Uuid::new_v4(), Uuid::new_v4()).unwrap_err(),
            JoinError::TooManyRooms
        );
    }

    #[test]
    fn validate_keeps_only_known_message_types() {
        assert!(validate(r#"{"type":"upsert"}"#).is_some());
        assert!(validate(r#"{"type":"presence"}"#).is_none());
        assert!(validate(r#"["upsert"]"#).is_none());
        assert!(validate("x").is_none());
    }
}
