// The visible parts: the floating "Add note" button, the note editor, the
// notes panel with its toolbar, the live-session chip and a message line.
// Note text from links or peers only ever reaches the page via textContent.

import { describe } from "./anchor.js";
import { LIMITS } from "./codec.js";
import { hitTest } from "./highlight.js";
import { newNoteId } from "./state.js";

const NAME_KEY = "annotate:name";
const now = () => Math.floor(Date.now() / 1000);

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === false || value == null) continue;
    if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children);
  return node;
}

function rememberedName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}
function rememberName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Private mode or blocked storage: the name just isn't remembered.
  }
}

/**
 * @param {object} options
 * @param {Element} options.root  where the UI is mounted (outside #cv)
 * @param {Element} options.cv    the annotatable CV
 * @param {ReturnType<import("./state.js").createStore>} options.store
 * @param {(note: object) => Promise<boolean>} options.save  adds or edits a note; false if refused
 * @param {() => void} options.onShare
 * @param {() => void} options.onStartRoom
 * @param {() => void} options.onLeaveRoom
 * @param {(id: string|null) => void} options.onFocus  the note being looked at, for painting
 */
export function mountUI({ root, cv, store, save, onShare, onStartRoom, onLeaveRoom, onFocus }) {
  let entries = [];
  let pendingQuote = null;
  let editing = null; // { id, quote, existing }

  // ── Add note button ─────────────────────────────────────────────────────
  const addButton = el("button", {
    type: "button",
    class: "annotate-add",
    "data-test": "add-note",
    hidden: true,
    text: "Add note",
    // Keep the selection while the button is pressed.
    onmousedown: (event) => event.preventDefault(),
    onclick: () => pendingQuote && openEditor({ quote: pendingQuote }),
  });

  let selectionTimer = 0;
  function onSelection() {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const selection = getSelection();
      const range = selection.rangeCount ? selection.getRangeAt(0) : null;
      const quote = range && describe(range, cv);
      pendingQuote = quote;
      if (!quote) {
        addButton.hidden = true;
        return;
      }
      const rect = range.getBoundingClientRect();
      addButton.hidden = false;
      const width = addButton.offsetWidth;
      const left = Math.min(Math.max(8, rect.right + window.scrollX - width), window.scrollX + document.documentElement.clientWidth - width - 8);
      addButton.style.left = `${left}px`;
      addButton.style.top = `${rect.bottom + window.scrollY + 6}px`;
    }, 120);
  }
  document.addEventListener("selectionchange", onSelection);
  document.addEventListener("keydown", (event) => {
    const typing = event.target.closest?.("input, textarea, [contenteditable]");
    if (event.key === "n" && !typing && !addButton.hidden && pendingQuote) {
      event.preventDefault();
      openEditor({ quote: pendingQuote });
    } else if (event.key === "Escape" && !editor.hidden) {
      closeEditor();
    }
  });

  // ── Editor ───────────────────────────────────────────────────────────────
  const quoteLine = el("blockquote", { class: "annotate-quote" });
  const textInput = el("textarea", { "data-test": "note-text", maxlength: LIMITS.text, rows: 4, "aria-label": "Note" });
  const nameInput = el("input", {
    "data-test": "note-author",
    maxlength: LIMITS.author,
    placeholder: "Your name (optional)",
    "aria-label": "Your name",
  });
  const deleteButton = el("button", {
    type: "button",
    class: "annotate-danger",
    "data-test": "note-delete",
    text: "Delete",
    onclick: () => {
      if (editing?.existing) store.remove(editing.id);
      closeEditor();
    },
  });
  const editor = el(
    "form",
    {
      class: "annotate-editor",
      role: "dialog",
      "aria-label": "Note",
      "data-test": "editor",
      hidden: true,
      onsubmit: async (event) => {
        event.preventDefault();
        const text = textInput.value.trim();
        if (!text) return textInput.focus();
        const author = nameInput.value.trim();
        rememberName(author);
        const previous = editing.existing ? store.get(editing.id) : null;
        const note = {
          id: editing.id,
          q: editing.quote,
          t: text,
          c: previous?.c ?? now(),
          u: Math.max(now(), (previous?.u ?? 0) + 1),
        };
        if (author) note.a = author;
        // The quote is captured; drop the old selection now, so a selection
        // made while the link is being written isn't cleared afterwards.
        getSelection().removeAllRanges();
        if (await save(note)) closeEditor();
      },
    },
    quoteLine,
    textInput,
    nameInput,
    el(
      "div",
      { class: "annotate-row" },
      deleteButton,
      el("button", { type: "button", "data-test": "note-cancel", text: "Cancel", onclick: () => closeEditor() }),
      el("button", { type: "submit", class: "annotate-primary", "data-test": "note-save", text: "Save" }),
    ),
  );

  function openEditor({ id = null, quote }) {
    const existing = id ? store.get(id) : null;
    editing = { id: existing ? id : newNoteId(), quote: existing ? existing.q : quote, existing: Boolean(existing) };
    quoteLine.textContent = editing.quote.exact;
    textInput.value = existing?.t ?? "";
    nameInput.value = existing?.a ?? rememberedName();
    deleteButton.hidden = !existing;
    addButton.hidden = true;
    editor.hidden = false;
    onFocus(existing ? id : null);
    textInput.focus();
  }
  function closeEditor() {
    editor.hidden = true;
    editing = null;
    onFocus(null);
  }

  // ── Panel ────────────────────────────────────────────────────────────────
  const list = el("ol", { class: "annotate-list" });
  const count = el("span", { class: "annotate-count" });
  const status = el("span", { class: "annotate-status", "data-test": "room-status", hidden: true });
  const startButton = el("button", { type: "button", "data-test": "start-room", text: "Start live session", onclick: () => onStartRoom() });
  const leaveButton = el("button", { type: "button", "data-test": "leave-room", text: "Leave session", hidden: true, onclick: () => onLeaveRoom() });
  const clearButton = el("button", {
    type: "button",
    class: "annotate-danger",
    "data-test": "clear-notes",
    text: "Clear notes",
    onclick: () => {
      if (!store.notes().length || !confirm("Remove all notes from this link?")) return;
      for (const note of store.notes()) store.remove(note.id);
    },
  });
  const toggle = el("button", {
    type: "button",
    class: "annotate-toggle",
    "aria-expanded": "true",
    onclick: () => {
      const open = panel.classList.toggle("annotate-collapsed") === false;
      toggle.setAttribute("aria-expanded", String(open));
    },
  });
  toggle.append("Notes ", count);
  const panel = el(
    "aside",
    { class: "annotate-panel", "data-test": "panel", "aria-label": "Notes" },
    el("header", {}, toggle, status),
    el(
      "div",
      { class: "annotate-body" },
      el(
        "div",
        { class: "annotate-row annotate-toolbar" },
        el("button", { type: "button", "data-test": "copy-link", text: "Copy link", onclick: () => onShare() }),
        startButton,
        leaveButton,
        clearButton,
      ),
      el("p", { class: "annotate-hint", text: "Select text in the CV to add a note. Notes live in the link: share it to share them." }),
      list,
    ),
  );

  const message = el("p", { class: "annotate-message", "data-test": "message", role: "status", "aria-live": "polite" });
  let messageTimer = 0;

  root.append(addButton, editor, panel, message);

  // Clicking highlighted text opens its note (the newest one where notes overlap).
  cv.addEventListener("click", (event) => {
    if (!getSelection().isCollapsed) return;
    const id = hitTest(event.clientX, event.clientY, entries);
    if (id) openEditor({ id });
  });

  function render(next) {
    entries = next;
    const notes = store.notes();
    count.textContent = `(${notes.length})`;
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    list.replaceChildren(
      ...notes.map((note) => {
        const range = byId.get(note.id)?.range ?? null;
        const item = el(
          "li",
          {
            class: "annotate-item",
            "data-test": "note-item",
            "data-orphan": !range,
            tabindex: 0,
            onclick: () => {
              if (range) {
                range.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
              }
              openEditor({ id: note.id });
            },
            onkeydown: (event) => event.key === "Enter" && event.currentTarget.click(),
          },
          el("q", { text: note.q.exact }),
          el("p", { text: note.t }),
        );
        if (note.a) item.append(el("small", { text: `— ${note.a}` }));
        if (!range) item.append(el("em", { class: "annotate-orphan", text: "Text no longer on the page" }));
        return item;
      }),
    );
    panel.toggleAttribute("data-ready", true);
  }

  return {
    render,
    showMessage(text) {
      message.textContent = text;
      clearTimeout(messageTimer);
      messageTimer = setTimeout(() => (message.textContent = ""), 6000);
    },
    /** status: "live" | "reconnecting" | "offline" | null (not in a session). */
    setRoomStatus(state, people = 0) {
      startButton.hidden = state !== null;
      leaveButton.hidden = state === null;
      status.hidden = state === null;
      status.dataset.state = state ?? "";
      status.textContent =
        state === "live"
          ? `Live · ${people} ${people === 1 ? "person" : "people"}`
          : state === "reconnecting"
            ? "Reconnecting…"
            : state === "offline"
              ? "Offline (notes still saved in link)"
              : "";
    },
  };
}
