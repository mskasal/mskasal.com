import { expect, test } from "@playwright/test";

import { mount } from "./helpers.js";

const setup = (page, body) => mount(page, `<nav><a href="/">Résumé</a></nav><main id="cv">${body}</main>`, { A: "anchor.js" });

// Selects `needle` (its `nth` occurrence, 0-based) in #cv and returns describe() of it.
const describeText = (page, needle, nth = 0) =>
  page.evaluate(([needle, nth]) => {
    const root = document.getElementById("cv");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let at = node.data.indexOf(needle);
      while (at !== -1) {
        if (seen++ === nth) {
          const range = new Range();
          range.setStart(node, at);
          range.setEnd(node, at + needle.length);
          return A.describe(range, root);
        }
        at = node.data.indexOf(needle, at + 1);
      }
    }
    throw new Error(`no ${needle}`);
  }, [needle, nth]);

// Resolves a quote; returns the matched text and the id of its first element ancestor.
const resolveQuote = (page, quote) =>
  page.evaluate((quote) => {
    const range = A.resolve(quote, document.getElementById("cv"));
    if (!range) return null;
    const start = range.startContainer.parentElement.closest("[id]");
    return { text: range.toString(), at: start?.id ?? null };
  }, quote);

test("describe_then_resolve_round_trips", async ({ page }) => {
  await setup(page, `<p id="p1">I am digging into Rust, exploring systems.</p>`);
  const quote = await describeText(page, "Rust");
  expect(quote).toEqual({ exact: "Rust", prefix: "I am digging into ", suffix: ", exploring systems." });
  expect(await resolveQuote(page, quote)).toEqual({ text: "Rust", at: "p1" });
});

test("picks_selected_occurrence", async ({ page }) => {
  await setup(page, `<p id="a">React at A.</p><p id="b">React at B.</p>`);
  const quote = await describeText(page, "React", 1);
  expect(await resolveQuote(page, quote)).toEqual({ text: "React", at: "b" });
});

test("survives_whitespace_changes", async ({ page }) => {
  await setup(page, `<p id="p">a senior   engineer here</p>`);
  const quote = await describeText(page, "senior   engineer");
  expect(quote.exact).toBe("senior engineer");
  await page.evaluate(() => {
    document.getElementById("p").textContent = "a senior\n    engineer here";
  });
  const resolved = await resolveQuote(page, quote);
  expect(resolved.at).toBe("p");
  expect(resolved.text.replace(/\s+/g, " ")).toBe("senior engineer");
});

test("spans_elements", async ({ page }) => {
  await setup(page, `<p id="p">Led <b>the wallet</b> and <i>banking features</i> today.</p>`);
  const quote = await page.evaluate(() => {
    const b = document.querySelector("b").firstChild;
    const i = document.querySelector("i").firstChild;
    const range = new Range();
    range.setStart(b, 4);
    range.setEnd(i, 7);
    return A.describe(range, document.getElementById("cv"));
  });
  expect(quote.exact).toBe("wallet and banking");
  expect(await resolveQuote(page, quote)).toEqual({ text: "wallet and banking", at: "p" });
});

test("returns_null_when_text_gone", async ({ page }) => {
  await setup(page, `<p>Nothing here.</p>`);
  expect(await resolveQuote(page, { exact: "Kubernetes", prefix: "", suffix: "" })).toBeNull();
});

test("describe_rejects_range_outside_root", async ({ page }) => {
  await setup(page, `<p id="p">CV text.</p>`);
  const result = await page.evaluate(() => {
    const range = new Range();
    range.setStart(document.querySelector("nav a").firstChild, 0);
    range.setEnd(document.getElementById("p").firstChild, 2);
    const collapsed = new Range();
    collapsed.setStart(document.getElementById("p").firstChild, 1);
    return [A.describe(range, document.getElementById("cv")), A.describe(collapsed, document.getElementById("cv"))];
  });
  expect(result).toEqual([null, null]);
});
