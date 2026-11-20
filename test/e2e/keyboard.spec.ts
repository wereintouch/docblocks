import { type Page, expect, test } from "@playwright/test";

import { SETTLE, insertBlockType, pasteFromClipboard, seedClipboardPayload, twoPanes } from "./helpers";

/** The inner contenteditables of the pane's text blocks, in order. */
function inners(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`);
}

/** Press Shift+ArrowLeft n times, one by one (discrete presses coalesce otherwise). */
async function selectLeft(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await page.keyboard.press("Shift+ArrowLeft");
}

test("ArrowDown at the text end moves the caret to the next block", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui04-arrow");

  // The sharing's grant (the default is off — the privacy stand): A flips
  // to "everyone" (the plaintext stand) before the caret lands.
  await a.getByTestId("share-a-everyone").click();

  // The room starts with pane "a"'s single starter.
  await expect(inners(a, "a")).toHaveCount(1);
  const first = inners(a, "a").first();
  await first.click();
  await a.keyboard.type("one");
  await expect(inners(b, "b").first()).toHaveText("one");
  await insertBlockType(a, "a", "paragraph");
  await expect(inners(a, "a")).toHaveCount(2);

  // Caret to the end, ArrowDown: the caret moves to the start of the next
  // (empty) block — B's presence line shows it at offset 0.
  await a.keyboard.press("End");
  await a.keyboard.press("ArrowDown");
  const nextId = await inners(a, "a").nth(1).getAttribute("data-block-id");
  expect(nextId).not.toBe(null);
  await expect.poll(() => b.getByTestId("presence-b").innerText(), SETTLE).toContain(`a:${nextId}:0`);

  await close();
});

test("mod+b toggles the selected range bold in the other pane", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui04-bold");

  const first = inners(a, "a").first();
  await first.click();
  await a.keyboard.type("one");
  const id = (await first.getAttribute("data-block-id")) ?? "";
  expect(id).not.toBe("");

  // Select "one" (End + 3x Shift+ArrowLeft) and bold it (Control for a
  // platform-stable hotkey). The assertions read pane B's DOM (the local
  // pane does not re-render mark-only changes while the selection is
  // inside the block).
  await a.keyboard.press("End");
  await selectLeft(a, 3);
  await a.keyboard.press("Control+b");
  await expect(b.locator(`[data-block-id="${id}"] strong`)).toHaveText("one");

  // The selection survived the store-driven change: a second mod+b over the
  // same range unsets the mark.
  await a.keyboard.press("Control+b");
  await expect(b.locator(`[data-block-id="${id}"] strong`)).toHaveCount(0);
  await expect(inners(b, "b").first()).toHaveText("one");

  await close();
});

test("Shift+Enter inserts a line break in the run text (synced, not a new block)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui04-softbreak");

  // The store text of the first block (both panes seed the same room, so
  // the first non-root block is shared). The DOM carries a rendered-only
  // line anchor, so the store (not the raw textContent) is the assertion
  // target.
  const firstText = (page: Page, client: "a" | "b") =>
    page.evaluate((c) => {
      const d = window.__paneDocs?.[c];
      if (d === null || d === undefined) throw new Error(`the ${c} pane's doc is not mounted`);
      const firstId = d.getChildren(d.toJSON().id)[0]!;
      const block = d.getBlock(firstId);
      return (block?.content ?? []).map((r) => r.text).join("");
    }, client);

  const first = inners(a, "a").first();
  await first.click();
  await a.keyboard.type("line one");
  await a.keyboard.press("Shift+Enter");
  await a.keyboard.type("line two");

  // The break is a \n inside the run text of the same block: the block
  // count is unchanged (root + the single starter) and both panes carry the
  // break in the store text.
  await expect.poll(() => a.evaluate(() => Object.keys(window.__paneDocs!.a!.toJSON().blocks).length), SETTLE).toBe(2);
  await expect.poll(() => firstText(a, "a"), SETTLE).toBe("line one\nline two");
  await expect.poll(() => firstText(b, "b"), SETTLE).toBe("line one\nline two");

  // The break renders as a real line break: the inner is pre-wrap and
  // its box spans two text lines. The box read is polled: the DOM
  // rebuild after the last keystroke reflows asynchronously, and a
  // synchronous read right after the input can catch the pre-break box.
  let box: { whiteSpace: string; lines: number } | undefined;
  await expect
    .poll(async () => {
      box = await first.evaluate((el) => {
        const style = getComputedStyle(el);
        const line = parseFloat(style.lineHeight);
        return { whiteSpace: style.whiteSpace, lines: el.getBoundingClientRect().height / line };
      });
      return box.lines;
    })
    .toBeCloseTo(2, 1);
  expect(box!.whiteSpace).toBe("pre-wrap");

  // Backspace across the break: deleting "line two" (8 chars) keeps the
  // break; one more deletes the break and merges to the previous line.
  for (let i = 0; i < 8; i++) await a.keyboard.press("Backspace");
  await expect.poll(() => firstText(a, "a"), SETTLE).toBe("line one\n");
  await a.keyboard.press("Backspace");
  await expect.poll(() => firstText(a, "a"), SETTLE).toBe("line one");
  await expect.poll(() => firstText(b, "b"), SETTLE).toBe("line one");

  await close();
});

