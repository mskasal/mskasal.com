import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LIMITS,
  buildFragment,
  decodeState,
  encodeState,
  parseFragment,
  sanitizeState,
} from "../../assets/annotate/codec.js";

const note = (overrides = {}) => ({
  id: "n_abcdEFG1",
  q: { exact: "Rust", prefix: "digging into ", suffix: ", exploring" },
  t: "Nice",
  c: 1761650000,
  u: 1761650000,
  ...overrides,
});
const state = (notes) => ({ v: 1, notes });
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

test("round_trips_unicode", async () => {
  const input = state([note({ t: "Çok iyi 👍 — ü", a: "Şule" })]);
  const { state: out, error } = await decodeState(await encodeState(input));
  assert.equal(error, null);
  assert.deepEqual(out, input);
});

test("payload_has_version_prefix", async () => {
  assert.ok((await encodeState(state([note()]))).startsWith("1."));
});

test("rejects_future_version", async () => {
  const { state: out, error } = await decodeState("2.abc");
  assert.equal(error, "unreadable");
  assert.deepEqual(out, state([]));
});

test("rejects_truncated_payload", async () => {
  const payload = await encodeState(state([note(), note({ id: "n_abcdEFG2", t: "x".repeat(300) })]));
  const { error } = await decodeState(payload.slice(0, -10));
  assert.equal(error, "unreadable");
});

test("rejects_garbage", async () => {
  for (const bad of ["1.!!!", "", "1.", "nonsense", "1.AAAA"]) {
    const { state: out, error } = await decodeState(bad);
    assert.equal(error, "unreadable", bad);
    assert.deepEqual(out, state([]));
  }
});

test("sanitize_clamps_and_drops", () => {
  const long = note({
    t: "t".repeat(600),
    a: "a".repeat(60),
    q: { exact: "Rust", prefix: "p".repeat(18) + "q".repeat(32), suffix: "s".repeat(32) + "z".repeat(18) },
    x: "extra",
  });
  const out = sanitizeState(state([long, note({ id: "n_bad00000", t: 5 })]));
  assert.equal(out.notes.length, 1);
  const [n] = out.notes;
  assert.equal(n.t.length, LIMITS.text);
  assert.equal(n.a.length, LIMITS.author);
  assert.equal(n.q.prefix, "q".repeat(32));
  assert.equal(n.q.suffix, "s".repeat(32));
  assert.equal("x" in n, false);

  const many = Array.from({ length: 60 }, (_, i) => note({ id: `n_${String(i).padStart(8, "0")}` }));
  assert.equal(sanitizeState(state(many)).notes.length, LIMITS.notes);
});

test("sanitize_rejects_bad_ids_and_empty_quotes", () => {
  const out = sanitizeState(
    state([note({ id: "n_<script>" }), note({ id: "x_abcdEFG1" }), note({ q: { exact: "", prefix: "", suffix: "" } })]),
  );
  assert.deepEqual(out.notes, []);
  assert.deepEqual(sanitizeState(null), state([]));
  assert.deepEqual(sanitizeState({ v: 1, notes: "nope" }), state([]));
});

test("parse_fragment_ignores_bad_room", () => {
  assert.deepEqual(parseFragment("#room=abc&n=1.x"), { room: null, n: "1.x" });
  assert.deepEqual(parseFragment(`room=${UUID}`), { room: UUID, n: null });
  assert.deepEqual(parseFragment(""), { room: null, n: null });
});

test("build_fragment_round_trips", () => {
  assert.equal(buildFragment({ room: null, n: null }), "");
  assert.equal(buildFragment({ room: null, n: "1.abc" }), "#n=1.abc");
  const hash = buildFragment({ room: UUID, n: "1.abc" });
  assert.equal(hash, `#room=${UUID}&n=1.abc`);
  assert.deepEqual(parseFragment(hash), { room: UUID, n: "1.abc" });
});

test("limits_match_spec", () => {
  assert.deepEqual(LIMITS, { notes: 50, text: 500, author: 40, affix: 32, fragment: 8000 });
});
