mod common;

use std::{net::SocketAddr, time::Duration};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::{net::TcpStream, time::timeout};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{protocol::frame::coding::CloseCode, Error, Message},
    MaybeTlsStream, WebSocketStream,
};
use uuid::Uuid;

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn join(addr: SocketAddr, room: &str) -> Socket {
    let (socket, _) = connect_async(format!("ws://{addr}/ws/room/{room}"))
        .await
        .expect("websocket connects");
    socket
}

async fn send(socket: &mut Socket, value: Value) {
    socket.send(Message::Text(value.to_string())).await.unwrap();
}

/// The next JSON message other than presence, if one arrives within `wait`.
async fn next_relay(socket: &mut Socket, wait: Duration) -> Option<Value> {
    timeout(wait, async {
        while let Some(Ok(message)) = socket.next().await {
            if let Message::Text(text) = message {
                let value: Value = serde_json::from_str(&text).unwrap();
                if value["type"] != "presence" {
                    return Some(value);
                }
            }
        }
        None
    })
    .await
    .ok()
    .flatten()
}

/// The next presence message's peer count.
async fn next_presence(socket: &mut Socket) -> usize {
    timeout(Duration::from_secs(2), async {
        loop {
            if let Some(Ok(Message::Text(text))) = socket.next().await {
                let value: Value = serde_json::from_str(&text).unwrap();
                if value["type"] == "presence" {
                    return value["peers"].as_array().unwrap().len();
                }
            }
        }
    })
    .await
    .expect("presence arrives")
}

fn upsert(n: u32) -> Value {
    json!({"type": "upsert", "peer": "p", "note": {"id": format!("n_{n:08}"), "t": "x"}})
}

const SHORT: Duration = Duration::from_millis(300);

#[tokio::test]
async fn relays_to_others_not_sender() {
    let addr = common::spawn().await;
    let room = Uuid::new_v4().to_string();
    let mut a = join(addr, &room).await;
    let mut b = join(addr, &room).await;
    send(&mut a, upsert(1)).await;
    assert_eq!(
        next_relay(&mut b, Duration::from_secs(2)).await,
        Some(upsert(1))
    );
    assert_eq!(next_relay(&mut a, SHORT).await, None);
}

#[tokio::test]
async fn rooms_are_isolated() {
    let addr = common::spawn().await;
    let mut a = join(addr, &Uuid::new_v4().to_string()).await;
    let mut c = join(addr, &Uuid::new_v4().to_string()).await;
    send(&mut a, upsert(1)).await;
    assert_eq!(next_relay(&mut c, SHORT).await, None);
}

#[tokio::test]
async fn bad_room_id_is_400() {
    let addr = common::spawn().await;
    match connect_async(format!("ws://{addr}/ws/room/nope")).await {
        Err(Error::Http(response)) => assert_eq!(response.status(), 400),
        other => panic!("expected HTTP 400, got {other:?}"),
    }
}

#[tokio::test]
async fn seventeenth_member_closed_1013() {
    let addr = common::spawn().await;
    let room = Uuid::new_v4().to_string();
    let mut members = Vec::new();
    for _ in 0..16 {
        members.push(join(addr, &room).await);
    }
    let mut late = join(addr, &room).await;
    let close = timeout(Duration::from_secs(2), async {
        while let Some(Ok(message)) = late.next().await {
            if let Message::Close(frame) = message {
                return frame;
            }
        }
        None
    })
    .await
    .expect("closed in time")
    .expect("close frame");
    assert_eq!(close.code, CloseCode::Again);
    assert_eq!(close.reason, "room full");
}

#[tokio::test]
async fn malformed_frames_dropped() {
    let addr = common::spawn().await;
    let room = Uuid::new_v4().to_string();
    let mut a = join(addr, &room).await;
    let mut b = join(addr, &room).await;
    a.send(Message::Text("x".into())).await.unwrap();
    send(&mut a, json!({"type": "evil"})).await;
    send(&mut a, json!(["upsert"])).await;
    a.send(Message::Binary(vec![1, 2, 3])).await.unwrap();
    send(&mut a, upsert(2)).await;
    assert_eq!(
        next_relay(&mut b, Duration::from_secs(2)).await,
        Some(upsert(2))
    );
    assert_eq!(next_relay(&mut b, SHORT).await, None);
}

#[tokio::test]
async fn presence_on_join_and_leave() {
    let addr = common::spawn().await;
    let room = Uuid::new_v4().to_string();
    let mut a = join(addr, &room).await;
    assert_eq!(next_presence(&mut a).await, 1);
    let mut b = join(addr, &room).await;
    assert_eq!(next_presence(&mut a).await, 2);
    b.close(None).await.unwrap();
    assert_eq!(next_presence(&mut a).await, 1);
}

#[tokio::test]
async fn hello_names_appear_in_presence() {
    let addr = common::spawn().await;
    let room = Uuid::new_v4().to_string();
    let mut a = join(addr, &room).await;
    let peer = Uuid::new_v4().to_string();
    send(
        &mut a,
        json!({"type": "hello", "peer": peer, "name": "Ada"}),
    )
    .await;
    let presence = timeout(Duration::from_secs(2), async {
        loop {
            if let Some(Ok(Message::Text(text))) = a.next().await {
                let value: Value = serde_json::from_str(&text).unwrap();
                if value["type"] == "presence" && value["peers"][0]["name"] == "Ada" {
                    return value;
                }
            }
        }
    })
    .await
    .expect("named presence");
    assert_eq!(presence["peers"][0]["peer"], json!(peer));
    assert_eq!(presence["peers"][0]["colour"], json!(0));
}

