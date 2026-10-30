// The quote block: a page text block with a continuous left rule (the marker
// zone, the list checkboxes' axis). The two creation paths are the slash
// menu's Quote command and the format toolbar's list-type menu option (after
// the list kinds). Enter on a non-empty line is a soft line break; Enter on
// the empty LAST line exits (the preceding lines stand as the quote, a new
// paragraph takes the caret); Backspace at the start never merges into the
// previous block (the characters, line breaks included, delete in place
// until the quote is empty, then it resets to a paragraph).
import { type Browser, type Page, expect, test } from "@playwright/test";

import { RELAY, SETTLE, outCount } from "./helpers";

/**
 * A unique room per test: the relay keeps rooms for the dev server's
 * lifetime, so a fixed name would accumulate the content of failed attempts
 * across runs.
 */
async function openPanes(browser: Browser, seed: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  await a.goto(`/?client=a&syncUrl=${RELAY}/${room}`);
  await expect(a.getByTestId("status-a")).toHaveText("connected");
  await b.goto(`/?client=b&syncUrl=${RELAY}/${room}`);
  await expect(b.getByTestId("status-b")).toHaveText("connected");
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

function inner(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-slot="docblocks/block-content"]').first();
}

function toolbar(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-slot="docblocks/format-toolbar"]');
}

/** The pane's wire-log outbound doc-update count (awareness frames are not logged). */

/** The pane's root entry-list ids (plain values across the evaluate bridge). */
async function rootIds(page: Page, client: "a" | "b"): Promise<string[]> {
  return page.evaluate((c) => {
    const d = window.__paneDocs?.[c];
    if (d === null || d === undefined) throw new Error(`the ${c} pane's doc is not mounted`);
    return d.getChildren(d.toJSON().id);
  }, client);
}

/** A block's plain snapshot (the doc object itself never crosses the bridge). */
async function blockOf(
  page: Page,
  client: "a" | "b",
  id: string
): Promise<{ type: string; attrs?: Record<string, unknown> } | null> {
  return page.evaluate(
    ({ c, id }) => {
      const d = window.__paneDocs?.[c];
      if (d === null || d === undefined) throw new Error(`the ${c} pane's doc is not mounted`);
      return d.getBlock(id);
    },
    { c: client, id }
  );
}

/** Type the fixture text into the seeded paragraph and select the whole line. */
async function typeAndSelectAll(page: Page, client: "a" | "b"): Promise<void> {
  const target = inner(page, client);
  await target.click();
  await page.keyboard.type("hello world");
  // The caret is at the end; Shift+Home selects the whole line.
  await page.keyboard.down("Shift");
  await page.keyboard.press("Home");
  await page.keyboard.up("Shift");
}

test("the slash menu's Quote converts the block and the rule stands in both panes", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "ux10-quote-slash");
  const target = inner(a, "a");
  await target.click();

  await a.keyboard.type("note /quote");
  const menu = a.locator('[data-slot="docblocks/slash-menu"]');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[role="menuitem"]')).toHaveCount(1);
  await expect(menu.locator('[role="menuitem"]')).toHaveText("Quote");

  const outBefore = await outCount(a, "a");
  await a.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);

  // The block converted in place: a quote, the phrase stripped (the text
  // stands), the rule rendered in both panes (one command — one wire update).
  const quote = a.locator('[data-block-type="quote"]');
  await expect(quote).toHaveCount(1);
  await expect(quote.locator('[data-slot="docblocks/block-content"]')).toHaveText("note");
  const id = (await rootIds(a, "a"))[0]!;
  expect((await blockOf(a, "a", id))?.type).toBe("quote");
  await expect(a.locator('[data-slot="docblocks/quote-rule"]')).toHaveCount(1);
  await expect(b.locator('[data-slot="docblocks/quote-rule"]')).toHaveCount(1);
  expect(await outCount(a, "a")).toBe(outBefore + 1);

  // One undo step restores the paragraph with the phrase.
  await a.keyboard.press("Control+z");
  await expect.poll(async () => outCount(a, "a")).toBe(outBefore + 2);
  await expect(a.locator('[data-block-type="quote"]')).toHaveCount(0);
  await expect(target).toHaveText("note /quote");
  await close();
});

