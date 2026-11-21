// The row/column's background colors: the column's color over the row's at
// the intersection, and the none's swatch's conditional reveal (B synced).
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

/** A swatch's pick over the handle's Background sub: the pointer's open
 * (the press over the handle's chip) + the force's single presses over the
 * Background trigger and the target's swatch. The force's stand: the
 * actionability's retry loop re-presses the trigger a few seconds later
 * over the load (the press lands on the trigger again and the toggle
 * closes the whole menu), so the verified-press's wait is dropped — one
 * press, one state hop. The swatch's press stands over the current
 * center (the popper's entry's reposition is outlasted by the fresh's
 * box at the press's moment). */
async function pickSwatch(a: Page, kind: "row" | "column", swatch: "orange" | "green" | "none"): Promise<void> {
  const menu = kind === "row" ? rowMenu(a) : colMenu(a);
  await pressHandle(a, kind, 0, 2);
  await expect(menu).toBeVisible();
  await menu.getByText("Background", { exact: true }).click({ force: true });
  const palette = menu.locator('[data-slot="docblocks/table-color-palette"][data-state="open"]');
  await expect(palette).toBeVisible(SETTLE);
  const target = palette.locator(
    swatch === "none"
      ? '[data-slot="docblocks/palette-none"]'
      : `[data-slot="docblocks/palette-swatch"][data-color="var(--docblocks-palette-${swatch})"]`
  );
  await target.click({ force: true, timeout: 5000 });
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

test("the column color over the row color (the intersection); the remove reveals the row's (B synced)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "tbl-colors");
  try {
    const tableId = await seedTable(a, "a", [
      ["a1", "a2"],
      ["b1", "b2"],
    ]);
    await expect.poll(async () => findTableId(b, "b"), SETTLE).not.toBeNull();

    // The row 0 color (the amber) on its cells. The swatch's entry is a
    // theme token; the commit resolves it to the active theme's hex (the
    // harness stands dark — the muted amber / emerald).
    await pickSwatch(a, "row", "orange");

    // The column 0 color (the emerald) on its cells — the intersection cell
    // (0,0) stands the COLUMN color (the column over the row).
    await pickSwatch(a, "column", "green");

    // Computed backgrounds (A and B): the intersection = the column's
    // emerald; the row-only cell (0,1) = the row's amber.
    const cellBg = (pg: Page, row: number, col: number) =>
      pg
        .locator("td")
        .nth(row * 2 + col)
        .evaluate((el) => getComputedStyle(el).backgroundColor);
    await expect.poll(async () => cellBg(a, 0, 0), SETTLE).toBe("rgb(99, 184, 126)");
    await expect.poll(async () => cellBg(a, 0, 1), SETTLE).toBe("rgb(207, 145, 85)");
    await expect.poll(async () => cellBg(b, 0, 0), SETTLE).toBe("rgb(99, 184, 126)");
    await expect.poll(async () => cellBg(b, 0, 1), SETTLE).toBe("rgb(207, 145, 85)");

    // The JSON's attrs (B): the column color stands on the column's cells,
    // the row color on the row's cells.
    const snap = await expect
      .poll(async () => (await tableSnapshot(b, "b", tableId))?.rows[0]?.[0]?.columnColor, SETTLE)
      .toBe("#63b87e")
      .then(async () => tableSnapshot(b, "b", tableId));
    expect(snap?.rows[0]?.[0]?.columnColor).toBe("#63b87e");
    expect(snap?.rows[0]?.[0]?.rowColor).toBe("#cf9155");
    expect(snap?.rows[0]?.[1]?.columnColor).toBeUndefined();
    expect(snap?.rows[0]?.[1]?.rowColor).toBe("#cf9155");
    expect(snap?.rows[1]?.[0]?.columnColor).toBe("#63b87e");
    expect(snap?.rows[1]?.[0]?.rowColor).toBeUndefined();

    // The clear (the column's, the none's swatch over the shared's palette)
    // reveals the row's color at the intersection.
    await pickSwatch(a, "column", "none");
    await expect.poll(async () => cellBg(a, 0, 0), SETTLE).toBe("rgb(207, 145, 85)");

    // The row's clear (the none's swatch) clears the background (no color
    // stands — the computed color falls back to the transparent).
    await pickSwatch(a, "row", "none");
    await expect.poll(async () => cellBg(a, 0, 0), SETTLE).toBe("rgba(0, 0, 0, 0)");
    const afterRemoval = await expect
      .poll(async () => (await tableSnapshot(b, "b", tableId))?.rows[0]?.[0]?.rowColor, SETTLE)
      .toBeUndefined()
      .then(async () => tableSnapshot(b, "b", tableId));
    expect(afterRemoval?.rows[0]?.[0]?.rowColor).toBeUndefined();
    expect(afterRemoval?.rows[0]?.[0]?.columnColor).toBeUndefined();

    // The none's swatch stands unconditional (the shared's palette's stand —
    // the inactive's aria over the absent color).
    await pressHandle(a, "row", 0, 2);
    await expect(rowMenu(a)).toBeVisible();
    await rowMenu(a).getByText("Background", { exact: true }).click({ force: true });
    await expect(
      rowMenu(a).locator(
        '[data-slot="docblocks/table-color-palette"][data-state="open"] [data-slot="docblocks/palette-none"]'
      )
    ).toBeVisible();
  } finally {
    await close();
  }
});
