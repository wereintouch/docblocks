// The slash command's apply: the type's conversion with the rest of the text's keep, the
// phrase-only block's replace, the undo over the apply's focus gap, and the same-type
// command's kind swap.
import { type Browser, type Page, expect, test } from "@playwright/test";

import { RELAY, editorContext, outCount } from "./helpers";

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

test("/ triggers in a non-empty, indented block; the apply converts the type and keeps the text", async ({
  browser,
}) => {
  const { a, b, close } = await openPanes(browser, "slash-convert");
  const target = inner(a, "a");
  await target.click();
  // Two blocks (the sequence head stays at indent 0 — the first block
  // cannot indent); the caret is re-seated in the second block explicitly
  // (the split's caret handoff settles with the motion view's animation).
  await a.keyboard.type("top");
  await a.keyboard.press("Enter");
  const second = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').nth(1);
  await expect(second).toHaveCount(1);
  await second.click();
  await a.keyboard.type("todo");
  await a.keyboard.press("Tab"); // the second block indents to level 1

  await a.keyboard.type("/task");
  await expect(menu(a)).toBeVisible();
  await expect(menu(a).locator('[role="menuitem"]')).toHaveCount(1);
  await expect(menu(a).locator('[role="menuitem"]')).toHaveText("Task list");

  const outBefore = await outCount(a, "a");
  await a.keyboard.press("Enter");
  await expect(menu(a)).toHaveCount(0);

  // The block converted in place: a task list item at its indent, the text
  // surviving (the trigger phrase "/task" stripped).
  const taskItem = a.locator('[data-block-type="list-item"]:not([data-slot="docblocks/row"])');
  await expect(taskItem).toHaveCount(1);
  await expect(taskItem.locator('[data-slot="docblocks/block-content"]')).toHaveText("todo");
  const attrs = await a.evaluate((c) => {
    const doc = window.__paneDocs?.[c as "a" | "b"] ?? null;
    if (doc === null) return null;
    const order = doc.getChildren(doc.toJSON().id);
    const id = order.find((blockId) => doc.getBlock(blockId)?.type === "list-item") ?? null;
    return id === null ? null : (doc.getBlock(id)?.attrs ?? null);
  }, "a");
  expect(attrs).toEqual({ list: "task", indent: 1 });

  // One command: one wire update; the other pane stands the same.
  await expect.poll(async () => outCount(a, "a")).toBe(outBefore + 1); // the wire log lags the update — polled
  const bItem = b.locator('[data-block-type="list-item"]:not([data-slot="docblocks/row"])');
  await expect(bItem).toHaveCount(1);
  await expect(bItem.locator('[data-slot="docblocks/block-content"]')).toHaveText("todo");

  // One undo step: the phrase and the type are restored together (the
  // wire log lags the update — polled).
  await a.keyboard.press("Control+z");
  await expect.poll(async () => outCount(a, "a")).toBe(outBefore + 2);
  await expect(a.locator('[data-block-type="list-item"]:not([data-slot="docblocks/row"])')).toHaveCount(0);
  const restored = a
    .locator('[data-block-type="paragraph"]:not([data-slot="docblocks/row"])')
    .filter({ hasText: "todo/task" });
  await expect(restored).toHaveCount(1);
  await expect(restored.locator('[data-slot="docblocks/block-content"]')).toHaveText("todo/task");
  await close();
});

test("a phrase-only block converts by replacement (the converted block stands empty, the v1 path)", async ({
  browser,
}) => {
  const { a, b, close } = await openPanes(browser, "slash-replace");
  // Seed our own phrase-only block: the room's doc is not fresh on a
  // re-run (the relay keeps the rooms for its lifetime — the leftovers
  // stand), so the assertions scope to the seeded id.
  const seedId = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return null;
    return doc.insertBlock("paragraph");
  });
  expect(seedId).not.toBeNull();
  const target = a.locator(`[data-block-id="${seedId}"] [data-slot="docblocks/block-content"]`);
  await target.click();

  await a.keyboard.type("/head");
  await expect(menu(a)).toBeVisible();
  await a.keyboard.press("ArrowDown"); // Heading 2
  await a.keyboard.press("Enter");
  await expect(menu(a)).toHaveCount(0);

  // The block's whole text was the trigger phrase: it converts by the
  // replace path — the empty heading stands as the sequence's last block
  // (the seed was the last one; a re-run's leftovers stand before it, so
  // the pane-wide counts do not pin).
  const headingId = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return null;
    const ids = doc.getChildren(doc.meta.id);
    const last = ids[ids.length - 1];
    if (last === undefined) return null;
    const block = doc.getBlock(last);
    return block !== null && block !== undefined && block.type === "heading" && block.attrs?.level === 2 ? last : null;
  });
  expect(headingId).not.toBeNull();
  expect(headingId).not.toBe(seedId);
  await expect(a.locator(`[data-block-id="${headingId}"] [data-slot="docblocks/block-content"]`)).toHaveText("");
  // Synced to the other pane (scoped by the block id; the wrapper level —
  // the inner contenteditable carries the block id too).
  await expect(b.locator(`[data-slot="docblocks/block"][data-block-id="${headingId}"]`)).toHaveCount(1);

  const outBefore = await outCount(a, "a");
  await a.keyboard.press("Control+z");
  await expect.poll(async () => outCount(a, "a")).toBe(outBefore + 1);
  // One undo step restores the seed with the phrase (the removed block
  // stands again) and the new heading is gone.
  await expect
    .poll(async () => {
      return a.evaluate((id) => {
        const doc = window.__paneDocs?.a ?? null;
        return doc === null || id === "" ? null : doc.getText(id);
      }, seedId ?? "");
    })
    .toBe("/head");
  await expect(a.locator(`[data-block-id="${headingId}"]`)).toHaveCount(0);
  await close();
});