test("the list-type menu's Quote option converts a paragraph; Text converts it back", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "ux11-quote-listmenu");
  await typeAndSelectAll(a, "a");
  const bar = toolbar(a, "a");
  await expect(bar).toBeVisible();

  await bar.locator('button[aria-label="List type"]').click();
  const menu = a.locator('[data-slot="docblocks/format-list-menu"]');
  // The option stands after the three list kinds and before "Text".
  await expect(menu.locator("[data-list-option]")).toHaveCount(5);
  await expect(menu.locator('[data-list-option="quote"]')).toBeVisible();
  await menu.locator('[data-list-option="quote"]').click();

  const id = (await rootIds(a, "a"))[0]!;
  expect((await blockOf(a, "a", id))?.type).toBe("quote");
  await expect(a.locator('[data-slot="docblocks/quote-rule"]')).toHaveCount(1);
  await expect(
    pane(a, "a").locator(`[data-block-id="${id}"]:not([data-slot="docblocks/block-content"])`)
  ).toContainText("hello world");
  // The other pane stands the quote over the wire (the rule included) — wait
  // for B to converge (a one-shot read can catch B mid-convergence).
  await expect.poll(async () => (await blockOf(b, "b", id))?.type, SETTLE).toBe("quote");
  await expect(b.locator('[data-slot="docblocks/quote-rule"]')).toHaveCount(1);

  // Back to text: the toolbar stands over a quote range (the Quote radio is
  // active), the Text option converts it.
  await typeAndSelectAll(a, "a");
  await bar.locator('button[aria-label="List type"]').click();
  await expect(a.locator('[data-slot="docblocks/format-list-menu"] [data-list-option="quote"]')).toHaveAttribute(
    "data-state",
    "checked"
  );
  await a.locator('[data-slot="docblocks/format-list-menu"] [data-list-option="paragraph"]').click();

  expect((await blockOf(a, "a", id))?.type).toBe("paragraph");
  await expect(a.locator('[data-slot="docblocks/quote-rule"]')).toHaveCount(0);
  await close();
});

test("Enter: a non-empty line is a break; the empty last line exits; the empty middle line is a break", async ({
  browser,
}) => {
  const { a, b, close } = await openPanes(browser, "ux12-quote-enter");
  const quoteId = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    const q = doc.insertBlock("quote");
    doc.insertText(q, 0, "abc");
    return q;
  });
  expect(quoteId).not.toBeNull();
  await a.waitForTimeout(600); // the enter animations settle (boxes move with them)

  const quoteInner = a.locator(`[data-block-id="${quoteId}"] [data-slot="docblocks/block-content"]`);
  await quoteInner.click();
  await a.keyboard.press("End");

  // Enter on the non-empty line: a soft line break (the type stands).
  await a.keyboard.press("Enter");
  await expect(quoteInner).toHaveText("abc\n");
  expect((await blockOf(a, "a", quoteId))?.type).toBe("quote");
  expect((await rootIds(a, "a")).length).toBe(2); // root + the quote

  // A second line, then the empty last line: Enter exits — the quote keeps
  // both lines, a new empty paragraph takes the caret.
  await a.keyboard.type("def");
  await a.keyboard.press("Enter"); // line break after "def"
  await a.keyboard.press("Enter"); // the exit
  expect((await blockOf(a, "a", quoteId))?.type).toBe("quote");
  expect(await a.evaluate((q) => window.__paneDocs?.a?.getText(q) ?? null, quoteId)).toBe("abc\ndef");
  const ids = await rootIds(a, "a");
  expect(ids).toHaveLength(3);
  expect(ids[1]).toBe(quoteId);
  expect((await blockOf(a, "a", ids[2]!))?.type).toBe("paragraph");
  // The caret stands in the new paragraph (the gesture's focus move).
  const paragraph = a.locator(`[data-block-id="${ids[2]}"] [data-slot="docblocks/block-content"]`);
  await expect(paragraph).toBeFocused();
  // The exit is one composed command — wait for B to stand the same two
  // blocks over the wire (a one-shot read can catch B mid-convergence).
  await expect.poll(async () => (await blockOf(b, "b", ids[2]!))?.type, SETTLE).toBe("paragraph");
  await expect.poll(async () => (await blockOf(b, "b", quoteId))?.type, SETTLE).toBe("quote");

  // The empty MIDDLE line takes a plain break (not the exit): a line stands
  // after it.
  const middleId = (await a.evaluate((c) => {
    const doc = window.__paneDocs?.[c as "a" | "b"] ?? null;
    if (doc === null) return null;
    const q = doc.insertBlock("quote");
    doc.insertText(q, 0, "a\n\nc");
    return q;
  }, "a"))!;
  const middleInner = a.locator(`[data-block-id="${middleId}"] [data-slot="docblocks/block-content"]`);
  await middleInner.click();
  await a.keyboard.press("Home");
  await a.keyboard.press("ArrowDown"); // the caret lands on the empty middle line
  const before = await outCount(a, "a");
  await a.keyboard.press("Enter");
  expect(await a.evaluate((q) => window.__paneDocs?.a?.getText(q) ?? null, middleId)).toBe("a\n\n\nc");
  expect((await blockOf(a, "a", middleId))?.type).toBe("quote");
  expect(await outCount(a, "a")).toBe(before + 1);
  await close();
});

