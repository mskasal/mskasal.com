// Paints notes with the CSS Custom Highlight API (no DOM changes, so anchors
// keep working). Browsers without it still get the notes panel.

export const PEER_COLOURS = 8;
export const supported = typeof CSS !== "undefined" && "highlights" in CSS;

/**
 * Paints entries: [{ id, range, u, peer? }]. Entries with a `peer` colour go
 * to peer-<n>, the rest to "notes"; the active one is also in "notes-active".
 */
export function paint(entries, activeId = null) {
  if (!supported) return;
  const groups = new Map([["notes", []], ["notes-active", []]]);
  for (let i = 0; i < PEER_COLOURS; i++) groups.set(`peer-${i}`, []);
  for (const entry of entries) {
    if (!entry.range) continue;
    const name = Number.isInteger(entry.peer) ? `peer-${entry.peer % PEER_COLOURS}` : "notes";
    groups.get(name).push(entry.range);
    if (entry.id === activeId) groups.get("notes-active").push(entry.range);
  }
  for (const [name, ranges] of groups) CSS.highlights.set(name, new Highlight(...ranges));
}

function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    return position && { node: position.offsetNode, offset: position.offset };
  }
  const range = document.caretRangeFromPoint?.(x, y);
  return range && { node: range.startContainer, offset: range.startOffset };
}

/** The id of the newest note under the viewport point (x, y), or null. */
export function hitTest(x, y, entries) {
  const caret = caretAt(x, y);
  if (!caret) return null;
  let best = null;
  for (const entry of entries) {
    if (!entry.range) continue;
    let inside = false;
    try {
      inside = entry.range.isPointInRange(caret.node, caret.offset);
    } catch {
      // A point in another document or a doctype: not inside.
    }
    if (inside && (!best || entry.u > best.u)) best = entry;
  }
  return best?.id ?? null;
}
