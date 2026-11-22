// The mid-drag preview's card keeps the cell's boundary (the inset outline
// resolves over the drag shadow; the dragged chip follows the pointer with
// no left/top transition).
import { type Page, expect, test } from "@playwright/test";

import { twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the 15s
// SETTLE's panes + the page loads): the raised budget keeps the timeout
// class out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

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

const colHandle = (page: Page, index: number) =>
  page.locator(`[data-slot="docblocks/table-col-handle"][data-index="${index}"]`);

/**
 * Seeds the table's hover from a cell (the handles' chips need it to stand
 * pointer-events on — the handle band itself does not set the hover) and
 * waits for the chip of the cell's row / column to stand.
 */
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

test("the mid-drag preview's card keeps the cell's boundary (the inset outline resolves over the drag shadow)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "table-drag-boundary");
  try {
    await seedTable(
      a,
      "a",
      [
        ["a1", "a2", "a3"],
        ["b1", "b2", "b3"],
      ],
      [120, 140, 90]
    );
    // Drag the column 0 handle mid-drag (no release): the dragged cell's
    // card keeps a thin inset outline (the collapsed borders do not travel
    // over the transform) resolved over the drag's elevation, and the
    // dragged chip follows the pointer with no left/top transition.
    await seedHover(a, 0, colChipSel(0));
    const handleBox = await colHandle(a, 0).boundingBox();
    if (handleBox === null) throw new Error("the column handle has no box");
    const from = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
    await a.mouse.move(from.x, from.y);
    await a.mouse.down();
    await a.mouse.move(from.x + 80, from.y, { steps: 6 });
    // The in-flight drag's preview (the gesture must stay held over the
    // sample — the wall-clock's stand, not state-based).
    await a.waitForTimeout(300);
    const stands = await a.evaluate(() => {
      const cell = document.querySelector<HTMLTableCellElement>("td[data-block-id]");
      const chip = document.querySelector<HTMLElement>(`[data-slot="docblocks/table-col-handle"][data-index="0"]`);
      if (cell === null || chip === null) return null;
      return { shadow: getComputedStyle(cell).boxShadow, chipTransition: chip.style.transition };
    });
    if (stands === null) throw new Error("the mid-drag cell and chip should stand");
    // The inset outline resolves to a real shadow (the var's stand, not
    // the none's fallback) over the drag's elevation's list.
    expect(stands.shadow).toContain("inset");
    expect(stands.shadow).not.toBe("none");
    // The dragged chip's left/top transition stands gone (the lag's stand).
    expect(stands.chipTransition).toBe("");
    await a.mouse.up();
  } finally {
    await close();
  }
});
