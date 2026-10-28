// The notes on the page, merged the same way on every peer so that they
// converge whatever order changes arrive in: per note, the larger `u` wins,
// ties go to the larger serialised note, and a deletion beats any version of
// the note that is not newer than it.

import { LIMITS, sanitizeState } from "./codec.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const now = () => Math.floor(Date.now() / 1000);

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

  const emit = (source) => {
    for (const listener of listeners) listener({ source });
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
    tombstones.set(id, Math.max(u, tombstones.get(id) ?? -Infinity));
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
      // A local edit always wins locally: it is the newest thing the user did.
      tombstones.delete(valid.id);
      live.set(valid.id, valid);
      emit("local");
      return true;
    },
    remove(id, u = now()) {
      erase(id, u);
      emit("local");
    },
    merge(notes) {
      let changed = false;
      for (const note of clean(notes)) changed = apply(note) || changed;
      if (changed) emit("remote");
    },
    /** A message from a peer: {type: "upsert", note} | {type: "remove", id, u} | {type: "state", notes}. */
    applyRemote(message) {
      if (message?.type === "upsert") this.merge([message.note]);
      else if (message?.type === "state" && Array.isArray(message.notes)) this.merge(message.notes);
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
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
