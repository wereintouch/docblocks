// The add chips' drag: the row's append / remove (one undo step per drag)
// and the column's append / remove (the ghosts stand, the size stand
// updates).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the 15s
// SETTLE's panes + the page loads): the raised budget keeps the timeout
// class out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

interface CellSnap {
  blocks: number;
  text: string;
  rowColor?: string;
  columnColor?: string;
}

interface TableSnap {
  cols?: number;
  widths?: number[];
  rows: CellSnap[][];
}

/** The table's snapshot from the pane's doc (all the reads run in the page context — the doc handle is not serializable across the boundary). */
async function tableSnapshot(page: Page, client: "a" | "b", tableId: string): Promise<TableSnap | null> {
  return page.evaluate(
    ({ c, id }) => {
      const doc = window.__paneDocs?.[c];
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      const table = doc.getBlock(id);
      if (table === null || table.type !== "table") return null;
      const rows = (table.children ?? []).map((rowId) => {
        const row = doc.getBlock(rowId);
        return (row?.children ?? []).map((cellId) => {
          const cell = doc.getBlock(cellId);
          const children = cell?.children ?? [];
          return {
            blocks: children.length,
            text: children.map((childId) => doc.getText(childId)).join("\u0000"),
            rowColor: cell?.attrs?.rowColor as string | undefined,
            columnColor: cell?.attrs?.columnColor as string | undefined,
          };
        });
      });
      return {
        cols: table.columnOrder?.length,
        widths: table.attrs?.columnWidths as number[] | undefined,
        rows,
      };
    },
    { c: client, id: tableId }
  );
}

/** The first table block's id in the pane's doc (null when absent). */
async function findTableId(page: Page, client: "a" | "b"): Promise<string | null> {
  return page.evaluate((c) => {
    const doc = window.__paneDocs?.[c];
    if (doc === null || doc === undefined) return null;
    for (const [id, block] of Object.entries(doc.toJSON().blocks)) {
      if (block.type === "table") return id;
    }
    return null;
  }, client);
}

interface SeedColors {
  row?: number;
  rowColor?: string;
  col?: number;
  colColor?: string;
}

/** Seed one table in the pane's doc (the grid's cells — a non-empty cell stands one paragraph with the text — the optional widths and the row/column colors) and return the table's id. */
async function seedTable(
  page: Page,
  client: "a" | "b",
  grid: string[][],
  widths?: number[],
  colors?: SeedColors
): Promise<string> {
  return page.evaluate(
    ({ c, grid, widths, colors }) => {
      const doc = window.__paneDocs?.[c];
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      const cols = grid[0]?.length ?? 0;
      let tableId = "";
      doc.transact(() => {
        tableId = doc.insertBlock("table", { cols, ...(widths !== undefined ? { columnWidths: widths } : {}) });
        for (let ri = 0; ri < grid.length; ri++) {
          const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
          const row = grid[ri]!;
          for (let ci = 0; ci < row.length; ci++) {
            const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
            if (colors?.row === ri && colors.rowColor !== undefined) {
              doc.updateBlock(cellId, { rowColor: colors.rowColor });
            }
            if (colors?.col === ci && colors.colColor !== undefined) {
              doc.updateBlock(cellId, { columnColor: colors.colColor });
            }
            const text = row[ci]!;
            if (text !== "") {
              const p = doc.insertBlock("paragraph", undefined, { parent: cellId });
              doc.insertText(p, 0, text);
            }
          }
        }
      });
      return tableId;
    },
    { c: client, grid, widths, colors }
  );
}

const tableEl = (page: Page) => page.locator('table[data-slot="docblocks/table"]');

/** The add chip's press + drag (the chip stands pointer-events-none until
 * the frame's hover — the first move over the chip's box seeds it). */
async function dragAddChip(page: Page, slot: string, dx: number, dy: number): Promise<void> {
  const chip = page.locator(`[data-slot="${slot}"]`);
  const box = await chip.boundingBox();
  if (box === null) throw new Error(`the ${slot} chip has no box`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // The chips stand pointer-events-none until the frame's hover (the row
  // chip's box stands below the frame — the hover seeds over the table
  // itself first, then the move stands the chip).
  const tableBox = await tableEl(page).boundingBox();
  if (tableBox === null) throw new Error("the table has no box");
  await page.mouse.move(tableBox.x + tableBox.width / 2, tableBox.y + 20);
  await page.mouse.move(x, y);
  await page.mouse.down();
  const steps = 6;
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(x + (dx * step) / steps, y + (dy * step) / steps);
  }
  await page.mouse.up();
}

