// The wide columns' overflow scroll (both panes; the add chips stand over
// the visible part and the table), and the cell's right-click menu (the
// plain-text copy, the plain-text paste — the markdown degrades to one
// paragraph — and the clear).
import { type Page, expect, test } from "@playwright/test";

import {
  SETTLE,
  editorContext,
  grantClipboardPermissions,
  interceptClipboardWrites,
  openPane,
  readClipboardPayload,
  twoPanes,
} from "./helpers";

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

const scrollEl = (page: Page) => page.locator('[data-slot="docblocks/table-scroll"] > div.overflow-x-auto');

const cellMenu = (page: Page) => page.locator('[data-slot="docblocks/table-cell-menu"]');

/** The center of a cell's td (row × column, 0-based, `cols` the table's column count). */
async function cellCenter(page: Page, row: number, col: number, cols: number): Promise<{ x: number; y: number }> {
  const box = await page
    .locator("td")
    .nth(row * cols + col)
    .boundingBox();
  if (box === null) throw new Error("the cell has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The right-click on a cell (the menu stands its open over the gesture's release — polled). */
async function rightClickCell(page: Page, row: number, col: number, cols: number): Promise<void> {
  const center = await cellCenter(page, row, col, cols);
  await page.mouse.click(center.x, center.y, { button: "right" });
  await expect.poll(async () => cellMenu(page).count(), SETTLE).toBe(1);
}

test("the wide columns overflow-scroll (both panes); the add chips stand over the visible part and the table", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "tbl-overflow");
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
  const room = `tbl-ctx-${Math.random().toString(36).slice(2, 8)}`;
  const context = await editorContext(browser);
  await grantClipboardPermissions(context);
  const a = await context.newPage();
  const bContext = await editorContext(browser);
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
    await interceptClipboardWrites(a);
    await rightClickCell(a, 0, 0, 2);
    await expect(cellMenu(a)).toBeVisible();
    await cellMenu(a).getByText("Copy", { exact: true }).click();
    await expect.poll(async () => (await readClipboardPayload(a)).plain, SETTLE).toBe("l1\nl2");

    // Paste: the markdown degrades in the cell to ONE paragraph (the
    // literal text — no heading, no second block) in the empty cell. The
    // cell's paste reads the OS clipboard, so it stands the grantable-read
    // engine's stand (the chromium's project — the firefox/webkit's
    // clipboard read takes no Playwright grant).
    if (context.browser()?.browserType().name() === "chromium") {
      await a.evaluate(() => navigator.clipboard.writeText("# Head\ntext"));
      await rightClickCell(a, 1, 1, 2);
      await expect(cellMenu(a)).toBeVisible();
      await cellMenu(a).getByText("Paste", { exact: true }).click();
      await expect
        .poll(async () => (await tableSnapshot(b, "b", tableId))?.rows[1]?.[1], SETTLE)
        .toMatchObject({ blocks: 1, text: "# Head\ntext" });
    }

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
