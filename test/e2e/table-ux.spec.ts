import { type Browser, type Page, expect, test } from "@playwright/test";

// The table affordances: the slash Table insert,
// the cell activation (the first input materializes the paragraph; Enter is a
// soft line break; the empty layer's Backspace is a no-op), the handle menus
// (insert / move / duplicate / clear; the last row / column converts the
// table into a paragraph), the row/column background colors (the column over
// the row; the conditional remove), the column drag (the width and the color
// travel with the column; a no-op drag issues no command), the column-seam
// resize (the release commits one width, the 50 px floor, the undo reverts),
// the overflow scroll with the centered add chips, and the cell's right-click
// menu (the plain-text copy, the plain-text paste — the markdown degrades to
// one paragraph — and the clear).
//
// Each test gets its own room via ?syncUrl= — the relay keeps rooms for the
// dev server's lifetime, so a shared room would be polluted by other spec
// files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
}

async function twoPanes(browser: Browser, seed: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  await openPane(a, "a", room);
  await openPane(b, "b", room);
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

/** The wire log's outbound doc-update count (awareness frames are not logged). */
async function outCount(page: Page, client: "a" | "b"): Promise<number> {
  const text = await page.getByTestId(`wire-${client}`).innerText();
  return text.match(/\] out \d+B/g)?.length ?? 0;
}

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
        cols: table.attrs?.cols as number | undefined,
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
const scrollEl = (page: Page) => page.locator('[data-slot="docblocks/table-scroll"] > div.overflow-x-auto');
const rowHandle = (page: Page, index: number) =>
  page.locator(`[data-slot="docblocks/table-row-handle"][data-index="${index}"]`);
const colHandle = (page: Page, index: number) =>
  page.locator(`[data-slot="docblocks/table-col-handle"][data-index="${index}"]`);
// The open menu's content (one content stands per handle — the closed ones
// stay mounted with data-state="closed").
const rowMenu = (page: Page) => page.locator('[data-slot="docblocks/table-row-menu"][data-state="open"]');
const colMenu = (page: Page) => page.locator('[data-slot="docblocks/table-col-menu"][data-state="open"]');
const cellMenu = (page: Page) => page.locator('[data-slot="docblocks/table-cell-menu"]');
const seam = (page: Page, index: number) =>
  page.locator(`[data-slot="docblocks/table-col-resize"][data-index="${index}"]`);

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

/** The center of a cell's td (row × column, 0-based, `cols` the table's column count). */
async function cellCenter(page: Page, row: number, col: number, cols: number): Promise<{ x: number; y: number }> {
  const box = await page
    .locator("td")
    .nth(row * cols + col)
    .boundingBox();
  if (box === null) throw new Error("the cell has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The right-click on a cell (the menu defers its open a task past the gesture's release — polled). */
async function rightClickCell(page: Page, row: number, col: number, cols: number): Promise<void> {
  const center = await cellCenter(page, row, col, cols);
  await page.mouse.click(center.x, center.y, { button: "right" });
  await expect.poll(async () => cellMenu(page).count(), SETTLE).toBe(1);
}

test("the slash Table stands a 2×2 table in both panes (the empty cells, the default widths)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ux18-table-slash");
  const inner = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
  try {
    await inner.click();
    await a.keyboard.press("/");
    await expect(a.locator('[data-slot="docblocks/slash-menu"]')).toBeVisible();
    await a.keyboard.type("tab");
    await a.locator('[data-slot="docblocks/slash-item"]').getByText("Table", { exact: true }).click();

    // A: the table stands (2 rows × 2 cells); the cells are empty (the
    // activation layer stands until the first input).
    await expect(tableEl(a)).toHaveCount(1);
    await expect(a.locator("tr")).toHaveCount(2);
    await expect(a.locator("td")).toHaveCount(4);
    await expect(a.locator('td [data-slot="docblocks/cell-activation"]')).toHaveCount(4);

    // B: the same over the wire (polled — the sync lags), and the JSON's
    // attrs (cols 2, the default 100 px widths) with the empty cells.
    await expect.poll(async () => findTableId(b, "b"), SETTLE).not.toBeNull();
    const tableId = await findTableId(b, "b");
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId!))?.rows.length, SETTLE).toBe(2);
    const snap = await tableSnapshot(b, "b", tableId!);
    expect(snap?.cols).toBe(2);
    expect(snap?.widths).toEqual([100, 100]);
    expect(snap?.rows[0]?.length).toBe(2);
    expect(snap?.rows[0]?.[0]?.blocks).toBe(0);
    expect(snap?.rows[0]?.[0]?.text).toBe("");
  } finally {
    await close();
  }
});

