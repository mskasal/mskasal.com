import assert from "node:assert/strict";
import { test } from "node:test";

import { createStore, mergeNote, newNoteId } from "../../assets/annotate/state.js";

const note = (id, u, overrides = {}) => ({
  id,
  q: { exact: "Rust", prefix: "", suffix: "" },
  t: `text ${u}`,
  c: 1,
  u,
  ...overrides,
});
const ID = (i) => `n_${String(i).padStart(8, "0")}`;

test("new_note_id_has_the_spec_shape", () => {
  const ids = new Set(Array.from({ length: 200 }, newNoteId));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^n_[A-Za-z0-9_-]{8}$/);
});

test("merge_is_commutative", () => {
  for (let i = 0; i < 20; i++) {
    const a = note(ID(1), Math.floor(Math.random() * 3), { t: `a${i}` });
    const b = note(ID(1), Math.floor(Math.random() * 3), { t: `b${i}` });
    assert.deepEqual(mergeNote(a, b), mergeNote(b, a));
  }
});

test("newer_update_wins", () => {
  const store = createStore();
  store.merge([note(ID(1), 5, { t: "old" })]);
  store.merge([note(ID(1), 7, { t: "new" })]);
  store.merge([note(ID(1), 6, { t: "stale" })]);
  assert.equal(store.get(ID(1)).t, "new");
});

test("tombstone_blocks_older_state", () => {
  const store = createStore();
  store.merge([note(ID(1), 5)]);
  store.remove(ID(1), 10);
  store.merge([note(ID(1), 5)]);
  store.applyRemote({ type: "state", notes: [note(ID(1), 10)] });
  assert.equal(store.get(ID(1)), undefined);
});

test("newer_note_revives_tombstone", () => {
  const store = createStore();
  store.remove(ID(1), 10);
  store.merge([note(ID(1), 11)]);
  assert.equal(store.get(ID(1)).u, 11);
});

test("remote_remove_loses_to_newer_edit", () => {
  const store = createStore();
  store.merge([note(ID(1), 12)]);
  store.applyRemote({ type: "remove", id: ID(1), u: 11 });
  assert.equal(store.get(ID(1)).u, 12);
});

test("upsert_refuses_51st_note", () => {
  const store = createStore();
  for (let i = 0; i < 50; i++) assert.equal(store.upsert(note(ID(i), 1)), true);
  assert.equal(store.upsert(note(ID(50), 1)), false);
  assert.equal(store.notes().length, 50);
  // Editing an existing note is still allowed at the limit.
  assert.equal(store.upsert(note(ID(3), 2, { t: "edited" })), true);
});

test("toState_excludes_tombstones", () => {
  const store = createStore();
  store.merge([note(ID(1), 1), note(ID(2), 1)]);
  store.remove(ID(1), 2);
  assert.deepEqual(store.toState(), { v: 1, notes: [note(ID(2), 1)] });
});

test("notes_sorted_by_created_then_id", () => {
  const store = createStore();
  store.merge([note(ID(3), 1, { c: 2 }), note(ID(2), 1, { c: 1 }), note(ID(1), 1, { c: 2 })]);
  assert.deepEqual(store.notes().map((n) => n.id), [ID(2), ID(1), ID(3)]);
});

test("remote_input_is_sanitized", () => {
  const store = createStore();
  store.applyRemote({ type: "upsert", note: { ...note(ID(1), 1), t: "x".repeat(900), evil: 1 } });
  store.applyRemote({ type: "upsert", note: { id: "bad", t: 1 } });
  assert.equal(store.notes().length, 1);
  assert.equal(store.get(ID(1)).t.length, 500);
  assert.equal("evil" in store.get(ID(1)), false);
});

test("subscribe_reports_source", () => {
  const store = createStore();
  const seen = [];
  const unsubscribe = store.subscribe((event) => seen.push(event.source));
  store.upsert(note(ID(1), 1));
  store.applyRemote({ type: "upsert", note: note(ID(2), 1) });
  store.load({ v: 1, notes: [] });
  unsubscribe();
  store.upsert(note(ID(3), 1));
  assert.deepEqual(seen, ["local", "remote", "load"]);
});

test("three_peers_converge", () => {
  const messages = [
    { type: "upsert", note: note(ID(1), 1, { t: "A" }) },
    { type: "upsert", note: note(ID(1), 2, { t: "B" }) },
    { type: "upsert", note: note(ID(2), 1) },
    { type: "remove", id: ID(2), u: 3 },
    { type: "upsert", note: note(ID(3), 4) },
    { type: "state", notes: [note(ID(2), 2), note(ID(1), 2, { t: "C" })] },
    { type: "remove", id: ID(3), u: 4 },
  ];
  const orders = [
    messages,
    [...messages].reverse(),
    [messages[5], messages[3], messages[0], messages[6], messages[2], messages[4], messages[1]],
  ];
  const results = orders.map((order) => {
    const store = createStore();
    for (const message of order) store.applyRemote(message);
    return store.toState();
  });
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(results[2], results[0]);
});

test("local_events_describe_the_change", () => {
  const store = createStore();
  const events = [];
  store.subscribe((event) => events.push(event));
  store.upsert(note(ID(1), 1));
  store.remove(ID(1), 5);
  assert.deepEqual(events, [
    { source: "local", type: "upsert", note: note(ID(1), 1) },
    { source: "local", type: "remove", id: ID(1), u: 5 },
  ]);
});

test("local_remove_always_deletes", () => {
  const store = createStore();
  const future = Math.floor(Date.now() / 1000) + 100;
  store.upsert(note(ID(1), future));
  store.remove(ID(1));
  assert.equal(store.get(ID(1)), undefined);
  // and peers given the same removal agree
  const peer = createStore();
  peer.merge([note(ID(1), future)]);
  peer.applyRemote({ type: "remove", id: ID(1), u: future });
  assert.equal(peer.get(ID(1)), undefined);
});
