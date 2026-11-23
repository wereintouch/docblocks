// The table's handle menus: the row's insert / move / duplicate / clear and
// the column's insert right / clear (the wire reaches B; one undo step), and
// the last row / column's delete converts the table into a paragraph (the
// block id stands).
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

const rowHandle = (page: Page, index: number) =>
  page.locator(`[data-slot="docblocks/table-row-handle"][data-index="${index}"]`);

const colHandle = (page: Page, index: number) =>
  page.locator(`[data-slot="docblocks/table-col-handle"][data-index="${index}"]`);

// The open menu's content (one content stands per handle — the closed ones
// stay mounted with data-state="closed").
const rowMenu = (page: Page) => page.locator('[data-slot="docblocks/table-row-menu"][data-state="open"]');
const colMenu = (page: Page) => page.locator('[data-slot="docblocks/table-col-menu"][data-state="open"]');

/**
 * The press on a handle (the press without a drag opens its menu). The
 * chip stands pointer-events-none until the table's hover stands (the
 * pointer over the handle band keeps the current hover — it does not set
 * one), so the press seeds the hover from the row's / column's first cell
 * first and waits for the chip to stand before the down (a zero-delta
 * move may not dispatch the pointermove that seeds the hover).
 */
async function pressHandle(page: Page, kind: "row" | "column", index: number, cols: number): Promise<void> {
  const handle = kind === "row" ? rowHandle(page, index) : colHandle(page, index);
  await seedHover(page, kind === "row" ? index * cols : index, kind === "row" ? rowChipSel(index) : colChipSel(index));
  const box = await handle.boundingBox();
  if (box === null) throw new Error("the handle has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * Seeds the table's hover from a cell (the handles' chips need it to stand
 * pointer-events on — the handle band itself does not set the hover) and
 * waits for the chip of the cell's row / column to stand.
 */
const rowChipSel = (index: number) => `[data-slot="docblocks/table-row-handle"][data-index="${index}"]`;
const colChipSel = (index: number) => `[data-slot="docblocks/table-col-handle"][data-index="${index}"]`;

/**
 * Seeds the table's hover from a cell (the handles' chips need it to stand
 * pointer-events on — the handle band itself does not set the hover) and
 * waits for the SPECIFIC chip to stand (a stale hover keeps the other chips
 * on — waiting for any of them would resolve before the new hover lands).
 */
async function seedHover(page: Page, cellIndex: number, chipSel: string): Promise<void> {
  const cellBox = await page.locator("td").nth(cellIndex).boundingBox();
  if (cellBox === null) throw new Error("the cell has no box");
  const cx = cellBox.x + cellBox.width / 2;
  const cy = cellBox.y + cellBox.height / 2;
  // A transient overlay (a still-animating closed menu) may swallow the
  // first moves, so the moves are re-dispatched until the chip stands.
  const deadline = Date.now() + 2000;
  for (;;) {
    await page.mouse.move(cx, cy);
    await page.mouse.move(cx + 1, cy);
    const pe = await page.evaluate((sel) => {
      const chip = document.querySelector(sel);
      return chip === null ? null : getComputedStyle(chip).pointerEvents;
    }, chipSel);
    if (pe !== null && pe !== "none") return;
    if (Date.now() >= deadline) throw new Error("the chip never stood pointer-events on");
    await page.waitForTimeout(50);
  }
}

test("the row handle menu: insert / move / duplicate / clear (the wire reaches B; one undo step)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "tbl-rowmenu");
  try {
    const tableId = await seedTable(a, "a", [
      ["a1", "a2"],
      ["b1", "b2"],
    ]);
    await expect.poll(async () => findTableId(b, "b"), SETTLE).not.toBeNull();

    // Insert below row 0: B sees 3 rows; one undo step reverts it.
    await pressHandle(a, "row", 0, 2);
    await expect(rowMenu(a)).toBeVisible();
    await rowMenu(a).getByText("Insert below", { exact: true }).click();
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.rows.length, SETTLE).toBe(3);
    await a.evaluate(() => window.__paneDocs?.a?.undo());
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.rows.length, SETTLE).toBe(2);

    // Move row 0 down: the row order swaps (the texts travel with the row).
    await pressHandle(a, "row", 0, 2);
    await expect(rowMenu(a)).toBeVisible();
    await rowMenu(a).getByText("Move down", { exact: true }).click();
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.rows[0]?.[0]?.text, SETTLE).toBe("b1");
    expect((await tableSnapshot(b, "b", tableId))?.rows[1]?.[0]?.text).toBe("a1");

    // Duplicate row 0 (now the b-row): the new row stands the duplicated text.
    await pressHandle(a, "row", 0, 2);
    await expect(rowMenu(a)).toBeVisible();
    await rowMenu(a).getByText("Duplicate", { exact: true }).click();
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.rows.length, SETTLE).toBe(3);
    expect((await tableSnapshot(b, "b", tableId))?.rows[1]?.[0]?.text).toBe("b1");
    expect((await tableSnapshot(b, "b", tableId))?.rows[1]?.[1]?.text).toBe("b2");

    // Clear content of the last row: its cells stand empty (the cells stay).
    await pressHandle(a, "row", 2, 2);
    await expect(rowMenu(a)).toBeVisible();
    await rowMenu(a).getByText("Clear content", { exact: true }).click();
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.rows[2]?.[0]?.blocks, SETTLE).toBe(0);
    expect((await tableSnapshot(b, "b", tableId))?.rows[2]?.[0]?.text).toBe("");
  } finally {
    await close();
  }
});