test("the cell activation: the first input materializes the paragraph (synced); Enter breaks the line; the empty layer's Backspace is a no-op", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ux18-table-activate");
  try {
    const tableId = await seedTable(a, "a", [
      ["", ""],
      ["", ""],
    ]);
    await expect.poll(async () => findTableId(b, "b"), SETTLE).not.toBeNull();

    // The empty layer's Backspace issues nothing (no wire, no block in B).
    const outBefore = await outCount(a, "a");
    await a.locator("td").first().click();
    await a.keyboard.press("Backspace");
    await a.waitForTimeout(300);
    expect(await outCount(a, "a")).toBe(outBefore);

    // The first input materializes the paragraph (one block, the text) —
    // the activation layer is swapped for the real content; B sees it.
    await a.keyboard.type("hello");
    await expect
      .poll(async () => (await tableSnapshot(b, "b", tableId))?.rows[0]?.[0], SETTLE)
      .toMatchObject({ blocks: 1, text: "hello" });
    await expect(a.locator('td [data-slot="docblocks/cell-activation"]')).toHaveCount(3);

    // Enter in the cell paragraph is a soft line break (one block, the
    // logical line break in the text — no second paragraph); the Backspace
    // undoes it.
    await a.keyboard.press("Enter");
    await expect
      .poll(async () => (await tableSnapshot(b, "b", tableId))?.rows[0]?.[0], SETTLE)
      .toMatchObject({ blocks: 1, text: "hello\n" });
    await a.keyboard.press("Backspace");
    await expect
      .poll(async () => (await tableSnapshot(b, "b", tableId))?.rows[0]?.[0], SETTLE)
      .toMatchObject({ blocks: 1, text: "hello" });
  } finally {
    await close();
  }
});

test("the row handle menu: insert / move / duplicate / clear (the wire reaches B; one undo step)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ux18-table-rowmenu");
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
  const { a, b, close } = await twoPanes(browser, "ux18-table-colmenu");
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
  const { a, b, close } = await twoPanes(browser, "ux18-table-convert");
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

