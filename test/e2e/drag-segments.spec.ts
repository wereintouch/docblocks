// The flat-model drag's segment / the indent's stands: the dragged block's
// derived subtree moves as one range (one transact — one undo step, one wire
// update), the indent's stands stand the level (a list row drags within its
// level — the drag reorders, never re-nests), and a non-text row (a divider)
// drags by its row-level gutter handle.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, expectStays, outCount, rowsSettled, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the 15s
// SETTLE's panes + the page loads): the raised budget keeps the timeout
// class out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

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

test("a drag of a block with a derived subtree moves the whole segment (one wire update, the indents stand)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "segment-subtree-move");

  // The room starts with the panes' two seeded paragraphs; the pane's doc
  // handle adds the fixture: a paragraph with an indented child (the
  // derived segment) and a paragraph after it.
  const seeded = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return null;
    const head = d.insertBlock("paragraph");
    d.insertText(head, 0, "segment head");
    const child = d.insertBlock("paragraph", { indent: 1 });
    d.insertText(child, 0, "segment child");
    const after = d.insertBlock("paragraph");
    d.insertText(after, 0, "after the segment");
    return { head, child, after };
  });
  if (seeded === null) throw new Error("the pane's doc is not mounted");
  await rowsSettled(a);

  const before = await rootState(a, "a");
  expect(before.order).toContain(seeded.head);
  const headIndex = before.order.indexOf(seeded.head);
  expect(before.order[headIndex + 1]).toBe(seeded.child);
  expect(before.order[headIndex + 2]).toBe(seeded.after);
  expect(before.indent(seeded.child)).toBe(1);
  const outBefore = await outCount(a, "a");

  // The segment head's row: the head follows the two seeded rows (the
  // seeded blocks came first in the room's sequence).
  const headRow = rowOf(a, seeded.head);
  const afterRow = rowOf(a, seeded.after);
  const afterBox = await afterRow.boundingBox();
  const headBox = await headRow.boundingBox();
  if (afterBox === null || headBox === null) throw new Error("the rows have no boxes");

  // Drag the segment head down past the "after" row (stepped moves so
  // framer's layout projection tracks the drag — a single fast move is
  // batched into one frame and crosses nothing): the whole segment
  // (head + child) lands after it, one transact.
  const handle = a.locator(`[data-block-id="${seeded.head}"]`).first().locator('button[data-slot="docblocks/gutter"]');
  await handle.hover();
  const handleBox = await handle.boundingBox();
  if (handleBox === null) throw new Error("the head's gutter has no box");
  const toY = afterBox.y + afterBox.height * 0.75; // below the row's center
  const fromY = handleBox.y + handleBox.height / 2;
  await a.mouse.move(handleBox.x, fromY);
  await a.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await a.mouse.move(afterBox.x + 30, fromY + ((toY - fromY) * i) / 12);
    await a.waitForTimeout(30);
  }
  await a.mouse.up();

  // One wire update: the move was one command.
  await expect.poll(async () => outCount(a, "a"), SETTLE).toBe(outBefore + 1);
  // The segment moved as a unit: the head precedes the child, the child
  // stays indented (the attach rule re-derives it under the moved head),
  // and both follow "after".
  const afterState = await rootState(a, "a");
  const newHeadIndex = afterState.order.indexOf(seeded.head);
  expect(afterState.order[newHeadIndex + 1]).toBe(seeded.child);
  expect(afterState.order[newHeadIndex - 1]).toBe(seeded.after);
  expect(afterState.indent(seeded.child)).toBe(1);
  // The row's left step stands on the indent (one nested-indent step).
  const childRow = rowOf(a, seeded.child);
  expect(await childRow.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("24px");

  // The other pane converges to the same flat order over the wire.
  await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual(afterState.order);

  // One undo step restores the pre-drag order in both panes. The undo
  // hotkey reaches the doc only from inside the editor root, so click back
  // in first (the drag left the focus on the gutter handle).
  await a.locator(`[data-block-id="${seeded.head}"]`).first().locator('[data-slot="docblocks/block-content"]').click();
  await a.keyboard.press("Control+z");
  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual(before.order);
  await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual(before.order);

  await close();
});

test("a list row at indent 1 drags within its level (the indent stands) and syncs", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "list-level-reorder");

  const seeded = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return null;
    const parent = d.insertBlock("list-item", { list: "bullet" });
    d.insertText(parent, 0, "parent item");
    const n1 = d.insertBlock("list-item", { list: "bullet", indent: 1 });
    d.insertText(n1, 0, "nested one");
    const n2 = d.insertBlock("list-item", { list: "bullet", indent: 1 });
    d.insertText(n2, 0, "nested two");
    return { parent, n1, n2 };
  });
  if (seeded === null) throw new Error("the pane's doc is not mounted");
  await rowsSettled(a);

  const outBefore = await outCount(a, "a");

  // Drag the second nested item up over the first (the vertical reorder of
  // a single row — a drop is a reorder, never a re-nest).
  const n1Row = rowOf(a, seeded.n1);
  const n2Row = rowOf(a, seeded.n2);
  const n1Box = await n1Row.boundingBox();
  const n2Box = await n2Row.boundingBox();
  if (n1Box === null || n2Box === null) throw new Error("the nested rows have no boxes");
  const handle = a.locator(`[data-block-id="${seeded.n2}"]`).first().locator('button[data-slot="docblocks/gutter"]');
  await handle.hover();
  const handleBox = await handle.boundingBox();
  if (handleBox === null) throw new Error("the gutter has no box");
  const fromY = handleBox.y + handleBox.height / 2;
  const toY = n1Box.y + n1Box.height * 0.25; // well above the n1 row's center
  await a.mouse.move(handleBox.x + handleBox.width / 2, fromY);
  await a.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await a.mouse.move(n1Box.x + 40, fromY - ((fromY - toY) * i) / 12);
    await a.waitForTimeout(30);
  }
  await a.mouse.up();

  // One wire update; the two nested rows swap, both stay at indent 1
  // (their indent stands — the drag does not re-nest).
  await expect.poll(async () => outCount(a, "a"), SETTLE).toBe(outBefore + 1);
  const afterState = await rootState(a, "a");
  const parentIndex = afterState.order.indexOf(seeded.parent);
  expect(afterState.order[parentIndex + 1]).toBe(seeded.n2);
  expect(afterState.order[parentIndex + 2]).toBe(seeded.n1);
  expect(afterState.indent(seeded.n1)).toBe(1);
  expect(afterState.indent(seeded.n2)).toBe(1);

  // The other pane shows the reordered nested run over the wire.
  await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual(afterState.order);

  await close();
});

