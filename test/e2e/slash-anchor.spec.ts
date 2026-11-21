// The slash menu's placement: the anchor's geometry at the "/" character (the below-line's
// stand), the above's flip over the viewport's overrun (the bounded list's scroll), and the
// page's no-scroll over the menu's open and the keyboard's walk.
import { type Browser, type Page, expect, test } from "@playwright/test";

import { RELAY, editorContext } from "./helpers";

/**
 * A unique room per test: the relay keeps rooms for the dev server's
 * lifetime, so a fixed name would accumulate the content of failed attempts
 * across runs.
 */
async function openPanes(browser: Browser, seed: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await editorContext(browser);
  const contextB = await editorContext(browser);
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

function inner(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`).first();
}

function menu(page: Page) {
  return page.locator('[data-slot="docblocks/slash-menu"]');
}

/** The rect of the block's "/" character (the flat offset `slashOffset` of its logical text; null when the pane or text node is missing). The optional `blockId` scopes the read (the default is the pane's first block). */
async function slashRect(
  page: Page,
  client: "a" | "b",
  slashOffset: number,
  blockId?: string
): Promise<{ left: number; bottom: number; top: number } | null> {
  return page.evaluate(
    ([c, offset, bid]) => {
      const scope =
        bid === undefined
          ? document.querySelector(`[data-testid="doc-${c}"]`)
          : document.querySelector(`[data-testid="doc-${c}"] [data-block-id="${bid}"]`);
      const innerEl = scope?.querySelector('[data-slot="docblocks/block-content"]');
      if (innerEl === null || innerEl === undefined) return null;
      const textNode = Array.from(innerEl.childNodes).find((n) => n.nodeType === Node.TEXT_NODE) as Text | undefined;
      if (textNode === undefined || offset >= textNode.length) return null;
      const range = document.createRange();
      range.setStart(textNode, offset);
      range.setEnd(textNode, offset + 1);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, bottom: rect.bottom, top: rect.top };
    },
    [client, slashOffset, blockId] as const
  );
}

test("the menu stands at the / — below the line at the character's left edge", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "slash-anchor");
  const target = inner(a, "a");
  await target.click();
  await a.keyboard.type("ab/");
  await expect(menu(a)).toBeVisible();

  // The anchor is the "/" character itself (offset 2), not the block's
  // corner: the menu's top-left stands at the character's left edge, below
  // its line.
  const rect = await slashRect(a, "a", 2);
  const box = await menu(a).boundingBox();
  expect(rect).not.toBeNull();
  expect(box).not.toBeNull();
  if (rect !== null && box !== null) {
    expect(Math.abs(box.x - rect.left)).toBeLessThanOrEqual(4);
    expect(Math.abs(box.y - rect.bottom)).toBeLessThanOrEqual(4);
  }
  await close();
});

test("the menu flips above the line when the below placement does not fit (the bounded list scrolls)", async ({
  browser,
}) => {
  const { a, close } = await openPanes(browser, "slash-flip");

  // A tall page: the last block sits at the viewport's bottom once scrolled.
  const lastId = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return null;
    let id = "";
    doc.transact(() => {
      for (let i = 0; i < 24; i += 1) id = doc.insertBlock("paragraph");
    });
    return id;
  });
  expect(lastId).not.toBeNull();
  const blockInner = a.locator(`[data-block-id="${lastId}"] [data-slot="docblocks/block-content"]`);
  await blockInner.evaluate((el) => el.scrollIntoView({ block: "end" }));
  await blockInner.click();

  await a.keyboard.press("/");
  await expect(menu(a)).toBeVisible();

  // The below placement would overrun the viewport bottom: the menu's
  // bottom stands at the "/" character's top (above the line), bounded
  // by the list's max height (the flip stays close to the caret).
  const rect = await slashRect(a, "a", 0, lastId!);
  const box = await menu(a).boundingBox();
  expect(rect).not.toBeNull();
  expect(box).not.toBeNull();
  if (rect !== null && box !== null) {
    expect(Math.abs(box.y + box.height - rect.top)).toBeLessThanOrEqual(4);
    expect(box.height).toBeLessThanOrEqual(324);
  }
  const scroll = await menu(a).evaluate((el) => ({ scrollable: el.scrollHeight > el.clientHeight }));
  expect(scroll.scrollable).toBe(true);
  await close();
});

test("the menu open does not scroll the page (the unpositioned first frame must not pull it)", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "slash-no-scroll");

  // A tall page; the caret at the middle (the below placement).
  const midId = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return null;
    doc.transact(() => {
      for (let i = 0; i < 40; i += 1) doc.insertBlock("paragraph");
    });
    const ids = doc.getChildren(doc.meta.id);
    return ids[15];
  });
  expect(midId).not.toBeNull();
  const blockInner = a.locator(`[data-block-id="${midId}"] [data-slot="docblocks/block-content"]`);
  await blockInner.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await blockInner.click();
  const scrollBefore = await a.evaluate(() => window.scrollY);

  await a.keyboard.press("/");
  await expect(menu(a)).toBeVisible();
  expect(await a.evaluate(() => window.scrollY)).toBe(scrollBefore);
  // Keyboard navigation scrolls the menu's own overflow, still not the page.
  for (let i = 0; i < 11; i += 1) await a.keyboard.press("ArrowDown");
  expect(await a.evaluate(() => window.scrollY)).toBe(scrollBefore);
  await close();
});