#[tokio::test]
async fn rate_limit_drops_excess() {
    let addr = common::spawn().await;
    let room = Uuid::new_v4().to_string();
    let mut a = join(addr, &room).await;
    let mut b = join(addr, &room).await;
    for n in 0..100 {
        send(&mut a, upsert(n)).await;
    }
    let mut received = 0;
    while next_relay(&mut b, Duration::from_millis(500))
        .await
        .is_some()
    {
        received += 1;
    }
    assert!((25..=31).contains(&received), "received {received}");
}

/// Every message (presence included) that arrives within `wait`.
async fn drain(socket: &mut Socket, wait: Duration) -> Vec<Value> {
    let mut out = Vec::new();
    let _ = timeout(wait, async {
        while let Some(Ok(message)) = socket.next().await {
            if let Message::Text(text) = message {
                out.push(serde_json::from_str(&text).unwrap());
            }
        }
    })
    .await;
    out
}

#[tokio::test]
async fn hello_with_non_uuid_peer_is_ignored() {
    let addr = common::spawn().await;
    let room = Uuid::new_v4().to_string();
    let mut a = join(addr, &room).await;
    let mut b = join(addr, &room).await;
    drain(&mut a, SHORT).await;
    send(&mut a, json!({"type": "hello", "peer": "x".repeat(60_000)})).await;
    let seen = drain(&mut b, SHORT).await;
    assert!(seen.iter().all(|m| m["type"] != "hello"), "hello relayed");
    assert!(
        seen.iter().all(|m| !m.to_string().contains("xxxx")),
        "long peer id broadcast"
    );
}

#[tokio::test]
async fn repeated_hello_does_not_rebroadcast_presence() {
    let addr = common::spawn().await;
    let room = Uuid::new_v4().to_string();
    let mut a = join(addr, &room).await;
    drain(&mut a, SHORT).await;
    let hello = json!({"type": "hello", "peer": Uuid::new_v4().to_string(), "name": "Ada"});
    send(&mut a, hello.clone()).await;
    let first = drain(&mut a, SHORT).await;
    assert_eq!(first.iter().filter(|m| m["type"] == "presence").count(), 1);
    for _ in 0..5 {
        send(&mut a, hello.clone()).await;
    }
    let repeats = drain(&mut a, SHORT).await;
    assert_eq!(
        repeats.iter().filter(|m| m["type"] == "presence").count(),
        0
    );
}

#[tokio::test]
async fn stuck_reader_is_dropped() {
    let addr = common::spawn().await;
    let room = Uuid::new_v4().to_string();
    let _stuck = join(addr, &room).await; // never reads
    let mut watcher = join(addr, &room).await;
    let mut senders = Vec::new();
    for _ in 0..10 {
        senders.push(join(addr, &room).await);
    }
    let big = json!({"type": "upsert", "peer": "p", "note": {"t": "x".repeat(60_000)}});
    // Keep the stuck member's socket buffers full until the server gives up on it.
    let flood = tokio::spawn(async move {
        loop {
            for s in senders.iter_mut() {
                let _ = s.send(Message::Text(big.to_string())).await;
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
    });
    let dropped = timeout(Duration::from_secs(30), async {
        // Presence grows to 12 while everyone joins; a later, smaller count
        // means the server disconnected a member that stopped reading.
        let mut full = false;
        loop {
            match watcher.next().await {
                Some(Ok(Message::Text(text))) => {
                    let value: Value = serde_json::from_str(&text).unwrap();
                    if value["type"] != "presence" {
                        continue;
                    }
                    let count = value["peers"].as_array().unwrap().len();
                    if count == 12 {
                        full = true;
                    } else if full && count < 12 {
                        return true;
                    }
                }
                Some(Ok(_)) => {}
                _ => return false,
            }
        }
    })
    .await;
    flood.abort();
    assert_eq!(dropped, Ok(true), "stuck member was never disconnected");
}

#[tokio::test]
async fn echo_socket_refuses_huge_messages() {
    let addr = common::spawn().await;
    let (mut socket, _) = connect_async(format!("ws://{addr}/ws")).await.unwrap();
    socket
        .send(Message::Text("x".repeat(200_000)))
        .await
        .unwrap();
    let reply = timeout(Duration::from_secs(2), socket.next())
        .await
        .unwrap();
    assert!(
        !matches!(reply, Some(Ok(Message::Text(ref t))) if t.len() == 200_000),
        "200 KB message was echoed"
    );
}

#[tokio::test]
async fn repeated_hello_is_not_relayed() {
    let addr = common::spawn().await;
    let room = Uuid::new_v4().to_string();
    let mut a = join(addr, &room).await;
    let mut b = join(addr, &room).await;
    let hello = json!({"type": "hello", "peer": Uuid::new_v4().to_string()});
    send(&mut a, hello.clone()).await;
    let first = drain(&mut b, SHORT).await;
    assert_eq!(first.iter().filter(|m| m["type"] == "hello").count(), 1);
    for _ in 0..10 {
        send(&mut a, hello.clone()).await;
    }
    let repeats = drain(&mut b, SHORT).await;
    assert_eq!(repeats.iter().filter(|m| m["type"] == "hello").count(), 0);
}
