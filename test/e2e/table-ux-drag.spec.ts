// The column's drag (the width and the color travel with the column; a
// no-op drag issues no command) and the row's drag (the wire reaches B; the
// parting preview stands mid-drag with no doc write).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, expectStays, outCount, twoPanes } from "./helpers";

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

/** The pointer drag from `from` to `to` (the stepped move stands the session's pointer-moves). */
async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 8;
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps);
  }
  await page.mouse.up();
}

/** The no-op handle drag (a small move without a midpoint crossing — no command). */
async function dragNoop(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 2, y + 2);
  await page.mouse.up();
}

test("the column drag moves the column with its width and color (B); a no-op drag issues no command", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "tbl-drag");
  try {
    const tableId = await seedTable(
      a,
      "a",
      [
        ["a1", "a2", "a3"],
        ["b1", "b2", "b3"],
      ],
      [120, 140, 90],
      { col: 0, colColor: "#e11d48" }
    );
    await expect.poll(async () => findTableId(b, "b"), SETTLE).not.toBeNull();

    // Drag the column 0 handle over the last column's right half (past its
    // midpoint — the midpoint is the landing boundary): the column lands
    // last — its width (120) and its color travel with it; B's JSON stands
    // the new order.
    await seedHover(a, 0, colChipSel(0));
    const handleBox = await colHandle(a, 0).boundingBox();
    const lastCell = await a.locator("td").nth(2).boundingBox();
    if (lastCell === null) throw new Error("the last cell has no box");
    const target = { x: lastCell.x + lastCell.width * 0.75, y: lastCell.y + lastCell.height / 2 };
    if (handleBox === null) throw new Error("the column handle has no box");
    await dragTo(a, { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 }, target);
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.widths, SETTLE).toEqual([140, 90, 120]);
    const after = await tableSnapshot(b, "b", tableId);
    expect(after?.rows[0]?.[2]?.columnColor).toBe("#e11d48");
    expect(after?.rows[0]?.[0]?.columnColor).toBeUndefined();
    expect(after?.rows[0]?.map((c) => c.text)).toEqual(["a2", "a3", "a1"]);

    // The no-op drag (a small move without a midpoint crossing) issues no
    // command: the wire count stands (the window's stand), B's order stands.
    const outBefore = await outCount(a, "a");
    await seedHover(a, 0, colChipSel(0));
    const handleBox2 = await colHandle(a, 0).boundingBox();
    if (handleBox2 === null) throw new Error("the column handle has no box");
    await dragNoop(a, handleBox2.x + handleBox2.width / 2, handleBox2.y + handleBox2.height / 2);
    await expectStays(async () => {
      expect(await outCount(a, "a")).toBe(outBefore);
    });
    expect((await tableSnapshot(b, "b", tableId))?.widths).toEqual([140, 90, 120]);
  } finally {
    await close();
  }
});

test("the row drag moves the row over the wire (B); the parting preview stands mid-drag with no doc write", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "tbl-row-drag");
  try {
    const tableId = await seedTable(
      a,
      "a",
      [
        ["a1", "a2", "a3"],
        ["b1", "b2", "b3"],
        ["c1", "c2", "c3"],
      ],
      [120, 140, 90]
    );
    await expect.poll(async () => findTableId(b, "b"), SETTLE).not.toBeNull();

    // Drag the row 0 handle over row 1's lower half (past its midpoint —
    // the midpoint is the landing boundary): the row lands at slot 1.
    // Mid-drag: the dragged row follows the pointer, the stationary rows
    // stand shifted by one row height, and the doc stands untouched
    // (no command until the release).
    await seedHover(a, 0, rowChipSel(0));
    const handleBox = await rowHandle(a, 0).boundingBox();
    const rowsBox = await a.evaluate(() => {
      const table = document.querySelector<HTMLTableElement>('table[data-slot="docblocks/table"]');
      if (table === null) return null;
      const rect = table.getBoundingClientRect();
      return Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody > tr")).map((tr) => ({
        top: tr.offsetTop + rect.top,
        h: tr.offsetHeight,
      }));
    });
    if (handleBox === null || rowsBox === null) throw new Error("the row handle or rows have no box");
    const targetY = rowsBox[1]!.top + rowsBox[1]!.h * 0.75;
    const startY = handleBox.y + handleBox.height / 2;
    const startX = handleBox.x + handleBox.width / 2;
    const outBefore = await outCount(a, "a");
    await a.mouse.move(startX, startY);
    await a.mouse.down();
    // Past row 1's midpoint (the landing boundary crossed): the dragged
    // row's cells follow the pointer (the row's drag applies over the
    // cells — the `<tr>` is not a CSS transformable element), row 1's
    // cells shift up.
    await a.mouse.move(startX, startY + (targetY - startY) * 0.95, { steps: 6 });
    await a.waitForTimeout(300);
    const midStands = await a.evaluate(() => {
      const table = document.querySelector<HTMLTableElement>('table[data-slot="docblocks/table"]');
      return Array.from(table!.querySelectorAll<HTMLTableRowElement>("tbody > tr")).map(
        (tr) => tr.querySelector<HTMLTableCellElement>("td")?.style.transform ?? ""
      );
    });
    expect(midStands[0]).toMatch(/translate\(0px, \d+(\.\d+)?px\)/);
    expect(midStands[1]).toMatch(/translate\(0px, -\d+(\.\d+)?px\)/);
    // No doc write mid-drag: the wire count stands (the window's stand).
    await expectStays(async () => {
      expect(await outCount(a, "a")).toBe(outBefore);
    });
    await a.mouse.move(startX, targetY, { steps: 4 });
    await a.mouse.up();
    await expect
      .poll(async () => (await tableSnapshot(b, "b", tableId))?.rows.map((row) => row[0]?.text), SETTLE)
      .toEqual(["b1", "a1", "c1"]);
    const after = await tableSnapshot(b, "b", tableId);
    expect(after?.rows[0]?.map((c) => c.text)).toEqual(["b1", "b2", "b3"]);
    expect(after?.rows[1]?.map((c) => c.text)).toEqual(["a1", "a2", "a3"]);
  } finally {
    await close();
  }
});
