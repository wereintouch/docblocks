// The flat-model drag (the motion subpath) — the basic stands: a pure framer
// Reorder over the flat page sequence, the gutter handle the only drag
// trigger, a vertical drag a reorder only (the level change is the
// Tab/Shift+Tab gesture). A no-op drop issues no command; the release
// parks the focus on the editor root (no visible ring) or restores the user's text seat.
import { type Page, expect, test } from "@playwright/test";

import { caretIn, insertBlockType, outCount, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the 15s
// SETTLE's panes + the page loads): the raised budget keeps the timeout
// class out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** The pane's block wrappers (the inner editables are not blocks). */
function wrappers(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id]:not([data-slot="docblocks/block-content"])');
}

/** The pane's current block wrapper (the harness labels it `data-current`). */
function currentWrapper(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id][data-current="true"]');
}

/** The wrapper's gutter handle. */
function gutter(page: Page, client: "a" | "b", index: number) {
  return wrappers(page, client).nth(index).locator('button[data-slot="docblocks/gutter"]');
}

/** The flat row (the Reorder.Item) that wraps the given block — a row is the wrapper's direct parent, and the flat view carries no nesting, so the id is unique within the row. */
function rowOf(page: Page, id: string) {
  return page.locator(`[data-slot="docblocks/row"]:has([data-block-id="${id}"])`);
}

/** The wrapper's block id. */
async function wrapperId(page: Page, client: "a" | "b", index: number): Promise<string> {
  return (await wrappers(page, client).nth(index).getAttribute("data-block-id")) ?? "";
}

/**
 * A real pointer drag from a point to a point: the moves are stepped (framer's layout projection
 * tracks the pointer only across rendered frames — a single fast move is batched and crosses nothing),
 * then the dwell (the layout projection's slide settles, so the release's seam measurement stands
 * over the settled boxes).
 */
async function pressDragTo(page: Page, fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(fromX + (toX - fromX) * (i / 12), fromY + ((toY - fromY) * i) / 12);
    await page.waitForTimeout(30);
  }
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.move(toX, toY);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
}

/**
 * A real pointer drag of a row's gutter handle to a point (the `pressDragTo` mechanics over the handle's center).
 */
async function dragGutterTo(page: Page, client: "a" | "b", index: number, toX: number, toY: number): Promise<void> {
  const handle = gutter(page, client, index);
  await handle.hover();
  const from = await handle.boundingBox();
  if (from === null) throw new Error("the gutter has no box");
  // The press stands the handle's center: over the handle's edge pixel the
  // engines' hit-test diverges (the firefox's edge stands the element below,
  // so the press misses the handle's gutter and the drag's session stands no
  // start).
  await pressDragTo(page, from.x + from.width / 2, from.y + from.height / 2, toX, toY);
}

test("a gutter drag reorders the block, syncs to the other pane, and undoes as one step", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "gutter-drag-reorder");

  // The room starts with pane "a"'s single starter (both panes see it).
  await expect(wrappers(a, "a")).toHaveCount(1);
  await expect(wrappers(b, "b")).toHaveCount(1);

  // Two more paragraphs via the pane's insert hook (the inserted block is
  // current, so it is labeled), with unique texts for the assertions.
  await insertBlockType(a, "a", "paragraph");
  await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
  await a.keyboard.type("one");
  await insertBlockType(a, "a", "paragraph");
  await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
  await a.keyboard.type("two");
  await expect(wrappers(a, "a")).toHaveCount(3);
  await expect(wrappers(b, "b")).toHaveCount(3);

  const lastId = await wrapperId(a, "a", 2);
  expect(lastId).not.toBe("");
  const firstBox = await wrappers(a, "a").nth(0).boundingBox();
  const lastBox = await wrappers(a, "a").nth(2).boundingBox();
  if (firstBox === null || lastBox === null) throw new Error("the wrappers have no boxes");

  // Drag the last block above the first one (the pointer lands inside the
  // viewport, so the drag does not trigger page auto-scroll).
  await dragGutterTo(a, "a", 2, lastBox.x + 20, firstBox.y + firstBox.height / 4);

  // The order changed in A and reached B over the wire (B shows the new
  // order as the update arrives).
  await expect(wrappers(a, "a").first()).toHaveAttribute("data-block-id", lastId);
  await expect(wrappers(b, "b").first()).toHaveAttribute("data-block-id", lastId);

  // The drag is A's local undo entry (one command, one undoable unit):
  // the order reverts in both panes.
  await a.keyboard.press("Control+z");
  await expect(wrappers(a, "a").first()).not.toHaveAttribute("data-block-id", lastId);
  await expect(wrappers(b, "b").first()).not.toHaveAttribute("data-block-id", lastId);

  await close();
});

