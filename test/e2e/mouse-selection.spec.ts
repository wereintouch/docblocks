import { type Browser, type Page, expect, test } from "@playwright/test";

const RELAY = "ws://localhost:5199";

/**
 * The mouse selection gestures: a double-click selects the word under the
 * pointer (across the runs' mark boundaries — the word is a whitespace unit
 * of the block's text, not one inline node), a triple-click selects the
 * whole block (all the soft-break lines), and the floating toolbar stands
 * over the selection (a mark applied from it is one transact over the
 * selection, the selection stands).
 *
 * The clicks are synthetic (CDP), whose pointer events stand detail 0: the
 * editor's cross-drag session therefore stands on the multi-click press
 * and is torn down by its mousedown handler (the mousedown's own detail
 * stands the real count) — the browser's native word/paragraph select is
 * the selection writer.
 */

/**
 * A unique room per test: the relay keeps rooms for the dev server's
 * lifetime, so a fixed name would accumulate the content of failed attempts
 * across runs.
 */
async function openPanes(browser: Browser, seed: string): Promise<{ a: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await browser.newContext();
  const a = await contextA.newPage();
  await a.goto(`/?client=a&syncUrl=${RELAY}/${room}`);
  await expect(a.getByTestId("status-a")).toHaveText("connected");
  return {
    a,
    close: async () => {
      await contextA.close();
    },
  };
}

function inner(page: Page) {
  return page.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
}

function toolbar(page: Page) {
  return page.locator('[data-slot="docblocks/format-toolbar"]');
}

/** The pane's wire-log outbound doc-update count (awareness frames are not logged). */
async function outCount(page: Page): Promise<number> {
  const text = await page.getByTestId("wire-a").innerText();
  return text.match(/\] out \d+B/g)?.length ?? 0;
}

/** The DOM selection (the mouse gestures' contract level). */
async function selState(page: Page): Promise<{ collapsed: boolean; text: string }> {
  return page.evaluate(() => {
    const s = window.getSelection();
    if (s === null) return { collapsed: true, text: "" };
    return { collapsed: s.isCollapsed, text: s.toString() };
  });
}

/**
 * Type a single long word so the element-center click stands over the word
 * (the starter text is short and stands at the line's left edge — the row's
 * center is past it, in the empty band).
 */
async function seedLongWord(page: Page): Promise<void> {
  const target = inner(page);
  await target.click();
  await page.keyboard.press("End");
  await page.keyboard.type("abcdefghijklmnopqrstuvwxyzzzzzzzzzzzzzzzzzz");
  await expect(target).toHaveText(/z+$/);
}

/** The inner's content-box center (the click point over the word). */
async function center(page: Page): Promise<{ x: number; y: number }> {
  const box = await inner(page).boundingBox();
  if (box === null) throw new Error("the inner box is missing");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("a double-click selects the word and the toolbar stands over it", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux09-sel-dbl");
  await seedLongWord(a);

  const { x, y } = await center(a);
  await a.mouse.dblclick(x, y);

  const innerText = await inner(a).innerText();
  const selection = await selState(a);
  expect(selection.collapsed).toBe(false);
  expect(selection.text).toBe(innerText);
  await expect(toolbar(a)).toBeVisible();
  await close();
});

test("a double-click on a mark-split word selects the whole word", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux09-sel-dbl-marks");
  await seedLongWord(a);

  // Bold the word's middle: the word stands plain/bold/plain runs.
  const wordLen = (await inner(a).innerText()).length;
  await a.evaluate((len) => {
    const innerEl = document.querySelector('[data-testid="doc-a"] [data-slot="docblocks/block-content"]');
    if (innerEl === null) return;
    const textNode = Array.from(innerEl.childNodes).find((n) => n.nodeType === Node.TEXT_NODE) as Text | undefined;
    if (textNode === undefined) return;
    const sel = window.getSelection();
    if (sel === null) return;
    sel.setBaseAndExtent(textNode, Math.floor(len / 3), textNode, Math.floor((2 * len) / 3));
  }, wordLen);
  await a.locator('[data-slot="docblocks/format-toolbar"] button[aria-label="Bold"]').click();
  await expect(inner(a).locator("strong")).not.toHaveCount(0);

  // The double-click crosses the mark boundaries: the whole word stands.
  const { x, y } = await center(a);
  await a.mouse.dblclick(x, y);
  const selection = await selState(a);
  expect(selection.collapsed).toBe(false);
  expect(selection.text).toBe(await inner(a).innerText());
  await expect(toolbar(a)).toBeVisible();
  await close();
});

test("a triple-click selects the whole block and the toolbar stands over it", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux09-sel-tri");
  await seedLongWord(a);

  const { x, y } = await center(a);
  await a.mouse.click(x, y, { clickCount: 3 });

  const selection = await selState(a);
  expect(selection.collapsed).toBe(false);
  expect(selection.text).toBe(await inner(a).innerText());
  await expect(toolbar(a)).toBeVisible();
  await close();
});

test("a triple-click on a soft-break block selects all its lines", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux09-sel-tri-lines");

  // A two-line block: the starter text + a soft break + a second line.
  const target = inner(a);
  await target.click();
  await a.keyboard.type("first line word");
  await a.keyboard.press("Shift+Enter");
  await a.keyboard.type("second line word");
  const fullText = await target.innerText();
  expect(fullText).toContain("\n");

  const { x, y } = await center(a);
  await a.mouse.click(x, y, { clickCount: 3 });

  const selection = await selState(a);
  expect(selection.collapsed).toBe(false);
  expect(selection.text.replace(/\n/g, "")).toBe(fullText.replace(/\n/g, ""));
  await expect(toolbar(a)).toBeVisible();
  await close();
});

test("a mark from the toolbar over the double-click selection is one transact and keeps the selection", async ({
  browser,
}) => {
  const { a, close } = await openPanes(browser, "ux09-sel-toolbar");
  await seedLongWord(a);

  const { x, y } = await center(a);
  await a.mouse.dblclick(x, y);
  await expect(toolbar(a)).toBeVisible();

  const outBefore = await outCount(a);
  await a.locator('[data-slot="docblocks/format-toolbar"] button[aria-label="Bold"]').click();
  expect(await outCount(a)).toBe(outBefore + 1);

  // The selection stands (the mark-only change re-renders the text in
  // place) and the whole word is bold in the doc.
  const selection = await selState(a);
  expect(selection.collapsed).toBe(false);
  expect(selection.text).toBe(await inner(a).innerText());
  const runs = await a.evaluate((c) => {
    const doc = window.__paneDocs?.[c as "a" | "b"] ?? null;
    if (doc === null) return null;
    const order = doc.getChildren(doc.toJSON().id);
    return order.map((id) => doc.getBlock(id)?.content).find((content) => content !== undefined && content.length > 0);
  }, "a");
  expect(runs?.every((run) => "bold" in (run.marks ?? {}))).toBe(true);
  await close();
});