test("a non-text row (a divider) drags by its row-level gutter handle", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "divider-row-handle");

  // The room starts with the panes' two seeded paragraphs; the pane's doc
  // handle adds a paragraph, a divider, and a paragraph (the divider is a
  // non-text row — its drag trigger is the row-level handle, not a
  // wrapper-internal one).
  const seeded = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return null;
    const before = d.insertBlock("paragraph");
    d.insertText(before, 0, "before the divider");
    const divider = d.insertBlock("divider");
    const after = d.insertBlock("paragraph");
    d.insertText(after, 0, "after the divider");
    return { before, divider, after };
  });
  if (seeded === null) throw new Error("the pane's doc is not mounted");
  // The seed's convergence stand over the animation settle: the burst
  // leaves a non-text tail mid-seed (the divider, before the "after"
  // paragraph lands), so pane b's remote tail guard writes its
  // deterministic tail paragraph over the wire mid-seed — the order's pins
  // stand the fully converged doc (a fast read would stand the pre-guard
  // snapshot and the late write would break the undo's order assert).
  // The predicate stands the boolean (an inner assert would stand the
  // poll's immediate stand — a thrown predicate is not retried).
  await expect
    .poll(async () => {
      const [orderA, orderB] = [(await rootState(a, "a")).order, (await rootState(b, "b")).order];
      return JSON.stringify(orderA) === JSON.stringify(orderB);
    }, SETTLE)
    .toBe(true);
  await expectStays(async () => {
    expect((await rootState(a, "a")).order).toEqual((await rootState(b, "b")).order);
  });
  // The enter animations' settle over the convergence stand (the drag's
  // seam measurement stands the rows' settled boxes).
  await rowsSettled(a);

  const outBefore = await outCount(a, "a");
  const beforeState = await rootState(a, "a");
  // The divider's row carries its own row-level gutter handle (the
  // non-text rows' drag trigger): the handle is a row child, not inside
  // the block's wrapper.
  const dividerRow = rowOf(a, seeded.divider);
  const dividerHandle = dividerRow.locator('button[data-slot="docblocks/gutter"]');
  expect(await dividerHandle.count()).toBe(1);
  expect(
    await a
      .locator(`[data-block-id="${seeded.divider}"]:not([data-slot="docblocks/row"])`)
      .first()
      .locator('button[data-slot="docblocks/gutter"]')
      .count()
  ).toBe(0);

  // Drag the divider above the "before" row (stepped moves so framer's
  // layout projection tracks the pointer).
  const beforeRow = rowOf(a, seeded.before);
  const dividerBox = await dividerRow.boundingBox();
  const beforeBox = await beforeRow.boundingBox();
  if (dividerBox === null || beforeBox === null) throw new Error("the rows have no boxes");
  await dividerHandle.hover();
  const handleBox = await dividerHandle.boundingBox();
  if (handleBox === null) throw new Error("the divider's row gutter has no box");
  const fromY = handleBox.y + handleBox.height / 2;
  const toY = beforeBox.y + beforeBox.height * 0.25; // well above the row's center
  await a.mouse.move(handleBox.x, fromY);
  await a.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await a.mouse.move(beforeBox.x + 40, fromY + ((toY - fromY) * i) / 12);
    await a.waitForTimeout(30);
  }
  await a.mouse.up();

  // One wire update: the move was one command. The divider precedes the
  // "before" row, and the other pane converges to the same flat order.
  await expect.poll(async () => outCount(a, "a"), SETTLE).toBe(outBefore + 1);
  const afterState = await rootState(a, "a");
  const dividerIndex = afterState.order.indexOf(seeded.divider);
  expect(afterState.order[dividerIndex + 1]).toBe(seeded.before);
  await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual(afterState.order);

  // One undo step restores the pre-drag order in both panes. The undo
  // hotkey reaches the doc only from inside the editor root, so click
  // back in first (the drag left the focus on the gutter handle).
  await a
    .locator(`[data-block-id="${seeded.before}"]`)
    .first()
    .locator('[data-slot="docblocks/block-content"]')
    .click();
  await a.keyboard.press("Control+z");
  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual(beforeState.order);
  await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual(beforeState.order);

  await close();
});
