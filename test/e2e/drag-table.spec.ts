// The page's drag over a table: the drop crosses the table's row, so the
// landing stands in the ROOT sequence (the table's children stand no seam —
// the flat view carries no nesting) and nothing lands in a cell's children
// over the page drag.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, insertBlockType, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the 15s
// SETTLE's panes + the page loads): the raised budget keeps the timeout
// class out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** The pane's current block wrapper (the harness labels it `data-current`). */
function currentWrapper(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id][data-current="true"]');
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

/** The table's cell children's shape (rows → cells → the children's ids). */
async function tableCells(page: Page, client: "a" | "b", tableId: string): Promise<string[][][] | null> {
  return page.evaluate(
    ({ client, tableId }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return null;
      return doc.getChildren(tableId).map((rowId) => doc.getChildren(rowId).map((cellId) => doc.getChildren(cellId)));
    },
    { client, tableId }
  );
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

test("a page drag over a table crosses the row in the root sequence; the cell's children stand invariant", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "table-row-crossing");
  try {
    // The scene: the starter paragraph, the table, the "after" paragraph
    // (the insert hook's tail order). The tail guarantee (the
    // EditorProvider's contract) may stand its empty paragraph behind the
    // non-text table — drag by ids, not by position. The pane-scoped rows
    // — not `rowOf` (unscoped — the two panes render the same ids) and not
    // the wrappers' count (the table's rows / cells stand nested
    // `data-block-id` elements of their own).
    const paneRow = (id: string) =>
      a.locator(`[data-testid="doc-a"] [data-slot="docblocks/row"]:has([data-block-id="${id}"])`).first();
    const tableId = await insertBlockType(a, "a", "table");
    const afterId = await insertBlockType(a, "a", "paragraph");
    await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
    await a.keyboard.type("after");
    await expect.poll(async () => paneRow(afterId).count(), SETTLE).toBe(1);
    const order = (await rootState(a, "a")).order;
    expect(order).toContain(tableId);
    expect(order).toContain(afterId);
    const starterId = order[0] as string;
    expect(starterId).not.toBe("");

    // The cell's children's shape before the drag (the harness's cell
    // paragraphs — the invariant is the shape, not emptiness).
    const cellsBefore = await tableCells(a, "a", tableId);
    expect(cellsBefore).not.toBeNull();

    // Drag the "after" paragraph above the table: the drop crosses the
    // table's row — the landing stands in the ROOT sequence (the table's
    // children stand no seam: the flat view carries no nesting), so no
    // block lands in a cell's children over the page drag (the
    // registry-legal cell move stands the public core API, not the drag).
    const tableRow = paneRow(tableId);
    const tableBox = await tableRow.boundingBox();
    if (tableBox === null) throw new Error("the table row has no box");
    const afterRow = paneRow(afterId);
    const afterBox = await afterRow.boundingBox();
    if (afterBox === null) throw new Error("the after row has no box");
    const handle = afterRow.locator('button[data-slot="docblocks/gutter"]');
    await handle.hover();
    const from = await handle.boundingBox();
    if (from === null) throw new Error("the gutter has no box");
    await pressDragTo(
      a,
      from.x + from.width / 2,
      from.y + from.height / 2,
      afterBox.x + 20,
      tableBox.y + tableBox.height / 4
    );

    // The order stands: "after" at the front, the rest (the table + the
    // tail paragraph, if it stood) in their relative order — in both
    // panes (the wire).
    const expected = [starterId, afterId, ...order.filter((id) => id !== starterId && id !== afterId)];
    await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual(expected);
    await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual(expected);

    // The cell's children stand invariant (nothing moved into / out of a
    // cell's children over the drag) — wait for the stand to settle (a
    // one-shot read can catch the doc mid-move-commit under full-suite load).
    await expect.poll(async () => tableCells(a, "a", tableId), SETTLE).toEqual(cellsBefore);
  } finally {
    await close();
  }
});