test("the select-all's copy-paste replaces the selection (the document stands, nothing dropped)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ux10-select-all-paste", {
    permissions: ["clipboard-read", "clipboard-write"],
  });

  // Seed three paragraphs (the starter + two inserts).
  const first = inners(a, "a").first();
  await first.click();
  await a.keyboard.type("first line");
  await insertBlockType(a, "a", "paragraph");
  await inners(a, "a").nth(1).click();
  await a.keyboard.type("second line");
  await insertBlockType(a, "a", "paragraph");
  await inners(a, "a").nth(2).click();
  await a.keyboard.type("third line");
  await expect(inners(a, "a")).toHaveCount(3);
  await expect(inners(b, "b")).toHaveCount(3);

  // The Ctrl+A's stand (the editor's own select-all over the nested
  // editables' degenerate native stand — the caret's end's move stands
  // replaced): the full cross-block's selection.
  await a.keyboard.press("Control+a");
  const selection = await a.evaluate(() => {
    const s = window.getSelection();
    if (s === null) return { collapsed: true, rangeCount: 0 };
    return { collapsed: s.isCollapsed, rangeCount: s.rangeCount };
  });
  expect(selection.collapsed).toBe(false);
  expect(selection.rangeCount).toBe(1);

  // The copy's stand (the cross's serialization's shape — one div per
  // block + the plain's join; the headless engine's no-write from the
  // keyboard's copy) + the paste (the full-selection's replace: the
  // document's content stands, nothing dropped — the v1 edge's drop
  // stands removed).
  const payload = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return null;
    const order = doc.getChildren(doc.toJSON().id);
    const texts = order
      .map((id) => doc.getBlock(id)?.content)
      .filter((content) => content !== undefined && content !== null)
      .map((content) => (content as { text: string }[]).map((run) => run.text).join(""));
    return { html: texts.map((text) => `<div>${text}</div>`).join(""), plain: texts.join("\n") };
  });
  expect(payload, "the pane's doc should stand for the payload's build").not.toBeNull();
  await seedClipboardPayload(a, payload!);
  await pasteFromClipboard(a);
  await expect(inners(a, "a")).toHaveCount(3);
  await expect(inners(a, "a").nth(0)).toHaveText("first line");
  await expect(inners(a, "a").nth(1)).toHaveText("second line");
  await expect(inners(a, "a").nth(2)).toHaveText("third line");
  await expect(inners(b, "b")).toHaveCount(3);
  await expect(inners(b, "b").nth(2)).toHaveText("third line");

  // The undo's restore (the replace's one step's stand).
  await a.keyboard.press("Control+z");
  await expect(inners(a, "a")).toHaveCount(3);
  await expect(inners(a, "a").nth(1)).toHaveText("second line");

  await close();
});

/**
 * The pane's scroller (the consumer-owned scroll container — the editor's
 * content overflows the pane's fixed height): the nearest scrollable
 * ancestor of the pane's host.
 */
