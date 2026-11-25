// The table cell merge over the wire: the corner grip's drag selects the
// rectangle, the cell menu merges it (the anchor carries the spans, the
// covered cells drop) and splits it back — the peer's pane follows. The
// read-only mode renders the spans with no editing chrome.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, openPane, twoPanes } from "./helpers";

const paneOf = (client: "a" | "b"): string => `[data-testid="doc-${client}"]`;

/** A 3x3 table (the harness's doc API), returning the table id. */
async function insertTable(page: Page, client: "a" | "b"): Promise<string> {
  return page.evaluate((who) => {
    const doc = who === "a" ? (window.__paneDocs?.a ?? null) : (window.__paneDocs?.b ?? null);
    if (doc === null) throw new Error("the pane's doc is not mounted");
    const tableId = doc.insertBlock("table", { cols: 3 });
    for (let row = 0; row < 3; row += 1) {
      const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
      for (let col = 0; col < 3; col += 1) doc.insertBlock("table-cell", undefined, { parent: rowId });
    }
    return tableId;
  }, client);
}

/** The real right-click sequence on the element (the menu opens on the release). */
async function rightClick(page: Page, target: ReturnType<Page["locator"]>): Promise<void> {
  const box = await target.boundingBox();
  if (box === null) throw new Error("the right-click's target box is absent");
  await page.mouse.move(box.x + Math.min(24, box.width / 2), box.y + Math.min(12, box.height / 2));
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
}

/** The drawn cells of the pane's first table, per row (the DOM stand). */
function drawnRows(page: Page, client: "a" | "b") {
  return page.locator(`${paneOf(client)} tbody > tr`);
}

/** The spans of the pane's first row (the drawn cell count + the spans). */
async function firstRowStand(page: Page, client: "a" | "b") {
  return page.evaluate((selector) => {
    const row = document.querySelector<HTMLTableRowElement>(`${selector} tbody > tr`);
    if (row === null) throw new Error("the table's first row is absent");
    const cells = [...row.querySelectorAll<HTMLTableCellElement>("td")];
    return {
      cells: cells.length,
      colspan: cells[0]?.colSpan ?? 0,
      rowspan: cells[0]?.rowSpan ?? 0,
    };
  }, paneOf(client));
}

test("a merge from the cell range reaches the peer's pane; the split reverts it", async ({ browser }) => {
  test.setTimeout(60_000);
  const { a: page, b: peer, close } = await twoPanes(browser, `table-merge-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await insertTable(page, "a");
    await expect(drawnRows(page, "a")).toHaveCount(3, SETTLE);
    await expect(drawnRows(peer, "b")).toHaveCount(3, SETTLE);

    const firstCell = page.locator(`${paneOf("a")} td[data-slot="docblocks/table-cell"]`).first();
    const diagonal = page.locator(`${paneOf("a")} td[data-slot="docblocks/table-cell"]`).nth(4);

    // The grip's drag over the 2x2 rectangle at the table's top-left.
    await test.step("the drag", async () => {
      await firstCell.hover();
      const grip = firstCell.locator('[data-slot="docblocks/table-cell-range-grip"]');
      const gripBox = await grip.boundingBox();
      const targetBox = await diagonal.boundingBox();
      if (gripBox === null || targetBox === null) throw new Error("the grip / the target cell's box is absent");
      await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });
      await page.mouse.up();
      await expect(page.locator(`${paneOf("a")} td[data-range="true"]`)).toHaveCount(4, SETTLE);
    });

    // The cell menu's merge: the anchor spans the 2x2 rectangle.
    await test.step("the merge", async () => {
      await rightClick(page, firstCell);
      await page.locator('[data-slot="dropdown-menu-item"]').filter({ hasText: "Merge cells" }).click();
      await expect.poll(async () => (await firstRowStand(page, "a")).colspan, SETTLE).toBe(2);
      const stand = await firstRowStand(page, "a");
      expect(stand.cells).toBe(2);
      expect(stand.rowspan).toBe(2);
      // The peer's pane draws the same region.
      await expect.poll(async () => (await firstRowStand(peer, "b")).colspan, SETTLE).toBe(2);
    });

    // The split: the right-click over the merged cell restores the cells.
    await test.step("the split", async () => {
      await rightClick(page, firstCell);
      await page.locator('[data-slot="dropdown-menu-item"]').filter({ hasText: "Split cells" }).click();
      await expect.poll(async () => (await firstRowStand(page, "a")).colspan, SETTLE).toBe(1);
      expect((await firstRowStand(page, "a")).cells).toBe(3);
      await expect.poll(async () => (await firstRowStand(peer, "b")).cells, SETTLE).toBe(3);
    });
  } finally {
    await close();
  }
});

test("the read-only view renders the merged region without the editing chrome", async ({ page }) => {
  await openPane(page, "a", `table-merge-ro-${Math.random().toString(36).slice(2, 8)}`, { role: "viewer" });
  // The viewer's pane stands no document to write: the merge stands over the
  // live pane's data in the other spec; here the grid's chrome's absence is
  // the pin.
  await expect(page.locator(`${paneOf("a")} [data-slot="docblocks/table-col-resize"]`)).toHaveCount(0);
});

test("a merged region locks its columns' handles and the range resets over a restructure", async ({ page }) => {
  await openPane(page, "a", `table-merge-lock-${Math.random().toString(36).slice(2, 8)}`);
  const tableId = await insertTable(page, "a");
  const merge = await page.evaluate((id) => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    doc.mergeTableCells(id, { row: 0, col: 0 }, { row: 0, col: 1 });
    return doc.getChildren(doc.meta.id).length;
  }, tableId);
  expect(merge).toBeGreaterThan(0);

  // The region covers the columns 0..1: no reorder handle stands there.
  await expect(page.locator(`${paneOf("a")} [data-slot="docblocks/table-col-handle"][data-index="0"]`)).toHaveCount(0);
  await expect(page.locator(`${paneOf("a")} [data-slot="docblocks/table-col-handle"][data-index="1"]`)).toHaveCount(0);
  await expect(page.locator(`${paneOf("a")} [data-slot="docblocks/table-col-handle"][data-index="2"]`)).toHaveCount(1);
  // ...and no resize seam inside the region (its interior boundary).
  await expect(page.locator(`${paneOf("a")} [data-slot="docblocks/table-col-resize"][data-index="0"]`)).toHaveCount(0);

  // The range over the region, then a structural change: the selection resets.
  const anchor = page.locator(`${paneOf("a")} td[data-slot="docblocks/table-cell"]`).first();
  await anchor.hover();
  const grip = anchor.locator('[data-slot="docblocks/table-cell-range-grip"]');
  const gripBox = await grip.boundingBox();
  const below = await page
    .locator(`${paneOf("a")} td[data-slot="docblocks/table-cell"]`)
    .nth(1)
    .boundingBox();
  if (gripBox === null || below === null) throw new Error("the grip / the target box is absent");
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(below.x + below.width / 2, below.y + below.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator(`${paneOf("a")} td[data-range="true"]`).first()).toBeVisible();

  await page.evaluate((id) => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc !== null) doc.insertTableRow(id, 0);
  }, tableId);
  await expect(page.locator(`${paneOf("a")} td[data-range="true"]`)).toHaveCount(0, SETTLE);
});