test("a drag back to the same position issues no command", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "drag-same-position-noop");

  await expect(wrappers(a, "a")).toHaveCount(1);
  const firstId = await wrapperId(a, "a", 0);
  expect(firstId).not.toBe("");

  // The wire log counts doc updates only (awareness frames do not pass
  // the logged sendUpdate), so a no-op drag adds no `out` line.
  const before = await outCount(a, "a");

  // A small move: no midpoint crossing, so the order stands.
  const handleBox = await gutter(a, "a", 0).boundingBox();
  if (handleBox === null) throw new Error("the first wrapper's gutter has no box");
  await dragGutterTo(a, "a", 0, handleBox.x, handleBox.y + 4);

  await a.waitForTimeout(500);
  expect(await outCount(a, "a")).toBe(before);
  await expect(wrappers(a, "a").first()).toHaveAttribute("data-block-id", firstId);

  await close();
});

test("the drag's release parks the focus on the editor root with no visible ring", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "drag-focus-park");

  await expect(wrappers(a, "a")).toHaveCount(1);
  const handleBox = await gutter(a, "a", 0).boundingBox();
  if (handleBox === null) throw new Error("the first wrapper's gutter has no box");
  await dragGutterTo(a, "a", 0, handleBox.x, handleBox.y + 4);

  // The gesture's contract over the no-seat release (the drag's press
  // stood over no text selection): the focus parks on the editor root
  // (the keyboard's input stays scoped over the editor after the pointer
  // capture leaves it on body). A release over a captured text seat
  // restores the seat instead (the release's restore test below).
  await expect(a.locator('[data-slot="docblocks/editor"]').first()).toBeFocused();

  // The park is programmatic (the root's tabIndex -1 — no Tab focus): the
  // browser's default focus ring would stand the visible ring over the
  // whole document after the release — the styles.css stand suppresses
  // it (the focus itself stays, only the ring is gone).
  const outlineStyle = await a
    .locator('[data-slot="docblocks/editor"]')
    .first()
    .evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outlineStyle).toBe("none");

  await close();
});

test("the drag's release restores the user's text seat and leaves no residual selection", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "drag-release-seat");

  await expect(wrappers(a, "a")).toHaveCount(1);
  await insertBlockType(a, "a", "paragraph");
  await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
  await a.keyboard.type("one");
  await insertBlockType(a, "a", "paragraph");
  await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
  await a.keyboard.type("two");
  await expect(wrappers(a, "a")).toHaveCount(3);

  // The user's caret stands in the first block (the starter — the drag's
  // neighbor, not the dragged row).
  const seatWrapper = wrappers(a, "a").nth(0);
  const seatId = await wrapperId(a, "a", 0);
  expect(seatId).not.toBe("");
  const [otherIdA, otherIdB] = [await wrapperId(a, "a", 1), await wrapperId(a, "a", 2)];
  const textsBefore = await Promise.all([otherIdA, otherIdB].map((id) => rowOf(a, id).innerText()));
  await seatWrapper.locator('[data-slot="docblocks/block-content"]').first().click();

  // Drag the last block above the seat (the release stands over the
  // page's top chrome — a non-text drop point).
  const handleBox = await gutter(a, "a", 2).boundingBox();
  const seatBox = await seatWrapper.boundingBox();
  if (handleBox === null || seatBox === null) throw new Error("the drag's boxes are absent");
  await dragGutterTo(a, "a", 2, handleBox.x, seatBox.y - 14);
  await a.waitForTimeout(500);

  // The release's browser click is a drop, not a gutter click: no
  // residual blocks selection (the row's highlight).
  await expect(a.locator('[data-slot="docblocks/row"][data-selected="true"]')).toHaveCount(0);

  // The caret restored to the user's seat (the block's inner — not the
  // page container's edge, where the browser's release over the drag's
  // chrome would collapse it).
  expect(await caretIn(a, `[data-block-id="${seatId}"][data-slot="docblocks/block-content"]`)).toBe(true);

  // The seat is live: the next input lands in the seat's block (the
  // click's seat offset, not the end — the other blocks stand).
  await a.keyboard.type("!");
  const textsAfter = [await rowOf(a, otherIdA).innerText(), await rowOf(a, otherIdB).innerText()];
  expect(textsAfter).toEqual(textsBefore);
  expect((await rowOf(a, seatId).innerText()).includes("!")).toBe(true);

  await close();
});