test("an undo inside the apply's focus gap still undoes (the keyboard scope stands on the root)", async ({
  browser,
}) => {
  const { a, close } = await openPanes(browser, "slash-gap-undo");
  const seedId = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return null;
    return doc.insertBlock("paragraph");
  });
  expect(seedId).not.toBeNull();
  const target = a.locator(`[data-block-id="${seedId}"] [data-slot="docblocks/block-content"]`);
  await target.click();

  await a.keyboard.type("/head");
  await expect(menu(a)).toBeVisible();

  // The ArrowDown + Enter (the apply) and the Ctrl+Z (the undo) are
  // dispatched back to back in one evaluate: the store rebuild's rAF
  // caret re-seating has not run, so the undo lands inside the focus gap
  // (the focused inner unmounts in the rebuild; the focus stands on the
  // editor root until the re-seat). The apply's sync flush runs inside
  // the first dispatch, so the gap is live when the second dispatch lands.
  const result = await a.evaluate((id) => {
    if (id === null) return null;
    const inner = document.querySelector(`[data-block-id="${id}"][data-slot="docblocks/block-content"]`);
    if (inner === null) return null;
    inner.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    inner.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const undoTarget = document.activeElement;
    if (undoTarget === null) return null;
    undoTarget.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })
    );
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return null;
    const children = doc.getChildren(doc.meta.id);
    return {
      // the replace inserted the heading and removed the seed: the undo
      // removes the heading and restores the seed — a net one-block drop
      seedRestored: children.includes(id),
      seedText: children.includes(id) ? doc.getText(id) : "GONE",
      headingStands: children.some((cid) => doc.getBlock(cid)?.type === "heading"),
    };
  }, seedId);
  // The seed stands again with the phrase; the converted heading is gone.
  expect(result?.seedRestored).toBe(true);
  expect(result?.seedText).toBe("/head");
  expect(result?.headingStands).toBe(false);
  await close();
});

test("a same-type command is an attrs update: the kind swap keeps the text", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "slash-kindswap");
  const target = inner(a, "a");
  await target.click();
  await a.keyboard.type("item");
  // Make the starter a bulleted list item (the list-type menu stands via the
  // format toolbar — the slash's own kind-swap is the pin below, so seed the
  // kind through the doc API).
  await a.evaluate((c) => {
    const doc = window.__paneDocs?.[c as "a" | "b"] ?? null;
    if (doc === null) return;
    const order = doc.getChildren(doc.toJSON().id);
    const id = order[0];
    if (id !== undefined) doc.changeBlockType(id, "list-item", { list: "bullet" });
  }, "a");

  await target.click();
  await a.keyboard.press("End");
  await a.keyboard.type("/task");
  await expect(menu(a)).toBeVisible();
  await expect(menu(a).locator('[role="menuitem"]')).toHaveCount(1);
  await expect(menu(a).locator('[role="menuitem"]')).toHaveText("Task list");
  const outBefore = await outCount(a, "a");

  await a.keyboard.press("Enter");
  await expect(menu(a)).toHaveCount(0);
  const item = a.locator('[data-block-type="list-item"]:not([data-slot="docblocks/row"])');
  await expect(item).toHaveCount(1);
  await expect(item.locator('[data-slot="docblocks/block-content"]')).toHaveText("item");
  const attrs = await a.evaluate((c) => {
    const doc = window.__paneDocs?.[c as "a" | "b"] ?? null;
    if (doc === null) return null;
    const id = doc.getChildren(doc.toJSON().id)[0];
    return id === undefined ? null : (doc.getBlock(id)?.attrs ?? null);
  }, "a");
  expect(attrs).toEqual({ list: "task" });
  // One composed command: one wire update.
  await expect.poll(async () => outCount(a, "a")).toBe(outBefore + 1); // the wire log lags the update — polled
  await close();
});