test("the column handle menu: insert right and clear content (B)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "tbl-colmenu");
  try {
    const tableId = await seedTable(
      a,
      "a",
      [
        ["a1", "a2", "a3"],
        ["b1", "b2", "b3"],
      ],
      [120, 140, 90]
    );
    await expect.poll(async () => findTableId(b, "b"), SETTLE).not.toBeNull();

    // Insert right of column 0: B sees 4 columns (the new empty column
    // stands between them).
    await pressHandle(a, "column", 0, 3);
    await expect(colMenu(a)).toBeVisible();
    await colMenu(a).getByText("Insert right", { exact: true }).click();
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.cols, SETTLE).toBe(4);
    expect((await tableSnapshot(b, "b", tableId))?.rows[0]?.map((c) => c.text)).toEqual(["a1", "", "a2", "a3"]);

    // Clear content of the last column: its cells stand empty (the cells
    // themselves stay).
    await pressHandle(a, "column", 3, 3);
    await expect(colMenu(a)).toBeVisible();
    await colMenu(a).getByText("Clear content", { exact: true }).click();
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.rows[1]?.[3]?.blocks, SETTLE).toBe(0);
    expect((await tableSnapshot(b, "b", tableId))?.rows[1]?.[3]?.text).toBe("");
  } finally {
    await close();
  }
});

test("the last row / column converts the table into a paragraph (the block id stands)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "tbl-convert");
  try {
    const blockTypeOf = (pg: Page, client: "a" | "b", id: string) =>
      pg.evaluate(
        ({ c, blockId }) => {
          const doc = window.__paneDocs?.[c];
          if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
          return doc.getBlock(blockId)?.type ?? null;
        },
        { c: client, blockId: id }
      );

    // Row path: the 1×2 table loses its only row → the paragraph.
    const tableId = await seedTable(a, "a", [["a1", "a2"]]);
    await expect.poll(async () => findTableId(b, "b"), SETTLE).not.toBeNull();
    await pressHandle(a, "row", 0, 2);
    await expect(rowMenu(a)).toBeVisible();
    await rowMenu(a).getByText("Delete", { exact: true }).click();
    await expect.poll(async () => tableSnapshot(b, "b", tableId), SETTLE).toBeNull();
    expect(await blockTypeOf(b, "b", tableId)).toBe("paragraph");
    await expect(b.locator("table")).toHaveCount(0);

    // Column path: the 2×1 table loses its only column → the paragraph.
    const table2 = await seedTable(a, "a", [["c1"], ["c2"]]);
    await expect.poll(async () => findTableId(a, "a"), SETTLE).toBe(table2);
    await pressHandle(a, "column", 0, 1);
    await expect(colMenu(a)).toBeVisible();
    await colMenu(a).getByText("Delete", { exact: true }).click();
    await expect.poll(async () => tableSnapshot(b, "b", table2), SETTLE).toBeNull();
    expect(await blockTypeOf(b, "b", table2)).toBe("paragraph");
  } finally {
    await close();
  }
});
