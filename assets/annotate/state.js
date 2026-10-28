// The notes on the page, merged the same way on every peer so that they
// converge whatever order changes arrive in: per note, the larger `u` wins,
// ties go to the larger serialised note, and a deletion beats any version of
// the note that is not newer than it.

import { LIMITS, sanitizeState } from "./codec.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const now = () => Math.floor(Date.now() / 1000);
const MAX_TOMBSTONES = 1000;

/** A random note id: "n_" and 8 characters. */
export function newNoteId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `n_${Array.from(bytes, (byte) => ALPHABET[byte & 63]).join("")}`;
}

// Independent of key order, so every peer compares the same strings.
const canonical = (n) => JSON.stringify([n.id, n.q.exact, n.q.prefix, n.q.suffix, n.t, n.a ?? "", n.c, n.u]);

/** The winner of two versions of the same note. */
export function mergeNote(a, b) {
  if (a.u !== b.u) return a.u > b.u ? a : b;
  return canonical(a) >= canonical(b) ? a : b;
}

const clean = (notes) => sanitizeState({ v: 1, notes }).notes;

export function createStore() {
  const live = new Map();
  const tombstones = new Map(); // id → u of the deletion
  const listeners = new Set();

  // Local events also say what changed, so it can be sent to peers.
  const emit = (source, change = {}) => {
    for (const listener of listeners) listener({ source, ...change });
  };

  // Applies one version of a note; returns whether anything changed.
  function apply(note) {
    const deletedAt = tombstones.get(note.id);
    if (deletedAt !== undefined && note.u <= deletedAt) return false;
    const current = live.get(note.id);
    if (!current && live.size >= LIMITS.notes) return false;
    const winner = current ? mergeNote(current, note) : note;
    if (winner === current) return false;
    live.set(note.id, winner);
    tombstones.delete(note.id);
    return true;
  }

  function erase(id, u) {
    const previous = tombstones.get(id);
    tombstones.delete(id);
    tombstones.set(id, Math.max(u, previous ?? -Infinity));
    // Deletions also arrive from peers: keep the newest MAX_TOMBSTONES.
    if (tombstones.size > MAX_TOMBSTONES) tombstones.delete(tombstones.keys().next().value);
    const current = live.get(id);
    if (current && current.u <= u) live.delete(id);
  }

  return {
    notes() {
      return [...live.values()].sort((a, b) => a.c - b.c || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
    get(id) {
      return live.get(id);
    },
    /** A local add or edit; false when the note is new and the page already has the maximum. */
    upsert(note) {
      const [valid] = clean([note]);
      if (!valid) return false;
      if (!live.has(valid.id) && live.size >= LIMITS.notes) return false;
      // A local edit is the newest thing the user did: make it newer than any
      // version or deletion of this note we know of, so peers accept it too.
      valid.u = Math.max(valid.u, (live.get(valid.id)?.u ?? -1) + 1, (tombstones.get(valid.id) ?? -1) + 1);
      tombstones.delete(valid.id);
      live.set(valid.id, valid);
      emit("local", { type: "upsert", note: valid });
      return true;
    },
    remove(id, u = Math.max(now(), live.get(id)?.u ?? 0)) {
      erase(id, u);
      emit("local", { type: "remove", id, u });
    },
    merge(notes) {
      let changed = false;
      for (const note of clean(notes)) changed = apply(note) || changed;
      if (changed) emit("remote");
    },
    /**
     * A message from a peer: {type: "upsert", note} | {type: "remove", id, u}
     * | {type: "state", notes, removed?: [{id, u}]}.
     */
    applyRemote(message) {
      if (message?.type === "upsert") this.merge([message.note]);
      else if (message?.type === "state" && Array.isArray(message.notes)) {
        let changed = false;
        for (const { id, u } of Array.isArray(message.removed) ? message.removed : []) {
          if (typeof id !== "string" || !Number.isFinite(u)) continue;
          const before = live.has(id);
          erase(id, u);
          changed = changed || before !== live.has(id);
        }
        if (changed) emit("remote");
        this.merge(message.notes);
      }
      else if (message?.type === "remove" && typeof message.id === "string" && Number.isFinite(message.u)) {
        const before = live.has(message.id);
        erase(message.id, message.u);
        if (before !== live.has(message.id)) emit("remote");
      }
    },
    /** Replaces everything (a link was opened or pasted). */
    load(state) {
      live.clear();
      tombstones.clear();
      for (const note of sanitizeState(state).notes) live.set(note.id, note);
      emit("load");
    },
    toState() {
      return { v: 1, notes: this.notes() };
    },
    /** What a peer needs to catch up: the notes and the deletions this session saw. */
    toSync() {
      return { notes: this.notes(), removed: [...tombstones].map(([id, u]) => ({ id, u })) };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
