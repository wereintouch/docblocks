// The seam's landing variants over the flat-model drag: a drop at the seam between the row A
// (before) and the row B (after) stands the dragged block's head at one of the seam's indents —
// the row the pointer stands over (its upper or lower half), in the gap the pointer's half decides.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, expectStays, insertBlockType, outCount, rowsSettled, twoPanes } from "./helpers";

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

function gutter(page: Page, client: "a" | "b", index: number) {
  return wrappers(page, client).nth(index).locator('button[data-slot="docblocks/gutter"]');
}

/** The flat row (the Reorder.Item) that wraps the given block — a row is the wrapper's direct parent, and the flat view carries no nesting, so the id is unique within the row. */
function rowOf(page: Page, id: string) {
  return page.locator(`[data-slot="docblocks/row"]:has([data-block-id="${id}"])`);
}

/** The pane's root order + one block's indent attr (the command API's view; the absent indent stands as 0). */
async function rootState(
  page: Page,
  client: "a" | "b"
): Promise<{ order: string[]; indent: (id: string) => number | undefined }> {
  const doc = await page.evaluate((c) => {
    const d = window.__paneDocs?.[c as "a" | "b"] ?? null;
    if (d === null) return null;
    const json = d.toJSON();
    return {
      order: d.getChildren(json.id),
      blocks: json.blocks,
    };
  }, client);
  if (doc === null) throw new Error("the pane's doc is not mounted");
  return {
    order: doc.order,
    indent: (id: string) => (doc.blocks[id]?.attrs as { indent?: number } | undefined)?.indent ?? 0,
  };
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

/**
 * The doc's seed for the seam pins: p0 (0), p1 (1 — p0's child via Tab),
 * p2 (0), p3 (0). Returns the wrappers' ids in order.
 */
async function seedSeamDoc(a: Page, client: "a" | "b"): Promise<string[]> {
  await insertBlockType(a, client, "paragraph");
  await insertBlockType(a, client, "paragraph");
  await insertBlockType(a, client, "paragraph");
  // p1 (the second block) indents one level (the Tab gesture) — the chain
  // p0 (0) / p1 (1) / p2 (0) / p3 (0).
  await wrappers(a, client).nth(1).locator('[data-slot="docblocks/block-content"]').click();
  await a.keyboard.press("Tab");
  const now = await rootState(a, client);
  expect(now.order).toHaveLength(4);
  expect(now.indent(now.order[1]!)).toBe(1);
  return now.order;
}

test("a drop over the dragged block's own subtree is a stale drop (no command, the order resyncs)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "stale-drop-own-subtree");

  const seeded = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return null;
    const head = d.insertBlock("paragraph");
    d.insertText(head, 0, "stale head");
    const child = d.insertBlock("paragraph", { indent: 1 });
    d.insertText(child, 0, "stale child");
    return { head, child };
  });
  if (seeded === null) throw new Error("the pane's doc is not mounted");
  await rowsSettled(a);

  const before = await rootState(a, "a");
  const outBefore = await outCount(a, "a");

  // Drag the segment head down onto its own child's row: framer's virtual
  // order reorders (the child ahead of the head), but the commit maps it
  // back to the segment standing in place — a stale drop issues no
  // command, and the local row order resyncs to the store.
  const childRow = rowOf(a, seeded.child);
  const childBox = await childRow.boundingBox();
  if (childBox === null) throw new Error("the child row has no box");
  const handle = a.locator(`[data-block-id="${seeded.head}"]`).first().locator('button[data-slot="docblocks/gutter"]');
  await handle.hover();
  const handleBox = await handle.boundingBox();
  if (handleBox === null) throw new Error("the head's gutter has no box");
  await a.mouse.move(handleBox.x, handleBox.y + handleBox.height / 2);
  await a.mouse.down();
  await a.mouse.move(childBox.x + 40, childBox.y + childBox.height / 2, { steps: 16 });
  await a.mouse.up();

  // No doc update left the pane (the release committed nothing), and the
  // order stands (held over the settle window — a late commit lands after
  // a single sample).
  await expectStays(async () => {
    expect(await outCount(a, "a")).toBe(outBefore);
    const now = await rootState(a, "a");
    expect(now.order).toEqual(before.order);
    expect(now.indent(seeded.child)).toBe(1);
  });

  await close();
});

test("a drop over B's upper half stands the head at B's indent (the seam's deeper variant)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "seam-upper-half");
  await seedSeamDoc(a, "a");
  const orderNow = (await rootState(a, "a")).order;
  expect(orderNow).toHaveLength(4);
  const [p0, p1, p2, p3] = orderNow;

  // Drag p2 (indent 0) up over p1 (indent 1)'s upper half: the head lands
  // before p1 at p1's level — the seam's deeper variant (p2's own indent 0
  // is not a candidate).
  const outBefore = await outCount(a, "a");
  const p1Box = (await wrappers(a, "a").nth(1).boundingBox())!;
  await dragGutterTo(a, "a", 2, p1Box.x + 30, p1Box.y + 6);

  // The release's commit rides framer's rAF after the pointerup — poll the
  // a-pane's order to the drop before asserting the committed state.
  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual([p0, p2, p1, p3]);
  const after = await rootState(a, "a");
  expect(after.indent(p2!)).toBe(1); // the head stood at the seam's neighbor's level
  expect(after.indent(p1!)).toBe(1); // the neighbor stands
  // One wire update reached B; the order and the indent synced.
  expect(await outCount(a, "a")).toBe(outBefore + 1);
  await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual([p0, p2, p1, p3]);
  await expect.poll(async () => (await rootState(b, "b")).indent(p2!), SETTLE).toBe(1);
  // One undo step restores the position and the indent at once.
  await a.keyboard.press("Control+z");
  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual([p0, p1, p2, p3]);
  await expect.poll(async () => (await rootState(a, "a")).indent(p2!), SETTLE).toBe(0);
  expect(await outCount(a, "a")).toBe(outBefore + 2);

  await close();
});

