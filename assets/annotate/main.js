// Boots annotations on the CV: reads notes from the link, paints them, keeps
// the link in step with every change, and wires the UI.

import { resolve, textIndex } from "./anchor.js";
import { LIMITS, buildFragment, decodeState, encodeState, parseFragment } from "./codec.js";
import { paint } from "./highlight.js";
import { connectRoom } from "./room.js";
import { createStore } from "./state.js";
import { mountUI, rememberedName } from "./ui.js";

const MESSAGES = {
  unreadable: "These notes could not be read.",
  full: "This link is full. Remove a note to add another.",
  copied: "Link copied.",
  "room full": "This live session is full.",
  "too many rooms": "Live sessions are busy right now; try again later.",
};

const cv = document.getElementById("cv");
const root = document.getElementById("annotate-root");
const store = createStore();

let room = parseFragment(location.hash).room;
let activeId = null;
let lastHash = location.hash;
let writes = 0;

// Live session: this tab's peer id, the connection, and in-memory colours
// (peer → colour from presence; note → colour of the peer who last changed it).
const peerId = crypto.randomUUID();
let connection = null;
let peerColours = new Map();
const noteColours = new Map();

function entries() {
  const index = textIndex(cv);
  return store.notes().map((note) => ({ id: note.id, u: note.u, peer: noteColours.get(note.id), range: resolve(note.q, cv, index) }));
}

function repaint() {
  const current = entries();
  paint(current, activeId);
  ui.render(current);
}

function setHash(hash) {
  lastHash = hash;
  history.replaceState(null, "", hash || location.pathname + location.search);
}

async function fragmentFor(state) {
  return buildFragment({ room, n: state.notes.length ? await encodeState(state) : null });
}

// Writes the current notes into the link; a slower earlier write never wins.
async function writeUrl() {
  const write = ++writes;
  const hash = await fragmentFor(store.toState());
  if (write === writes) setHash(hash);
}

async function save(note) {
  const exists = Boolean(store.get(note.id));
  const others = store.notes().filter((n) => n.id !== note.id);
  if (!exists && others.length >= LIMITS.notes) {
    ui.showMessage(MESSAGES.full);
    return false;
  }
  const candidate = await fragmentFor({ v: 1, notes: [...others, note] });
  if (candidate.length > LIMITS.fragment || !store.upsert(note)) {
    ui.showMessage(MESSAGES.full);
    return false;
  }
  return true;
}

function onRoomMessage(message) {
  if (message.type === "presence") {
    peerColours = new Map(message.peers.map((p) => [p.peer, p.colour]));
  } else if (message.type === "hello") {
    sendState();
  } else {
    if (message.type === "upsert" && typeof message.note?.id === "string" && peerColours.has(message.peer)) {
      noteColours.set(message.note.id, peerColours.get(message.peer));
    }
    store.applyRemote(message);
  }
}

// Several peers greeting at once get one state message, not one each.
let stateTimer = 0;
function sendState() {
  if (stateTimer) return;
  stateTimer = setTimeout(() => {
    stateTimer = 0;
    connection?.send({ type: "state", ...store.toSync() });
  }, 250);
}

// Connects to the room in the link, or disconnects when there is none.
function joinRoom() {
  connection?.close();
  connection = null;
  peerColours = new Map();
  if (!room) return ui.setRoomStatus(null);
  ui.setRoomStatus("reconnecting");
  const live = connectRoom({
    roomId: room,
    peer: peerId,
    name: rememberedName() || undefined,
    onOpen: () => live.send({ type: "state", ...store.toSync() }),
    onMessage: onRoomMessage,
    onStatus: (status, people, reason) => {
      ui.setRoomStatus(status, people);
      if (reason) ui.showMessage(MESSAGES[reason] ?? reason);
    },
  });
  connection = live;
}

async function loadFromHash() {
  // The link changed under us: a write still in flight must not put the old one back.
  const load = ++writes;
  const { room: linkedRoom, n } = parseFragment(location.hash);
  const roomChanged = linkedRoom !== room;
  room = linkedRoom;
  lastHash = location.hash;
  if (roomChanged) joinRoom();
  if (!n) return store.load({ v: 1, notes: [] });
  const { state, error } = await decodeState(n);
  if (load !== writes) return;
  if (error) ui.showMessage(MESSAGES[error]);
  store.load(state);
}

async function share() {
  try {
    await navigator.clipboard.writeText(location.href);
    ui.showMessage(MESSAGES.copied);
  } catch {
    prompt("Copy this link:", location.href);
  }
}

const ui = mountUI({
  root,
  cv,
  store,
  save,
  onShare: share,
  onStartRoom: () => {
    room = crypto.randomUUID();
    writeUrl();
    joinRoom();
  },
  onLeaveRoom: () => {
    room = null;
    writeUrl();
    joinRoom();
  },
  onFocus: (id) => {
    activeId = id;
    paint(entries(), activeId);
  },
});

store.subscribe((event) => {
  if (event.source === "local") {
    if (event.type === "upsert") {
      noteColours.delete(event.note.id);
      connection?.send({ type: "upsert", note: event.note });
    } else if (event.type === "remove") {
      connection?.send({ type: "remove", id: event.id, u: event.u });
    }
  }
  repaint();
  if (event.source !== "load") writeUrl();
});

window.addEventListener("hashchange", () => {
  if (location.hash !== lastHash) loadFromHash();
});
// Web fonts and late layout can move text; re-resolve once everything is in.
window.addEventListener("load", repaint);

if (new URLSearchParams(location.search).has("debug")) window.__annotate = { store };

await loadFromHash();
joinRoom();
