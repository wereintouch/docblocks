// The table's insert and the cell's stand: the slash Table insert (the
// empty cells, the default widths over both panes), the cell's activation
// (the first input materializes the paragraph; Enter is a soft line break;
// the empty layer's Backspace is a no-op), and the cell's page stand (no
// grips, no placeholder — the page rows around them do).
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

const tableEl = (page: Page) => page.locator('table[data-slot="docblocks/table"]');

test("the slash Table stands a 2×2 table in both panes (the empty cells, the default widths)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "tbl-slash");
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
  const { a, b, close } = await twoPanes(browser, "tbl-activate");
  try {
    const tableId = await seedTable(a, "a", [
      ["", ""],
      ["", ""],
    ]);
    await expect.poll(async () => findTableId(b, "b"), SETTLE).not.toBeNull();

    // The empty layer's Backspace issues nothing (no wire, no block in B —
    // the window's stand).
    const outBefore = await outCount(a, "a");
    await a.locator("td").first().click();
    await a.keyboard.press("Backspace");
    await expectStays(async () => {
      expect(await outCount(a, "a")).toBe(outBefore);
    });

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

test("the cells stand no grips and no placeholder (the page rows around them do)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "tbl-nogrip");
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
