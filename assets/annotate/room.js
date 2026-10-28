// The live-session connection: one WebSocket to /ws/room/<id>, reconnecting
// with backoff. The server only relays; notes stay in everyone's link.

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
const CLOSE_TRY_AGAIN = 1013;
// The server drops anything over 30 messages a second, so bursts (clearing
// every note, say) are queued and sent at most this fast.
const BURST = 10;
const PER_SECOND = 15;
// Beyond this, the oldest queued messages are dropped; a reconnect resyncs.
const MAX_QUEUE = 200;

export function defaultUrl(roomId) {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/room/${roomId}`;
}

/**
 * @param {object} options
 * @param {string} options.roomId
 * @param {string} options.peer      this tab's id
 * @param {string} [options.name]
 * @param {string} [options.url]
 * @param {() => void} options.onOpen            after every (re)connect, before anything else is sent
 * @param {(message: object) => void} options.onMessage   every message from the room, presence included
 * @param {(status: "live"|"reconnecting"|"offline", people: number, reason?: string) => void} options.onStatus
 */
export function connectRoom({ roomId, peer, name, url = defaultUrl(roomId), onOpen, onMessage, onStatus }) {
  let socket = null;
  let attempt = 0;
  let everConnected = false;
  let people = 0;
  let closed = false;
  let retry = 0;
  let queue = [];
  let tokens = BURST;
  let refilledAt = performance.now();
  let pumping = 0;
  let lastReason;

  function pump() {
    pumping = 0;
    const at = performance.now();
    tokens = Math.min(BURST, tokens + ((at - refilledAt) / 1000) * PER_SECOND);
    refilledAt = at;
    while (queue.length && tokens >= 1 && socket?.readyState === WebSocket.OPEN) {
      socket.send(queue.shift());
      tokens -= 1;
    }
    if (queue.length && socket?.readyState === WebSocket.OPEN) pumping = setTimeout(pump, 1000 / PER_SECOND);
  }

  function send(message) {
    if (socket?.readyState !== WebSocket.OPEN) return;
    queue.push(JSON.stringify({ ...message, peer }));
    if (queue.length > MAX_QUEUE) queue.shift();
    if (!pumping) pump();
  }

  function connect() {
    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      everConnected = true;
      send({ type: "hello", ...(name ? { name } : {}) });
      onOpen();
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message?.type === "presence" && Array.isArray(message.peers)) {
        // Joined for real: the server may still refuse after the socket opens.
        attempt = 0;
        lastReason = undefined;
        people = message.peers.length;
        onStatus("live", people);
      }
      if (message?.peer !== peer) onMessage(message);
    });
    socket.addEventListener("close", (event) => {
      // Whatever was queued is covered by the full state sent on reconnect.
      queue = [];
      clearTimeout(pumping);
      pumping = 0;
      if (closed) return;
      const reason = event.code === CLOSE_TRY_AGAIN ? event.reason || "room full" : undefined;
      // A full room or busy server: say so once, and come back slowly.
      onStatus(everConnected && !reason ? "reconnecting" : "offline", people, reason === lastReason ? undefined : reason);
      lastReason = reason;
      const wait = reason ? BACKOFF_MS.at(-1) : BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)];
      retry = setTimeout(connect, wait);
    });
  }

  connect();
  return {
    send,
    close() {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    },
  };
}
