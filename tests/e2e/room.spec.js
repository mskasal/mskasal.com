import { expect, test } from "@playwright/test";

const T = (id) => `[data-test=${id}]`;

async function selectInCv(page, needle) {
  await page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.getElementById("cv"), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf(needle);
      if (at === -1) continue;
      const range = new Range();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      return;
    }
    throw new Error(`no ${needle} in #cv`);
  }, needle);
}

async function addNote(page, needle, text) {
  await selectInCv(page, needle);
  await page.locator(T("add-note")).click();
  await page.locator(T("note-text")).fill(text);
  await page.locator(T("note-save")).click();
}

async function newPage(browser) {
  return (await browser.newContext()).newPage();
}

async function startSession(page) {
  await page.goto("/");
  await page.locator(T("start-room")).click();
  await expect(page).toHaveURL(/#room=[0-9a-f-]{36}/);
  await expect(page.locator(T("room-status"))).toHaveText("Live · 1 person");
  return page.url().match(/room=([0-9a-f-]{36})/)[1];
}

test("two_contexts_see_each_others_notes", async ({ page: a, browser }) => {
  await startSession(a);
  const b = await newPage(browser);
  await b.goto(a.url());
  await expect(a.locator(T("room-status"))).toHaveText("Live · 2 people");
  await expect(b.locator(T("room-status"))).toHaveText("Live · 2 people");

  await addNote(a, "Rust", "From A");
  await expect(b.locator(T("note-item"))).toContainText("From A", { timeout: 1000 });
  await addNote(b, "TypeScript", "From B");
  await expect(a.locator(T("note-item")).filter({ hasText: "From B" })).toHaveCount(1, { timeout: 1000 });

  // B's note is painted in B's colour on A's screen; A's own note is not.
  await expect.poll(() => a.evaluate(() => CSS.highlights.get("peer-1")?.size)).toBe(1);
  await expect.poll(() => a.evaluate(() => CSS.highlights.get("notes")?.size)).toBe(1);
  // Every participant's link carries all notes.
  await expect(b).toHaveURL(/n=1\./);
});

test("late_joiner_gets_state", async ({ page: a, browser }) => {
  const room = await startSession(a);
  await addNote(a, "Rust", "first");
  await addNote(a, "TypeScript", "second");
  const b = await newPage(browser);
  await b.goto(`/#room=${room}`);
  await expect(b.locator(T("note-item"))).toHaveCount(2);
  await expect(b).toHaveURL(/n=1\./);
});

test("delete_propagates", async ({ page: a, browser }) => {
  await startSession(a);
  const b = await newPage(browser);
  await b.goto(a.url());
  await expect(b.locator(T("room-status"))).toHaveText("Live · 2 people");
  await addNote(a, "Rust", "short-lived");
  await expect(b.locator(T("note-item"))).toHaveCount(1);
  await a.locator(T("note-item")).click();
  await a.locator(T("note-delete")).click();
  await expect(b.locator(T("note-item"))).toHaveCount(0);
});

test("leave_keeps_notes", async ({ page: a, browser }) => {
  await startSession(a);
  const b = await newPage(browser);
  await b.goto(a.url());
  await addNote(a, "Rust", "kept");
  await expect(a.locator(T("room-status"))).toHaveText("Live · 2 people");
  await a.locator(T("leave-room")).click();
  await expect(a).not.toHaveURL(/room=/);
  await expect(a).toHaveURL(/n=1\./);
  await expect(a.locator(T("note-item"))).toHaveCount(1);
  await expect(a.locator(T("room-status"))).toBeHidden();
  await expect(b.locator(T("room-status"))).toHaveText("Live · 1 person");
});

test("offline_room_link_still_shows_notes", async ({ page }) => {
  await page.routeWebSocket("**/ws/room/**", (ws) => ws.close());
  await page.goto("/healthz");
  const payload = await page.evaluate(async () =>
    (await import("/assets/annotate/codec.js")).encodeState({
      v: 1,
      notes: [{ id: "n_offline1", q: { exact: "Rust", prefix: "", suffix: "" }, t: "still here", c: 1, u: 1 }],
    }),
  );
  await page.goto(`/#room=0f8fad5b-d9cb-469f-a165-70867728950e&n=${payload}`);
  await expect(page.locator(T("note-item"))).toContainText("still here");
  await expect(page.locator(T("room-status"))).toHaveText("Offline (notes still saved in link)");
});

test("clearing_many_notes_reaches_peers", async ({ page: a, browser }) => {
  await a.goto("/healthz");
  const payload = await a.evaluate(async () =>
    (await import("/assets/annotate/codec.js")).encodeState({
      v: 1,
      notes: Array.from({ length: 40 }, (_, i) => ({
        id: `n_${String(i).padStart(8, "0")}`,
        q: { exact: "Rust", prefix: "", suffix: "" },
        t: `note ${i}`,
        c: i + 1,
        u: i + 1,
      })),
    }),
  );
  await a.goto(`/#n=${payload}`);
  await a.locator(T("start-room")).click();
  await expect(a.locator(T("room-status"))).toHaveText("Live · 1 person");
  const b = await newPage(browser);
  await b.goto(a.url());
  await expect(b.locator(T("note-item"))).toHaveCount(40);
  a.on("dialog", (dialog) => dialog.accept());
  await a.locator(T("clear-notes")).click();
  await expect(a.locator(T("note-item"))).toHaveCount(0);
  await expect(b.locator(T("note-item"))).toHaveCount(0, { timeout: 10_000 });
});