test("the add-row chip's drag appends / removes several rows (one undo step per drag)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "tbl-rowdrag");
  try {
    const tableId = await seedTable(a, "a", [
      ["a1", "a2"],
      ["b1", "b2"],
    ]);
    await expect.poll(async () => findTableId(b, "b"), SETTLE).not.toBeNull();

    // The drag down 48 px = two rows (the step's 24 px): A and B.
    await dragAddChip(a, "docblocks/table-add-row", 0, 48);
    await expect.poll(async () => (await tableSnapshot(a, "a", tableId))?.rows.length, SETTLE).toBe(4);
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.rows.length, SETTLE).toBe(4);

    // One undo step: the whole drag is one transact.
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a;
      if (doc === null || doc === undefined) throw new Error("the doc is not mounted");
      doc.undo();
    });
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.rows.length, SETTLE).toBe(2);

    // The drag up 24 px = one removal (the last row).
    await dragAddChip(a, "docblocks/table-add-row", 0, -24);
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.rows.length, SETTLE).toBe(1);
  } finally {
    await close();
  }
});

test("the add-column chip's drag appends / removes several columns (the ghosts stand, the size stand updates)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "tbl-coldrag");
  try {
    const tableId = await seedTable(a, "a", [
      ["a1", "a2"],
      ["b1", "b2"],
    ]);
    await expect.poll(async () => findTableId(b, "b"), SETTLE).not.toBeNull();

    // The size stand (the resulting size) is hidden at rest — it stands
    // only during the add chips' drag.
    const badge = a.locator('[data-slot="docblocks/table-size"]');
    await expect(badge).toHaveCount(0);

    // The drag right: 100 px = one base column width = one column
    // (the ghosts stand on the drag, the stand stands the result).
    const chip = a.locator('[data-slot="docblocks/table-add-column"]');
    const chipBox = await chip.boundingBox();
    if (chipBox === null) throw new Error("the chip has no box");
    const cx = chipBox.x + chipBox.width / 2;
    const cy = chipBox.y + chipBox.height / 2;
    await a.mouse.move(cx, cy);
    await a.mouse.down();
    await a.mouse.move(cx + 100, cy);
    expect(await a.locator('[data-slot="docblocks/table-ghost-column"]').count()).toBe(1);
    await expect(badge).toHaveText("3 × 2");
    await a.mouse.move(cx + 200, cy);
    expect(await a.locator('[data-slot="docblocks/table-ghost-column"]').count()).toBe(2);
    await expect(badge).toHaveText("4 × 2");
    await a.mouse.up();
    await expect.poll(async () => (await tableSnapshot(a, "a", tableId))?.cols, SETTLE).toBe(4);
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.cols, SETTLE).toBe(4);
    // The release: the stand is gone.
    await expect(badge).toHaveCount(0);

    // The drag left 100 px = one removal (the last column), the stand
    // stands the result on the drag.
    await dragAddChip(a, "docblocks/table-add-column", -100, 0);
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.cols, SETTLE).toBe(3);
    await expect(badge).toHaveCount(0);

    // One undo step per drag (the second drag's undo stands).
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a;
      if (doc === null || doc === undefined) throw new Error("the doc is not mounted");
      doc.undo();
    });
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.cols, SETTLE).toBe(4);

    // The drag back to the zero-count stands nothing: the release issues
    // no command and the capture's following click inserts nothing (the
    // visual stood the no-op — the stand and the ghosts are gone).
    const chip2 = a.locator('[data-slot="docblocks/table-add-column"]');
    const chipBox2 = await chip2.boundingBox();
    if (chipBox2 === null) throw new Error("the chip has no box");
    const cx2 = chipBox2.x + chipBox2.width / 2;
    const cy2 = chipBox2.y + chipBox2.height / 2;
    await a.mouse.move(cx2, cy2);
    await a.mouse.down();
    await a.mouse.move(cx2 + 100, cy2); // the one-count
    await a.mouse.move(cx2 + 20, cy2); // back to the zero-count
    await expect(a.locator('[data-slot="docblocks/table-ghost-column"]')).toHaveCount(0);
    await expect(badge).toHaveCount(0);
    await a.mouse.up();
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.cols, SETTLE).toBe(4);
  } finally {
    await close();
  }
});