test("Enter on a wholly empty quote converts it to a paragraph in place", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux13-quote-empty-enter");
  const quoteId = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    return doc.insertBlock("quote");
  });
  expect(quoteId).not.toBeNull();
  await a.waitForTimeout(600);

  const quoteInner = a.locator(`[data-block-id="${quoteId}"] [data-slot="docblocks/block-content"]`);
  await quoteInner.click();
  await a.keyboard.press("Enter");

  expect((await blockOf(a, "a", quoteId))?.type).toBe("paragraph");
  expect((await rootIds(a, "a")).length).toBe(2); // root + the converted block
  await close();
});

test("Backspace at the start of a non-empty quote never merges; the empty quote resets to a paragraph", async ({
  browser,
}) => {
  const { a, b, close } = await openPanes(browser, "ux14-quote-backspace");
  const ids = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    const prev = doc.insertBlock("paragraph");
    doc.insertText(prev, 0, "prev");
    const q = doc.insertBlock("quote");
    doc.insertText(q, 0, "abc");
    return { prev, q };
  });
  await a.waitForTimeout(600);

  const quoteInner = a.locator(`[data-block-id="${ids.q}"] [data-slot="docblocks/block-content"]`);
  await quoteInner.click();
  await a.keyboard.press("Home");

  // Backspace at offset 0: no merge — the quote stands with its text, the
  // previous block is untouched (nothing deletes backwards past the start).
  await a.keyboard.press("Backspace");
  expect(await rootIds(a, "a")).toHaveLength(3); // the pane's starter + prev + the quote
  expect(await a.evaluate((q) => window.__paneDocs?.a?.getText(q) ?? null, ids.q)).toBe("abc");
  expect(await a.evaluate((p) => window.__paneDocs?.a?.getText(p) ?? null, ids.prev)).toBe("prev");

  // From the end the characters delete in place (the browser's in-block
  // default, committed by the input diff) until the quote is empty; the
  // next Backspace then resets it to a paragraph.
  await a.keyboard.press("End");
  await a.keyboard.press("Backspace");
  await a.keyboard.press("Backspace");
  await a.keyboard.press("Backspace");
  expect(await a.evaluate((q) => window.__paneDocs?.a?.getText(q) ?? null, ids.q)).toBe("");
  await a.keyboard.press("Backspace");
  expect((await blockOf(a, "a", ids.q))?.type).toBe("paragraph");
  expect(await rootIds(a, "a")).toHaveLength(3); // the starter + prev + the converted paragraph
  // The reset traveled the wire — wait for B to stand the paragraph (one-shot
  // reads can catch B mid-convergence under full-suite load).
  await expect.poll(async () => (await blockOf(b, "b", ids.q))?.type, SETTLE).toBe("paragraph");
  await close();
});

