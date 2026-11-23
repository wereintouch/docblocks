import { type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, insertBlockType, openPane, twoPanes } from "./helpers";

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** The inner contenteditables of the pane's text blocks, in order. */

function inners(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-slot="docblocks/block-content"]');
}

/** The pane's block wrappers (the inner editables are not blocks). */

async function leftKeys(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await page.keyboard.press("ArrowLeft");
}

test("Enter splits the block in both panes and the caret lands in the tail", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03b-enter");

  // The sharing's grant (the default is off — the privacy stand): A flips
  // to "everyone" (the plaintext stand) before the caret lands.
  await a.getByTestId("share-a-everyone").click();

  // The room starts with pane "a"'s single starter (seeded once after the
  // sync settles — a reload never re-seeds a non-empty room).
  await expect(inners(a, "a")).toHaveCount(1);
  const beforeInners = await inners(a, "a").count();

  const first = inners(a, "a").first();
  await first.click();
  await a.keyboard.type("hello world");
  await expect(inners(b, "b").first()).toHaveText("hello world");

  // Caret to offset 6, then split: "hello " / "world".
  await a.keyboard.press("End");
  await leftKeys(a, 5);
  await a.keyboard.press("Enter");

  await expect(inners(a, "a")).toHaveCount(beforeInners + 1);
  await expect(inners(b, "b")).toHaveCount(beforeInners + 1);
  await expect(inners(a, "a").first()).toHaveText("hello");
  await expect(inners(a, "a").nth(1)).toHaveText("world");
  await expect(inners(b, "b").first()).toHaveText("hello");
  await expect(inners(b, "b").nth(1)).toHaveText("world");

  // The caret is in the new block at offset 0 — B's presence line shows it.
  const tailId = await inners(a, "a").nth(1).getAttribute("data-block-id");
  expect(tailId).not.toBe(null);
  await expect.poll(() => b.getByTestId("presence-b").innerText(), SETTLE).toContain(`a:${tailId}:0`);

  await close();
});

test("Backspace at the block start merges into the previous block", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03b-backspace");

  // The room starts with pane "a"'s single starter.
  await expect(inners(a, "a")).toHaveCount(1);
  const beforeInners = await inners(a, "a").count();

  const first = inners(a, "a").first();
  await first.click();
  await a.keyboard.type("hello world");
  await a.keyboard.press("End");
  await leftKeys(a, 5);
  await a.keyboard.press("Enter");
  await expect(inners(a, "a")).toHaveCount(beforeInners + 1);

  const second = inners(a, "a").nth(1);
  await second.click();
  await a.keyboard.press("Home");
  await a.keyboard.press("Backspace");

  await expect(inners(a, "a")).toHaveCount(beforeInners);
  await expect(inners(a, "a").first()).toHaveText("hello world");
  await expect(inners(b, "b")).toHaveCount(beforeInners);
  await expect(inners(b, "b").first()).toHaveText("hello world");

  await close();
});

test("Backspace on an empty root list item resets its type in place (one undo step)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03b-bs-reset");

  // The room's starter plus an empty bullet item (the pane's doc handle).
  await expect(inners(a, "a")).toHaveCount(1);
  const item = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) throw new Error("the pane's doc is not mounted");
    return d.insertBlock("list-item", { list: "bullet" });
  });
  if (item === null) throw new Error("the insert returned no id");
  await expect(inners(a, "a")).toHaveCount(2);

  const inner = inners(a, "a").nth(1);
  await inner.click();
  await a.keyboard.press("Backspace");

  // The reset is in place (the same block id, now a paragraph), one undo
  // step restores the list item, and the reset reached pane B.
  await expect
    .poll(async () => a.evaluate((id) => window.__paneDocs?.a?.getBlock(id)?.type, item), SETTLE)
    .toBe("paragraph");
  await expect
    .poll(async () => b.evaluate((id) => window.__paneDocs?.b?.getBlock(id)?.type, item), SETTLE)
    .toBe("paragraph");
  await expect(inners(a, "a")).toHaveCount(2);

  await inner.click();
  await a.keyboard.press("Control+z");
  await expect
    .poll(async () => a.evaluate((id) => window.__paneDocs?.a?.getBlock(id)?.type, item), SETTLE)
    .toBe("list-item");

  await close();
});