test("the column color over the row color (the intersection); the remove reveals the row's (B synced)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ux18-table-colors");
  try {
    const tableId = await seedTable(a, "a", [
      ["a1", "a2"],
      ["b1", "b2"],
    ]);
    await expect.poll(async () => findTableId(b, "b"), SETTLE).not.toBeNull();

    // The row 0 color (the amber) on its cells.
    await pressHandle(a, "row", 0, 2);
    await expect(rowMenu(a)).toBeVisible();
    await rowMenu(a).getByText("Background", { exact: true }).click();
    await a.locator('[data-slot="docblocks/table-swatch"][data-color="#f59e0b"]').click();

    // The column 0 color (the emerald) on its cells — the intersection cell
    // (0,0) stands the COLUMN color (the column over the row).
    await pressHandle(a, "column", 0, 2);
    await expect(colMenu(a)).toBeVisible();
    await colMenu(a).getByText("Background", { exact: true }).click();
    await a.locator('[data-slot="docblocks/table-swatch"][data-color="#10b981"]').click();

    // Computed backgrounds (A and B): the intersection = the column's
    // emerald; the row-only cell (0,1) = the row's amber.
    const cellBg = (pg: Page, row: number, col: number) =>
      pg
        .locator("td")
        .nth(row * 2 + col)
        .evaluate((el) => getComputedStyle(el).backgroundColor);
    await expect.poll(async () => cellBg(a, 0, 0), SETTLE).toBe("rgb(16, 185, 129)");
    await expect.poll(async () => cellBg(a, 0, 1), SETTLE).toBe("rgb(245, 158, 11)");
    await expect.poll(async () => cellBg(b, 0, 0), SETTLE).toBe("rgb(16, 185, 129)");
    await expect.poll(async () => cellBg(b, 0, 1), SETTLE).toBe("rgb(245, 158, 11)");

    // The JSON's attrs (B): the column color stands on the column's cells,
    // the row color on the row's cells.
    const snap = await expect
      .poll(async () => (await tableSnapshot(b, "b", tableId))?.rows[0]?.[0]?.columnColor, SETTLE)
      .toBe("#10b981")
      .then(async () => tableSnapshot(b, "b", tableId));
    expect(snap?.rows[0]?.[0]?.columnColor).toBe("#10b981");
    expect(snap?.rows[0]?.[0]?.rowColor).toBe("#f59e0b");
    expect(snap?.rows[0]?.[1]?.columnColor).toBeUndefined();
    expect(snap?.rows[0]?.[1]?.rowColor).toBe("#f59e0b");
    expect(snap?.rows[1]?.[0]?.columnColor).toBe("#10b981");
    expect(snap?.rows[1]?.[0]?.rowColor).toBeUndefined();

    // The remove (the column's) reveals the row's color at the intersection.
    await pressHandle(a, "column", 0, 2);
    await expect(colMenu(a)).toBeVisible();
    await expect(colMenu(a).locator('[data-slot="docblocks/table-remove-color"]')).toBeVisible();
    await colMenu(a).locator('[data-slot="docblocks/table-remove-color"]').click();
    await expect.poll(async () => cellBg(a, 0, 0), SETTLE).toBe("rgb(245, 158, 11)");

    // The row's remove clears the background (no color stands — the
    // computed color falls back to the transparent).
    await pressHandle(a, "row", 0, 2);
    await expect(rowMenu(a)).toBeVisible();
    await rowMenu(a).locator('[data-slot="docblocks/table-remove-color"]').click();
    await expect.poll(async () => cellBg(a, 0, 0), SETTLE).toBe("rgba(0, 0, 0, 0)");
    const afterRemoval = await expect
      .poll(async () => (await tableSnapshot(b, "b", tableId))?.rows[0]?.[0]?.rowColor, SETTLE)
      .toBeUndefined()
      .then(async () => tableSnapshot(b, "b", tableId));
    expect(afterRemoval?.rows[0]?.[0]?.rowColor).toBeUndefined();
    expect(afterRemoval?.rows[0]?.[0]?.columnColor).toBeUndefined();

    // Without a color the remove item stands absent (the conditional item).
    await pressHandle(a, "row", 0, 2);
    await expect(rowMenu(a)).toBeVisible();
    await expect(rowMenu(a).locator('[data-slot="docblocks/table-remove-color"]')).toHaveCount(0);
  } finally {
    await close();
  }
});

test("the column drag moves the column with its width and color (B); a no-op drag issues no command", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ux18-table-drag");
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
    // command: the wire count stands, B's order stands.
    const outBefore = await outCount(a, "a");
    await seedHover(a, 0, colChipSel(0));
    const handleBox2 = await colHandle(a, 0).boundingBox();
    if (handleBox2 === null) throw new Error("the column handle has no box");
    await dragNoop(a, handleBox2.x + handleBox2.width / 2, handleBox2.y + handleBox2.height / 2);
    await a.waitForTimeout(300);
    expect(await outCount(a, "a")).toBe(outBefore);
    expect((await tableSnapshot(b, "b", tableId))?.widths).toEqual([140, 90, 120]);
  } finally {
    await close();
  }
});

