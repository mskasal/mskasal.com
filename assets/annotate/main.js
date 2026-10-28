// Boots annotations on the CV: reads notes from the link, paints them, keeps
// the link in step with every change, and wires the UI.

import { resolve } from "./anchor.js";
import { LIMITS, buildFragment, decodeState, encodeState, parseFragment } from "./codec.js";
import { paint } from "./highlight.js";
import { createStore } from "./state.js";
import { mountUI } from "./ui.js";

const MESSAGES = {
  unreadable: "These notes could not be read.",
  full: "This link is full. Remove a note to add another.",
  copied: "Link copied.",
};

const cv = document.getElementById("cv");
const root = document.getElementById("annotate-root");
const store = createStore();

let room = parseFragment(location.hash).room;
let activeId = null;
let lastHash = location.hash;
let writes = 0;

const entries = () => store.notes().map((note) => ({ id: note.id, u: note.u, range: resolve(note.q, cv) }));

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

async function loadFromHash() {
  const { room: linkedRoom, n } = parseFragment(location.hash);
  room = linkedRoom;
  lastHash = location.hash;
  if (!n) return store.load({ v: 1, notes: [] });
  const { state, error } = await decodeState(n);
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
    ui.setRoomStatus("offline");
  },
  onLeaveRoom: () => {
    room = null;
    writeUrl();
    ui.setRoomStatus(null);
  },
  onFocus: (id) => {
    activeId = id;
    paint(entries(), activeId);
  },
});

store.subscribe(({ source }) => {
  repaint();
  if (source !== "load") writeUrl();
});

window.addEventListener("hashchange", () => {
  if (location.hash !== lastHash) loadFromHash();
});
// Web fonts and late layout can move text; re-resolve once everything is in.
window.addEventListener("load", repaint);

if (new URLSearchParams(location.search).has("debug")) window.__annotate = { store };

await loadFromHash();
ui.setRoomStatus(room ? "offline" : null);