async function paneScroller(page: Page, client: "a" | "b"): Promise<{ scrollTop: number; max: number } | null> {
  return page.evaluate((client) => {
    const host = document.querySelector(`[data-testid="doc-${client}"]`);
    if (host === null) return null;
    let sc: HTMLElement | null = host.querySelector('[data-slot="docblocks/editor"]');
    while (sc !== null && !(sc.scrollHeight > sc.clientHeight + 4)) sc = sc.parentElement;
    if (sc === null) return null;
    return { scrollTop: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight };
  }, client);
}

test("ctrl+home / ctrl+end seat the caret over the document's edges (the scroller's stand)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "doc-edges-caret");

  // Seed a tall doc (30 lines — the pane's overflow's stand).
  const first = inners(a, "a").first();
  await first.click();
  await a.keyboard.type("line 00");
  for (let i = 1; i < 30; i += 1) {
    await insertBlockType(a, "a", "paragraph");
    await inners(a, "a").nth(i).click();
    await a.keyboard.type(`line ${String(i).padStart(2, "0")}`);
  }
  await expect(inners(a, "a")).toHaveCount(30);

  // Click a mid-doc line (the scroller's mid position's stand), then the
  // document's edge's keys: the caret's seat + the scroller's stand (the
  // programmatic seat stands no native scroll — the editor's own). The
  // scroller's top clamp stands the pane's chrome over the content (the
  // scrollTop's 0's no-reach's stand), so the assertions stand the
  // relative's positions (the mid's over the home's, the end's over the
  // max's) + the caret's seats (the exact's stand).
  const mid = inners(a, "a").nth(15);
  await mid.scrollIntoViewIfNeeded();
  await mid.click();
  const midScroll = (await paneScroller(a, "a"))!;
  expect(midScroll.scrollTop).toBeGreaterThan(100);

  await a.keyboard.press("Control+Home");
  const firstId = (await inners(a, "a").first().getAttribute("data-block-id"))!;
  await expect
    .poll(async () =>
      a.evaluate(() => {
        const s = window.getSelection();
        if (s === null || s.rangeCount === 0) return null;
        const r = s.getRangeAt(0);
        const innerEl = (r.startContainer.parentElement ?? null)?.closest('[data-slot="docblocks/block-content"]');
        return innerEl !== undefined && innerEl !== null
          ? { id: innerEl.getAttribute("data-block-id"), offset: r.startOffset, collapsed: s.isCollapsed }
          : null;
      })
    )
    .toEqual({ id: firstId, offset: 0, collapsed: true });
  const homeScroll = await paneScroller(a, "a");
  expect(homeScroll!.scrollTop).toBeLessThan(midScroll.scrollTop / 2);
  // The first line's view's stand (the scroll's to-the-top's effect).
  const firstRect = (await inners(a, "a").first().boundingBox())!;
  const paneRect = (await a.locator('[data-testid="doc-a"]').boundingBox())!;
  expect(firstRect.y).toBeLessThan(paneRect.y + 200);

  await a.keyboard.press("Control+End");
  const lastId = (await inners(a, "a").last().getAttribute("data-block-id"))!;
  await expect
    .poll(async () =>
      a.evaluate(() => {
        const s = window.getSelection();
        if (s === null || s.rangeCount === 0) return null;
        const r = s.getRangeAt(0);
        const innerEl = (r.startContainer.parentElement ?? null)?.closest('[data-slot="docblocks/block-content"]');
        return innerEl !== undefined && innerEl !== null
          ? { id: innerEl.getAttribute("data-block-id"), offset: r.startOffset, collapsed: s.isCollapsed }
          : null;
      })
    )
    .toEqual({ id: lastId, offset: 7, collapsed: true });
  const endScroll = await paneScroller(a, "a");
  // The bottom's clamp's stand (the page's bottom padding's allowance —
  // the last line's bottom stands the padding over the content's bottom).
  expect(endScroll!.scrollTop).toBeGreaterThanOrEqual(endScroll!.max - 100);

  await close();
});
