import { type Browser, type Page, expect, test } from "@playwright/test";

import { RELAY, editorContext, outCount } from "./helpers";

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
  const contextA = await editorContext(browser);
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

  const outBefore = await outCount(a, "a");
  await a.locator('[data-slot="docblocks/format-toolbar"] button[aria-label="Bold"]').click();
  expect(await outCount(a, "a")).toBe(outBefore + 1);

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

test("a click-then-shift+click extends the selection across the blocks (the native extension's stand)", async ({
  browser,
}) => {
  const { a, close } = await openPanes(browser, "ux09-sel-shift-click");
  const target = inner(a);
  await target.click();
  await a.keyboard.type("first word");
  await a.keyboard.press("Enter");
  await a.keyboard.type("second word");
  await a.keyboard.press("Enter");
  await a.keyboard.type("third word");
  const blocks = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]');
  await expect(blocks).toHaveCount(3);

  // The anchor's press (the plain click's stand — the caret at the first
  // block's start over the Home's seat).
  await blocks.first().click();
  await a.keyboard.press("Home");
  await a.waitForTimeout(200);

  // The shift+click at the third block's end: the browser's native
  // extension stands (the session's tear-down over the shift's press —
  // the default's suppression stands off), the selection spans the
  // blocks, and the focus stands in the editor (the document's body's
  // stand stands removed over the suppressed press's no-stand).
  const thirdBox = await blocks.nth(2).boundingBox();
  if (thirdBox === null) throw new Error("the third's box is missing");
  await blocks.nth(2).click({ modifiers: ["Shift"], position: { x: thirdBox.width - 6, y: thirdBox.height / 2 } });
  const sel = await a.evaluate(() => {
    const s = window.getSelection();
    if (s === null) return null;
    const nodeBlock = (node: Node | null): string | null => {
      const inner = node instanceof Element ? node : (node?.parentElement ?? null);
      return inner?.closest('[data-slot="docblocks/block-content"]')?.getAttribute("data-block-id") ?? null;
    };
    return {
      collapsed: s.isCollapsed,
      anchorBlock: nodeBlock(s.anchorNode),
      focusBlock: nodeBlock(s.focusNode),
      active: document.activeElement?.tagName ?? null,
    };
  });
  expect(sel, "the shift+click should stand a cross-block selection").not.toBeNull();
  expect(sel!.collapsed).toBe(false);
  const order = await a.evaluate((c) => {
    const doc = window.__paneDocs?.[c as "a" | "b"] ?? null;
    if (doc === null) return [];
    return doc.getChildren(doc.toJSON().id);
  }, "a");
  expect(sel!.anchorBlock).toBe(order[0]);
  expect(sel!.focusBlock).toBe(order[order.length - 1]);
  expect(sel!.active).not.toBe("BODY");
  await close();
});
