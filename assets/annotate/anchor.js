// Text-quote anchoring (W3C Web Annotation style): a note remembers the text
// it was made on plus a little context either side, not DOM offsets, so it
// finds its place again after the CV's markup or wording around it changes.
// All text is compared with whitespace runs collapsed to one space.

import { LIMITS } from "./codec.js";

const WHITESPACE = /\s/;

/**
 * The whitespace-normalised text under `root`, and for each of its characters
 * the text node and offset it came from.
 * @returns {{ text: string, positions: Array<{ node: Text, offset: number }> }}
 */
export function textIndex(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const chars = [];
  const positions = [];
  let lastWasSpace = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const data = node.data;
    for (let offset = 0; offset < data.length; offset++) {
      if (WHITESPACE.test(data[offset])) {
        if (lastWasSpace) continue;
        chars.push(" ");
        lastWasSpace = true;
      } else {
        chars.push(data[offset]);
        lastWasSpace = false;
      }
      positions.push({ node, offset });
    }
  }
  return { text: chars.join(""), positions };
}

const normalize = (text) => String(text ?? "").replace(/\s+/g, " ");

/** The quote for a selection inside `root`, or null if it is empty or leaves `root`. */
export function describe(range, root) {
  if (!range || range.collapsed) return null;
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const { text, positions } = textIndex(root);
  let start = -1;
  let end = -1;
  for (let i = 0; i < positions.length; i++) {
    const { node, offset } = positions[i];
    if (range.comparePoint(node, offset) === 0 && range.comparePoint(node, offset + 1) === 0) {
      if (start === -1) start = i;
      end = i + 1;
    } else if (start !== -1) {
      break;
    }
  }
  if (start === -1) return null;
  while (start < end && text[start] === " ") start++;
  while (end > start && text[end - 1] === " ") end--;
  if (start === end) return null;

  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - LIMITS.affix), start),
    suffix: text.slice(end, end + LIMITS.affix),
  };
}

// How many characters of `context` agree with the text next to a match.
function agreeBefore(text, at, prefix) {
  let n = 0;
  while (n < prefix.length && at - 1 - n >= 0 && text[at - 1 - n] === prefix[prefix.length - 1 - n]) n++;
  return n;
}
function agreeAfter(text, at, suffix) {
  let n = 0;
  while (n < suffix.length && at + n < text.length && text[at + n] === suffix[n]) n++;
  return n;
}

/**
 * The range a quote points at in `root` now, or null when its text is gone.
 * Pass `index` (from textIndex) when resolving many quotes against one root.
 */
export function resolve(quote, root, index = null) {
  const exact = normalize(quote?.exact);
  if (!exact) return null;
  const prefix = normalize(quote.prefix);
  const suffix = normalize(quote.suffix);
  const { text, positions } = index ?? textIndex(root);

  let best = -1;
  let bestScore = -1;
  for (let at = text.indexOf(exact); at !== -1; at = text.indexOf(exact, at + 1)) {
    const score = agreeBefore(text, at, prefix) + agreeAfter(text, at + exact.length, suffix);
    if (score > bestScore) {
      best = at;
      bestScore = score;
    }
  }
  if (best === -1) return null;

  const first = positions[best];
  const last = positions[best + exact.length - 1];
  const range = new Range();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}