test("the callout shares the quote interactivity", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "ux15-quote-callout");
  const calloutId = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    const c = doc.insertBlock("callout");
    doc.insertText(c, 0, "one");
    return c;
  });
  await a.waitForTimeout(600); // the enter animations settle (boxes move with them)

  const calloutInner = a.locator(`[data-block-id="${calloutId}"] [data-slot="docblocks/block-content"]`);
  const outBefore = await outCount(a, "a");

  // Backspace at offset 0 of a non-empty callout: no merge, no wire update.
  await calloutInner.click();
  await a.keyboard.press("Home");
  await a.keyboard.press("Backspace");
  await expect.poll(async () => outCount(a, "a")).toBe(outBefore);
  expect(await a.evaluate((c) => window.__paneDocs?.a?.getText(c) ?? null, calloutId)).toBe("one");
  expect((await blockOf(a, "a", calloutId))?.type).toBe("callout");

  // Enter is a line break (no split); from the empty last line it exits:
  // the lines stand as the callout, a new paragraph takes the caret.
  await a.keyboard.press("End");
  await a.keyboard.press("Enter"); // line break
  await a.keyboard.type("two");
  await a.keyboard.press("Enter"); // line break after "two"
  await a.keyboard.press("Enter"); // the exit
  expect((await blockOf(a, "a", calloutId))?.type).toBe("callout");
  expect(await a.evaluate((c) => window.__paneDocs?.a?.getText(c) ?? null, calloutId)).toBe("one\ntwo");
  const ids = await rootIds(a, "a");
  expect(ids).toHaveLength(3); // the starter + the callout + the new paragraph
  expect(ids[1]).toBe(calloutId);
  expect((await blockOf(a, "a", ids[2]!))?.type).toBe("paragraph");
  // The caret stands in the new paragraph (the gesture's focus move).
  await expect(a.locator(`[data-block-id="${ids[2]!}"] [data-slot="docblocks/block-content"]`)).toBeFocused();
  // The exit traveled the wire — wait for B to stand the callout + text
  // (one-shot reads can catch B mid-convergence).
  await expect.poll(async () => (await blockOf(b, "b", calloutId))?.type, SETTLE).toBe("callout");
  await expect
    .poll(async () => await b.evaluate((c) => window.__paneDocs?.b?.getText(c) ?? null, calloutId), SETTLE)
    .toBe("one\ntwo");
  await close();
});

test("the rule stands on the checkbox's axis, from the first line to the last", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "ux15-quote-rule");
  const ids = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    const li = doc.insertBlock("list-item", { list: "task" });
    doc.insertText(li, 0, "task row");
    const q = doc.insertBlock("quote");
    doc.insertText(q, 0, "first line\nsecond line\nthird line");
    return { li, q };
  });
  await a.waitForTimeout(600);

  const checkbox = a.locator(`[data-block-id="${ids.li}"] [data-slot="docblocks/checkbox"]`);
  await expect(checkbox).toBeVisible();
  const quote = a.locator(`[data-block-id="${ids.q}"]`);
  const rule = quote.locator('[data-slot="docblocks/quote-rule"]');
  await expect(rule).toHaveCount(1);
  await expect(b.locator(`[data-block-id="${ids.q}"] [data-slot="docblocks/quote-rule"]`)).toHaveCount(1);

  const checkboxBox = await checkbox.boundingBox();
  const ruleBox = await rule.boundingBox();
  const innerBox = await quote.locator('[data-slot="docblocks/block-content"]').boundingBox();
  expect(checkboxBox).not.toBeNull();
  expect(ruleBox).not.toBeNull();
  expect(innerBox).not.toBeNull();
  if (checkboxBox !== null && ruleBox !== null && innerBox !== null) {
    // The same vertical axis: the rule's left edge stands at the checkbox's
    // left edge (the marker zone's left edge).
    expect(Math.abs(ruleBox.x - checkboxBox.x)).toBeLessThanOrEqual(2);
    // Continuous over the block: the rule spans the inner's full height
    // (the first line's top to the last line's bottom).
    expect(Math.abs(ruleBox.y - innerBox.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(ruleBox.y + ruleBox.height - (innerBox.y + innerBox.height))).toBeLessThanOrEqual(2);
  }
  await close();
});