test("a drop over A's lower half stands the head at A's indent (the seam's shallower variant)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "seam-lower-half");
  await seedSeamDoc(a, "a");
  const orderNow = (await rootState(a, "a")).order;
  expect(orderNow).toHaveLength(4);
  const [p0, p1, p2, p3] = orderNow;

  // Drag p2 (indent 0) up into the gap below p0 (the gap's lower half —
  // the seam's "after A" side): the head lands after p0 at p0's level
  // (the seam's shallower variant — p2's own indent stands, because the
  // variant equals it).
  const outBefore = await outCount(a, "a");
  const p0Box = (await wrappers(a, "a").nth(0).boundingBox())!;
  await dragGutterTo(a, "a", 2, p0Box.x + 30, p0Box.y + p0Box.height + 6);

  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual([p0, p2, p1, p3]);
  const after = await rootState(a, "a");
  expect(after.indent(p2!)).toBe(0);
  expect(await outCount(a, "a")).toBe(outBefore + 1);
  await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual([p0, p2, p1, p3]);
  await expect.poll(async () => (await rootState(b, "b")).indent(p2!), SETTLE).toBe(0);

  await close();
});

test("a root block dragged into a deep seam stands at the seam's level (the root variant is not offered)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "seam-deep-indent");
  await seedSeamDoc(a, "a");
  const orderNow = (await rootState(a, "a")).order;
  expect(orderNow).toHaveLength(4);
  const [p0, p1, p2, p3] = orderNow;
  // p2 indents to 2 (p1's child, two Tab steps): the chain p0 (0) / p1 (1) /
  // p2 (2) / p3 (0) — a seam of indents 1 and 2.
  await wrappers(a, "a").nth(2).locator('[data-slot="docblocks/block-content"]').click();
  await a.keyboard.press("Tab");
  await a.keyboard.press("Tab");
  const chain = await rootState(a, "a");
  expect(chain.indent(p2!)).toBe(2);

  // Drag p3 (indent 0) into the seam over p2 (indent 2)'s upper half: the
  // candidate is 2 (p2's indent) — p3's own root indent is not a variant.
  const p2Box = (await wrappers(a, "a").nth(2).boundingBox())!;
  await dragGutterTo(a, "a", 3, p2Box.x + 30, p2Box.y + 6);

  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual([p0, p1, p3, p2]);
  const after = await rootState(a, "a");
  expect(after.indent(p3!)).toBe(2);
  expect(after.indent(p2!)).toBe(2);

  await close();
});

test("a segment dragged to a shallower seam shifts the whole segment by the delta (one undo step, one wire update)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "segment-shallow-shift");
  await seedSeamDoc(a, "a");
  const orderNow = (await rootState(a, "a")).order;
  expect(orderNow).toHaveLength(4);
  const [p0, p1, p2, p3] = orderNow;
  // p2 indents to 2 (p1's child, two Tab steps): p1's segment is [p1 (1),
  // p2 (2)].
  await wrappers(a, "a").nth(2).locator('[data-slot="docblocks/block-content"]').click();
  await a.keyboard.press("Tab");
  await a.keyboard.press("Tab");

  // Drag p1's segment to the end, below p3: the seam's only neighbor is p3
  // (indent 0) — the candidate 0, the delta -1: p1 stands at 0, p2 shifts
  // 2 -> 1 (the relative structure stands).
  const outBefore = await outCount(a, "a");
  const p3Box = (await wrappers(a, "a").nth(3).boundingBox())!;
  await dragGutterTo(a, "a", 1, p3Box.x + 30, p3Box.y + p3Box.height + 10);

  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual([p0, p3, p1, p2]);
  const after = await rootState(a, "a");
  expect(after.indent(p1!)).toBe(0);
  expect(after.indent(p2!)).toBe(1);
  // One wire update (the move and both indents ride the single transact);
  // B's JSON carries the shifted segment.
  expect(await outCount(a, "a")).toBe(outBefore + 1);
  await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual([p0, p3, p1, p2]);
  await expect.poll(async () => (await rootState(b, "b")).indent(p2!), SETTLE).toBe(1);
  // One undo step restores the position and both indents.
  await a.keyboard.press("Control+z");
  const undone = await rootState(a, "a");
  expect(undone.order).toEqual([p0, p1, p2, p3]);
  expect(undone.indent(p1!)).toBe(1);
  expect(undone.indent(p2!)).toBe(2);
  expect(await outCount(a, "a")).toBe(outBefore + 2);

  await close();
});

test("a drop at the sequence's start stands the head at the first block's indent", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "seam-sequence-start");
  await seedSeamDoc(a, "a");
  const orderNow = (await rootState(a, "a")).order;
  expect(orderNow).toHaveLength(4);
  const [p0, p1, p2, p3] = orderNow;

  // Drag p1 (indent 1) above the first row: the seam's only neighbor is the
  // first block (indent 0) — the "predecessor of the first" candidate.
  const p0Box = (await wrappers(a, "a").nth(0).boundingBox())!;
  await dragGutterTo(a, "a", 1, p0Box.x + 30, p0Box.y - 12);

  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual([p1, p0, p2, p3]);
  const after = await rootState(a, "a");
  expect(after.indent(p1!)).toBe(0);

  await close();
});