test("the row drag moves the row over the wire (B); the parting preview stands mid-drag with no doc write", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ux18-table-row-drag");
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
    // row follows the pointer, row 1 stands shifted up.
    await a.mouse.move(startX, startY + (targetY - startY) * 0.95, { steps: 6 });
    await a.waitForTimeout(300);
    const midStands = await a.evaluate(() => {
      const table = document.querySelector<HTMLTableElement>('table[data-slot="docblocks/table"]');
      return Array.from(table!.querySelectorAll<HTMLElement>("tbody > tr")).map((tr) => tr.style.transform);
    });
    expect(midStands[0]).toMatch(/translateY\((\d+(\.\d+)?px)\)/);
    expect(midStands[1]).toMatch(/translateY\(-\d+(\.\d+)?px\)/);
    // No doc write mid-drag: the wire count stands.
    expect(await outCount(a, "a")).toBe(outBefore);
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

test("the seam resize: the release commits one width (B JSON); the 50 px floor; the undo reverts", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ux18-table-resize");
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
    // clamped value — one command per release).
    const seamBox2 = await seam(a, 0).boundingBox();
    if (seamBox2 === null) throw new Error("the seam has no box");
    const sx2 = seamBox2.x + seamBox2.width / 2;
    const sy2 = seamBox2.y + seamBox2.height / 2;
    await dragTo(a, { x: sx2, y: sy2 }, { x: sx2 - 500, y: sy2 });
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.widths, SETTLE).toEqual([50, 150]);

    // One undo step reverts the last commit.
    await a.evaluate(() => window.__paneDocs?.a?.undo());
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.widths, SETTLE).toEqual([160, 150]);
  } finally {
    await close();
  }
});

test("the wide columns overflow-scroll (both panes); the add chips stand over the visible part and the table", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ux18-table-overflow");
  try {
    const tableId = await seedTable(
      a,
      "a",
      [
        ["a1", "a2", "a3"],
        ["b1", "b2", "b3"],
      ],
      [100, 100, 100]
    );
    await expect.poll(async () => findTableId(b, "b"), SETTLE).not.toBeNull();

    // The wide widths (the total outgrows the panes): the scroll element
    // scrolls horizontally (both panes — the widths travel over the wire).
    await a.evaluate((id) => {
      const doc = window.__paneDocs?.a;
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      doc.transact(() => {
        doc.setTableColumnWidth(id, 0, 400);
        doc.setTableColumnWidth(id, 1, 400);
        doc.setTableColumnWidth(id, 2, 400);
      });
    }, tableId);
    const frameScroll = (pg: Page) => scrollEl(pg).evaluate((el) => el.scrollWidth - el.clientWidth);
    await expect.poll(async () => frameScroll(a), SETTLE).toBeGreaterThan(0);
    await expect.poll(async () => frameScroll(b), SETTLE).toBeGreaterThan(0);

    // The add-row chip is pinned to the frame's visible part (its center
    // stands on the visible width's center — the table overflows); the
    // add-column chip stands at the table's right edge, vertically centered
    // on the table's height (both scroll with the content on the x-axis).
    const frameBox = await a.locator('[data-slot="docblocks/table-scroll"]').boundingBox();
    const tableBox = await tableEl(a).boundingBox();
    const scrollClient = await scrollEl(a).evaluate((el) => el.clientWidth);
    const rowChipBox = await a.locator('[data-slot="docblocks/table-add-row"]').boundingBox();
    const colChipBox = await a.locator('[data-slot="docblocks/table-add-column"]').boundingBox();
    if (frameBox === null || tableBox === null || rowChipBox === null || colChipBox === null) {
      throw new Error("the frame / table / chips have no boxes");
    }
    expect(rowChipBox.x + rowChipBox.width / 2).toBeCloseTo(frameBox.x + scrollClient / 2, 0);
    expect(colChipBox.y + colChipBox.height / 2).toBeCloseTo(tableBox.y + tableBox.height / 2, 0);
  } finally {
    await close();
  }
});