test("Backspace on an empty child list item outdents; on an empty root paragraph it removes", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ui03b-bs-outdent");

  // Ladder: the starter paragraph, a bullet item, an empty child bullet
  // (indent 1).
  await expect(inners(a, "a")).toHaveCount(1);
  const ids = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) throw new Error("the pane's doc is not mounted");
    const parent = d.insertBlock("list-item", { list: "bullet" });
    const child = d.insertBlock("list-item", { list: "bullet", indent: 1 });
    return { parent, child };
  });
  await expect(inners(a, "a")).toHaveCount(3);

  // Backspace on the empty child (a non-paragraph type): the type resets
  // to a plain paragraph first, the indent stands.
  await inners(a, "a").nth(2).click();
  await a.keyboard.press("Backspace");
  await expect
    .poll(
      async () =>
        a.evaluate((id) => {
          const d = window.__paneDocs?.a ?? null;
          if (d === null) return null;
          const block = d.getBlock(id);
          return block === null ? null : { type: block.type, indent: block.attrs?.indent ?? 0 };
        }, ids.child),
      SETTLE
    )
    .toMatchObject({ type: "paragraph", indent: 1 });
  // The type reset remounts the row (li -> div): wait for the caret to be
  // re-seated in the new contenteditable before the next key. The seat is
  // read over the live selection's anchor (the page's single editable's
  // focus is the container).
  const innerSeat = (n: number) =>
    a.evaluate((idx) => {
      const selection = window.getSelection();
      if (selection === null || selection.anchorNode === null) return false;
      const inner = document.querySelectorAll<HTMLElement>(
        '[data-testid="doc-a"] [data-slot="docblocks/block-content"]'
      )[idx];
      return inner !== undefined && inner.contains(selection.anchorNode);
    }, n);
  await expect.poll(() => innerSeat(2)).toBe(true);

  // The next Backspace outdents (the type stands: a paragraph at the root
  // level).
  await a.keyboard.press("Backspace");
  await expect
    .poll(async () => a.evaluate((id) => window.__paneDocs?.a?.getBlock(id)?.type, ids.child), SETTLE)
    .toBe("paragraph");
  await expect
    .poll(
      async () =>
        a.evaluate((id) => {
          const d = window.__paneDocs?.a ?? null;
          if (d === null) return null;
          return d.getBlock(id)?.attrs?.indent ?? 0;
        }, ids.child),
      SETTLE
    )
    .toBe(0);
  await expect.poll(() => innerSeat(2)).toBe(true);

  // Backspace on the empty root paragraph (the page has more than one
  // block): the block is removed.
  await a.keyboard.press("Backspace");
  await expect
    .poll(
      async () => a.evaluate((id) => (window.__paneDocs?.a?.getBlock(id) === null ? "removed" : "present"), ids.child),
      SETTLE
    )
    .toBe("removed");
  await expect(inners(a, "a")).toHaveCount(2);

  await close();
});

test("a reload does not re-seed the room (the content is stable across reloads)", async ({ browser }) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  const room = `ui03b-reload-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", room);

  // The room's single starter settles (pane "a" is the designated seeder,
  // after the sync settles).
  await expect(inners(a, "a")).toHaveCount(1);
  const first = inners(a, "a").first();
  await first.click();
  await a.keyboard.type("hello");
  await insertBlockType(a, "a", "list-item");
  await expect(inners(a, "a")).toHaveCount(2);
  const second = inners(a, "a").nth(1);
  await second.click();
  await a.keyboard.type("an item");
  await expect(inners(a, "a").first()).toHaveText("hello");
  const countBefore = await inners(a, "a").count();

  // Two reloads: the relay's room state survives the reload and the pane
  // resyncs against it — no duplicate starter, the content stands.
  await a.reload({ waitUntil: "domcontentloaded" });
  await expect(inners(a, "a")).toHaveCount(countBefore);
  await expect(inners(a, "a").first()).toHaveText("hello");
  await a.reload({ waitUntil: "domcontentloaded" });
  await expect(inners(a, "a")).toHaveCount(countBefore);
  await expect(inners(a, "a").first()).toHaveText("hello");
  await expect(inners(a, "a").nth(1)).toHaveText("an item");

  await context.close();
});
