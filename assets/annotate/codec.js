// Notes live in the URL fragment: #n=1.<payload>, or #room=<uuid>&n=1.<payload>
// in a live session. payload = base64url(deflate-raw(UTF-8(JSON(state)))),
// and "1." is the format version. The fragment never reaches the server.

export const LIMITS = { notes: 50, text: 500, author: 40, affix: 32, fragment: 8000 };

const VERSION = "1";
const ID = /^n_[A-Za-z0-9_-]{8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A decoded payload larger than this is not a notes link (or is a zip bomb).
const MAX_DECODED_BYTES = 1 << 20;

const empty = () => ({ v: 1, notes: [] });
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value) => (typeof value === "string" ? value : null);

function sanitizeNote(input) {
  if (!isObject(input) || !isObject(input.q)) return null;
  const id = str(input.id);
  const exact = str(input.q.exact);
  const text = str(input.t);
  if (!id || !ID.test(id) || !exact || text === null) return null;
  if (!Number.isFinite(input.c) || !Number.isFinite(input.u)) return null;

  const prefix = str(input.q.prefix) ?? "";
  const suffix = str(input.q.suffix) ?? "";
  const note = {
    id,
    // The text nearest the selection matters most: keep the end of the
    // prefix and the start of the suffix.
    q: { exact, prefix: prefix.slice(-LIMITS.affix), suffix: suffix.slice(0, LIMITS.affix) },
    t: text.slice(0, LIMITS.text),
    c: input.c,
    u: input.u,
  };
  const author = str(input.a);
  if (author) note.a = author.slice(0, LIMITS.author);
  return note;
}

/** A clean state from anything: wrong types and unknown fields are dropped, strings clamped. */
export function sanitizeState(input) {
  if (!isObject(input) || !Array.isArray(input.notes)) return empty();
  const notes = [];
  for (const candidate of input.notes) {
    const note = sanitizeNote(candidate);
    if (note) notes.push(note);
    if (notes.length === LIMITS.notes) break;
  }
  return { v: 1, notes };
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error("not base64url");
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_DECODED_BYTES) {
      await reader.cancel();
      throw new Error("payload too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** The fragment payload ("1.<base64url>") for a state. */
export async function encodeState(state) {
  const json = new TextEncoder().encode(JSON.stringify(sanitizeState(state)));
  return `${VERSION}.${toBase64Url(await pipe(json, new CompressionStream("deflate-raw")))}`;
}

/** Reads a payload; never throws. Anything unreadable gives an empty state and error "unreadable". */
export async function decodeState(payload) {
  try {
    if (typeof payload !== "string" || !payload.startsWith(`${VERSION}.`)) throw new Error("unknown version");
    const bytes = await inflate(fromBase64Url(payload.slice(VERSION.length + 1)));
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isObject(parsed) || parsed.v !== 1) throw new Error("unknown state version");
    return { state: sanitizeState(parsed), error: null };
  } catch {
    return { state: empty(), error: "unreadable" };
  }
}

/** { room, n } from a location hash, with or without "#"; room only if it is a UUID. */
export function parseFragment(hash) {
  const params = new URLSearchParams(String(hash ?? "").replace(/^#/, ""));
  const room = params.get("room");
  return { room: room && UUID.test(room) ? room.toLowerCase() : null, n: params.get("n") || null };
}

/** The location hash for a room and payload; "" when both are empty. */
export function buildFragment({ room, n }) {
  const parts = [];
  if (room) parts.push(`room=${room}`);
  if (n) parts.push(`n=${n}`);
  return parts.length ? `#${parts.join("&")}` : "";
}
