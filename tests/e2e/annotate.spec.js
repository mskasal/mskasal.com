import { expect, test } from "@playwright/test";

const T = (id) => `[data-test=${id}]`;

// Selects the `nth` occurrence of `needle` inside #cv, like a visitor dragging over it.
async function selectInCv(page, needle, nth = 0) {
  await page.evaluate(
    ([needle, nth]) => {
      const walker = document.createTreeWalker(document.getElementById("cv"), NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let at = node.data.indexOf(needle); at !== -1; at = node.data.indexOf(needle, at + 1)) {
          if (seen++ === nth) {
            const range = new Range();
            range.setStart(node, at);
            range.setEnd(node, at + needle.length);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            return;
          }
        }
      }
      throw new Error(`no ${needle} in #cv`);
    },
    [needle, nth],
  );
}

async function addNote(page, needle, text) {
  await selectInCv(page, needle);
  await page.locator(T("add-note")).click();
  await page.locator(T("note-text")).fill(text);
  await page.locator(T("note-save")).click();
}

// Opens the CV with a fragment built from `notes` by the real codec.
async function openWithNotes(page, notes) {
  await page.goto("/healthz");
  const payload = await page.evaluate(
    async (notes) => (await import("/assets/annotate/codec.js")).encodeState({ v: 1, notes }),
    notes,
  );
  await page.goto(`/#n=${payload}`);
  await page.waitForSelector(`${T("panel")}[data-ready]`);
}

const note = (id, exact, u, t = `note ${id}`) => ({
  id: `n_${id.padStart(8, "0")}`,
  q: { exact, prefix: "", suffix: "" },
  t,
  c: u,
  u,
});

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("add_note_updates_url_and_survives_reload", async ({ page, browser }) => {
  await page.goto("/");
  await addNote(page, "Rust", "Nice");
  await expect(page).toHaveURL(/#n=1\./);
  const url = page.url();

  const other = await (await browser.newContext()).newPage();
  await other.goto(url);
  await expect(other.locator(T("note-item"))).toHaveCount(1);
  await expect(other.locator(T("note-item"))).toContainText("Nice");
  await expect.poll(() => other.evaluate(() => CSS.highlights.get("notes")?.size)).toBe(1);
});

test("no_add_button_for_selection_from_nav", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const range = new Range();
    range.setStart(document.querySelector("nav a").firstChild, 0);
    range.setEnd(document.querySelector("#cv h1").firstChild, 4);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.waitForTimeout(300);
  await expect(page.locator(T("add-note"))).toBeHidden();

  await selectInCv(page, "Rust");
  await expect(page.locator(T("add-note"))).toBeVisible();
});

for (const hash of ["#n=1.AAAA", "#n=2.x"]) {
  test(`corrupt_fragment_shows_message ${hash}`, async ({ page }) => {
    await page.goto(`/${hash}`);
    await expect(page.locator(T("message"))).toHaveText("These notes could not be read.");
    await expect(page.locator("#cv h1")).toBeVisible();
    await expect(page.locator(T("note-item"))).toHaveCount(0);
  });
}

test("orphan_note_listed", async ({ page }) => {
  await openWithNotes(page, [note("gone", "not on this page", 1), note("here", "Rust", 2)]);
  const orphan = page.locator(`${T("note-item")}[data-orphan]`);
  await expect(orphan).toHaveCount(1);
  await expect(orphan).toContainText("Text no longer on the page");
  await expect(orphan).toContainText("not on this page");
});

test("overlapping_notes_click_opens_newest", async ({ page }) => {
  await openWithNotes(page, [
    note("old", "Engineering leader with", 1, "older note"),
    note("new", "leader with 10+ years", 2, "newer note"),
  ]);
  const point = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.getElementById("cv"), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf("leader with");
      if (at === -1) continue;
      const range = new Range();
      range.setStart(node, at + 2);
      range.setEnd(node, at + 3);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator(T("note-text"))).toHaveValue("newer note");
});

test("note_text_is_not_html", async ({ page }) => {
  await page.goto("/");
  await addNote(page, "Rust", '<img src=x onerror="window.pwned=1">');
  await expect(page).toHaveURL(/#n=1\./);
  await page.goto("/healthz");
  await page.goBack();
  await expect(page.locator(T("note-item"))).toContainText('<img src=x onerror="window.pwned=1">');
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
});

test("delete_note_updates_url", async ({ page }) => {
  await page.goto("/");
  await addNote(page, "Rust", "Temporary");
  await expect(page).toHaveURL(/#n=1\./);
  await page.locator(T("note-item")).click();
  await page.locator(T("note-delete")).click();
  await expect(page.locator(T("note-item"))).toHaveCount(0);
  await expect(page).not.toHaveURL(/n=/);
});

test("full_link_refuses_new_note", async ({ page }) => {
  const notes = Array.from({ length: 50 }, (_, i) => note(String(i), "Rust", i + 1, `n${i}`));
  await openWithNotes(page, notes);
  const before = page.url();
  await selectInCv(page, "TypeScript");
  await page.locator(T("add-note")).click();
  await page.locator(T("note-text")).fill("one too many");
  await page.locator(T("note-save")).click();
  await expect(page.locator(T("message"))).toHaveText("This link is full. Remove a note to add another.");
  expect(page.url()).toBe(before);
  await expect(page.locator(T("note-item"))).toHaveCount(50);
});

test("phone_width_has_no_horizontal_scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto("/");
  await addNote(page, "Rust", "From a phone");
  await expect(page.locator(T("note-item"))).toHaveCount(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
