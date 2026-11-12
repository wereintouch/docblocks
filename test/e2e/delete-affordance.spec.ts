// The page row's delete affordance: the hover's trash icon at the row's
// right edge (every page type, the edit's mode only). The click is a true
// deletion — the row's whole blocks selection when the row is part of one,
// the row alone otherwise; the document root's tail guarantee + the focus's
// parking stand as the Delete key's gesture (the focus never drops to the
// document — the undo hotkey's reach).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, insertBlockType, twoPanes } from "./helpers";

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** The pane's block wrappers (the inner editables are not wrappers). */
function wrappers(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id]:not([data-slot="docblocks/block-content"])');
}

/** The delete button of the row owning the block (the row hosts the block's
 *  renderer, the text row's wrapper included). */
function deleteButton(page: Page, client: "a" | "b", id: string) {
  return pane(page, client).locator(
    `[data-slot="docblocks/row"]:has([data-block-id="${id}"]) button[data-slot="docblocks/gutter-delete"]`
  );
}

/** The row-level gutter handle of the block (the row's own grip column). */
function rowGutter(page: Page, client: "a" | "b", id: string) {
  return pane(page, client).locator(
    `[data-slot="docblocks/row"]:has([data-block-id="${id}"]) button[data-slot="docblocks/gutter"]`
  );
}

/** The wrapper of the block (the flat page carries no nesting). */
function wrapper(page: Page, client: "a" | "b", id: string) {
  return pane(page, client).locator(`[data-block-id="${id}"]:not([data-slot="docblocks/block-content"])`);
}

/** The block ids the pane's doc still carries. */
async function blockIds(page: Page, client: "a" | "b"): Promise<string[]> {
  const ids = await page.evaluate((c) => {
    const d = window.__paneDocs?.[c as "a" | "b"] ?? null;
    if (d === null) return null;
    return Object.keys(d.toJSON().blocks);
  }, client);
  if (ids === null) throw new Error("the pane's doc is not mounted");
  return ids;
}

test.describe("the page row's delete affordance", () => {
  test("stands hidden at rest and revealed over the row's hover (every page type)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "del-aff-hover");

    const dividerId = await insertBlockType(a, "a", "divider");
    const textId = await insertBlockType(a, "a", "callout");

    // At rest: the icon stands over every page row (the text row's own
    // wrapper, the non-text row's row-level stand) and is hidden.
    const atRest = (id: string) => deleteButton(a, "a", id).evaluate((el) => getComputedStyle(el).opacity);
    await expect.poll(() => atRest(dividerId), SETTLE).toBe("0");
    await expect.poll(() => atRest(textId), SETTLE).toBe("0");

    // The row's hover reveals the row's own icon only.
    await a.locator(`[data-slot="docblocks/row"]:has([data-block-id="${textId}"])`).hover();
    await expect.poll(() => atRest(textId), SETTLE).toBe("1");
    await expect.poll(() => atRest(dividerId), SETTLE).toBe("0");

    await close();
  });

  test("the click deletes the row and stands over the peer's pane", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "del-aff-delete");

    const dividerId = await insertBlockType(a, "a", "divider");

    await deleteButton(a, "a", dividerId).click();

    // The data stands on both peers (the removal's one wire update).
    await expect.poll(() => blockIds(a, "a"), SETTLE).not.toContain(dividerId);
    await expect.poll(() => blockIds(b, "b"), SETTLE).not.toContain(dividerId);

    // The wrapper unmounts on both peers.
    await expect(wrapper(a, "a", dividerId)).toHaveCount(0);
    await expect(wrapper(b, "b", dividerId)).toHaveCount(0, SETTLE);

    // The focus never drops to the document: the gesture parks it inside
    // the editor (the tail guarantee's caret over the page's single
    // editable container, or the root's park).
    const activeSlot = await a.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.slot ?? null);
    expect(["docblocks/editor", "docblocks/page", "docblocks/block-content"]).toContain(activeSlot);

    // The wrapper count stands (the deletion never stands the empty doc).
    expect(await wrappers(a, "a").count()).toBeGreaterThan(0);

    await close();
  });

  test("deletes the whole blocks selection when the row is part of it", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "del-aff-multi");

    const aId = await insertBlockType(a, "a", "callout");
    const bId = await insertBlockType(a, "a", "callout");

    // The blocks selection: the first row's gutter, the second's with Shift.
    await rowGutter(a, "a", aId).click();
    await rowGutter(a, "a", bId).click({ modifiers: ["Shift"] });

    await deleteButton(a, "a", aId).click();

    await expect.poll(() => blockIds(a, "a"), SETTLE).not.toContain(aId);
    await expect.poll(() => blockIds(a, "a"), SETTLE).not.toContain(bId);
    await expect.poll(() => blockIds(b, "b"), SETTLE).not.toContain(aId);
    await expect.poll(() => blockIds(b, "b"), SETTLE).not.toContain(bId);

    await close();
  });
});