test("the cell context menu: copy (the plain text, the blocks joined), paste (one paragraph — the markdown degrades), clear", async ({
  browser,
}) => {
  const room = `ux18-table-ctx-${Math.random().toString(36).slice(2, 8)}`;
  const context = await browser.newContext();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:5173" });
  const a = await context.newPage();
  const bContext = await browser.newContext();
  const b = await bContext.newPage();
  await openPane(a, "a", room);
  await openPane(b, "b", room);
  try {
    // Two paragraphs in the cell (0,0) (the copy joins them with a line
    // break); the cell (1,1) stands empty (the paste seat).
    const tableId = await seedTable(a, "a", [
      ["", ""],
      ["", ""],
    ]);
    await a.evaluate((id) => {
      const doc = window.__paneDocs?.a;
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      const cellId = doc.getChildren(doc.getChildren(id)[0]!)[0]!;
      doc.transact(() => {
        const p1 = doc.insertBlock("paragraph", undefined, { parent: cellId });
        doc.insertText(p1, 0, "l1");
        const p2 = doc.insertBlock("paragraph", undefined, { parent: cellId });
        doc.insertText(p2, 0, "l2");
      });
    }, tableId);
    await expect.poll(async () => findTableId(b, "b"), SETTLE).not.toBeNull();

    // Copy: the plain text (the blocks joined with the line break).
    await rightClickCell(a, 0, 0, 2);
    await expect(cellMenu(a)).toBeVisible();
    await cellMenu(a).getByText("Copy", { exact: true }).click();
    await expect.poll(async () => a.evaluate(() => navigator.clipboard.readText()), SETTLE).toBe("l1\nl2");

    // Paste: the markdown degrades in the cell to ONE paragraph (the
    // literal text — no heading, no second block) in the empty cell.
    await a.evaluate(() => navigator.clipboard.writeText("# Head\ntext"));
    await rightClickCell(a, 1, 1, 2);
    await expect(cellMenu(a)).toBeVisible();
    await cellMenu(a).getByText("Paste", { exact: true }).click();
    await expect
      .poll(async () => (await tableSnapshot(b, "b", tableId))?.rows[1]?.[1], SETTLE)
      .toMatchObject({ blocks: 1, text: "# Head\ntext" });

    // Clear: the cell's children cascade out (B sees the empty cell).
    await rightClickCell(a, 0, 0, 2);
    await expect(cellMenu(a)).toBeVisible();
    await cellMenu(a).getByText("Clear", { exact: true }).click();
    await expect.poll(async () => (await tableSnapshot(b, "b", tableId))?.rows[0]?.[0]?.blocks, SETTLE).toBe(0);
  } finally {
    await context.close();
    await bContext.close();
  }
});

test("the cells stand no grips and no placeholder (the page rows around them do)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ux18-table-nogrip");
  try {
    await seedTable(a, "a", [
      ["a1", "a2"],
      ["b1", "b2"],
    ]);
    await expect(a.locator("td")).toHaveCount(4);

    // The page row's gutter (the motion view's drag handle) stands around
    // the table — but inside the cells there is none (the cells are not
    // draggable rows), and the cells stand no placeholder.
    expect(await a.locator('[data-slot="docblocks/gutter"]').count()).toBeGreaterThan(0);
    await expect(a.locator('td [data-slot="docblocks/gutter"]')).toHaveCount(0);
    await expect(a.locator('td [data-slot="docblocks/placeholder"]')).toHaveCount(0);
  } finally {
    await close();
  }
});

// ====================================================================
// The table's structure: the last column's right-edge seam, the add
// chips' drag (the multi add / remove), and the size stand.
// ====================================================================

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

test("the last column resizes at the table's right edge (the right-edge seam)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ux19-table-lastcol");
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

test("the add-row chip's drag appends / removes several rows (one undo step per drag)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ux19-table-rowdrag");
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
  const { a, b, close } = await twoPanes(browser, "ux19-table-coldrag");
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
