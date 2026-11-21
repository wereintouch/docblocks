// The seam's resize: the release commits one width (the 50 px floor, the
// undo reverts), the last column's right-edge seam, and the keyboard's path
// (the handle's focus + the Enter open + the keyboard's pick; the seam's
// arrow resize).
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

// The open menu's content (one content stands per handle — the closed ones
// stay mounted with data-state="closed").
const rowMenu = (page: Page) => page.locator('[data-slot="docblocks/table-row-menu"][data-state="open"]');

const seam = (page: Page, index: number) =>
  page.locator(`[data-slot="docblocks/table-col-resize"][data-index="${index}"]`);

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

test("the seam resize: the release commits one width (B JSON); the 50 px floor; the undo reverts", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "tbl-resize");
  try {
    const tableId = await seedTable(
      a,
      "a",
      [
        ["a1", "a2"],
        ["b1", "b2"],
      ],
      [100, 150]
    );
    await expect.poll(async () => findTableId(b, "b"), SETTLE).not.toBeNull();

    // The seam drag +60 px: the LEFT column's width commits on the release
    // (160), the other column stands (150) — B's JSON.
    const seamBox = await seam(a, 0).boundingBox();
    if (seamBox === null) throw new Error("the seam has no box");
    const sx = seamBox.x + seamBox.width / 2;
    const sy = seamBox.y + seamBox.height / 2;
    await dragTo(a, { x: sx, y: sy }, { x: sx + 60, y: sy });
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.widths, SETTLE).toEqual([160, 150]);

    // The drag far left clamps to the 50 px floor (the release commits the
    // clamped value — one command per release). The release stands in the
    // viewport: the firefox engine's pointer capture loses the release
    // over the off-screen coordinates.
    const seamBox2 = await seam(a, 0).boundingBox();
    if (seamBox2 === null) throw new Error("the seam has no box");
    const sx2 = seamBox2.x + seamBox2.width / 2;
    const sy2 = seamBox2.y + seamBox2.height / 2;
    await dragTo(a, { x: sx2, y: sy2 }, { x: Math.max(10, sx2 - 500), y: sy2 });
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.widths, SETTLE).toEqual([50, 150]);

    // One undo step reverts the last commit.
    await a.evaluate(() => window.__paneDocs?.a?.undo());
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.widths, SETTLE).toEqual([160, 150]);
  } finally {
    await close();
  }
});

test("the last column resizes at the table's right edge (the right-edge seam)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "tbl-lastcol");
  try {
    const tableId = await seedTable(
      a,
      "a",
      [
        ["a1", "a2"],
        ["b1", "b2"],
      ],
      [100, 150]
    );
    await expect.poll(async () => findTableId(b, "b"), SETTLE).not.toBeNull();

    // The right-edge seam (data-index 1 = the last column's index) stands
    // at the table's right edge; the drag +40 px commits the last
    // column's width (the other stands). The grab stands the seam's top
    // part — the add-column chip (centered at the edge) covers the middle
    // band (the chip stands over the seam there).
    const seamBox = await seam(a, 1).boundingBox();
    if (seamBox === null) throw new Error("the right-edge seam has no box");
    const tableBox = await tableEl(a).boundingBox();
    if (tableBox === null) throw new Error("the table has no box");
    // The seam's center stands the table's right edge (the border's
    // half stands the sub-pixel, the 1.5 px tolerance).
    expect(Math.abs(seamBox.x + seamBox.width / 2 - (tableBox.x + tableBox.width))).toBeLessThanOrEqual(1.5);

    const sx = seamBox.x + seamBox.width / 2;
    const sy = seamBox.y + 8;
    await dragTo(a, { x: sx, y: sy }, { x: sx + 40, y: sy });
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.widths, SETTLE).toEqual([100, 190]);
  } finally {
    await close();
  }
});

test("the keyboard path: the handle's focus + the Enter open + the keyboard pick; the seam's arrow resize (B)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "tbl-kbd");
  try {
    const tableId = await seedTable(a, "a", [
      ["a1", "a2"],
      ["b1", "b2"],
    ]);
    await expect.poll(async () => findTableId(b, "b"), SETTLE).not.toBeNull();

    // The row handle stands a focusable button (the tab path lands on it):
    // the Enter opens the menu, the keyboard pick (the arrows + the Enter)
    // commits over the wire.
    const handle = a.locator('[data-slot="docblocks/table-row-handle"][data-index="0"]');
    await expect(handle).toHaveAttribute("aria-label", "Row 1 options");
    await handle.focus();
    await a.keyboard.press("Enter");
    await expect(rowMenu(a)).toBeVisible();
    // The menu's open auto-focus (the first item — the Background sub-trigger)
    // stands async of the mount, and the arrow's focus travel is a
    // setTimeout hop (the roving focus group): a fixed delay is outlasted by
    // the load-timed mount, and an Enter landed on the Background trigger
    // opens the color palette instead of picking the item. The seated focus
    // at each hop is the deterministic pin.
    await expect(rowMenu(a).getByText("Background", { exact: true })).toBeFocused(SETTLE);
    await a.keyboard.press("ArrowDown"); // to the insert item (past the background sub)
    await expect(rowMenu(a).getByText("Insert below", { exact: true })).toBeFocused(SETTLE);
    await a.keyboard.press("Enter");
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.rows.length, SETTLE).toBe(3);
    // The pick was the insert-below (the empty row at the handle's side; the
    // old rows travel down).
    expect((await tableSnapshot(b, "b", tableId))?.rows[1]?.[0]?.text).toBe("");
    expect((await tableSnapshot(b, "b", tableId))?.rows[2]?.[0]?.text).toBe("b1");

    // The seam stands a focusable separator: the arrows step the column's
    // width (the live commit per press; the B JSON takes the width).
    const seam = a.locator('[data-slot="docblocks/table-col-resize"][data-index="0"]');
    await expect(seam).toHaveAttribute("role", "separator");
    await seam.focus();
    await a.keyboard.press("ArrowRight");
    await a.keyboard.press("ArrowRight");
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.widths?.[0], SETTLE).toBe(116);
  } finally {
    await close();
  }
});
