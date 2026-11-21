// The enum's picker's contracts stand: the search's autofocus, the
// filter, the single's pick, the multi's toggle, the row's height.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

/** The pane's bridge's demo table (the seed's stand). */
async function bridgeDemoTable(page: Page): Promise<{ id: string; name: string }> {
  let result: { id: string; name: string } | null = null;
  await expect
    .poll(async () => {
      result = await page.evaluate(async () => {
        if (window.__bridge === undefined) return null;
        const tables = await window.__bridge.listTables();
        return tables.find((table) => table.name === "Demo") ?? null;
      });
      return result;
    }, SETTLE)
    .not.toBeNull();
  return result!;
}

/** The statuses' system table's option row id by its label (the enum's
 * options' catalog read — the option's row IS the option). */
async function statusOptionId(page: Page, label: string): Promise<string> {
  const id = await page.evaluate(async (label) => {
    const snapshot = await window.__bridge!.snapshotTable("table-statuses-enum", {});
    const nameColumnId = snapshot.columns.find((column) => column.name === "name")?.id ?? null;
    if (nameColumnId === null) return null;
    return snapshot.page.rows.find((row) => row.cells[nameColumnId] === label)?.id ?? null;
  }, label);
  if (id === null) throw new Error(`the "${label}" option stands absent over the statuses' system table`);
  return id;
}

test("the picker's contracts stand (the search's autofocus; the filter; the single's pick; the multi's toggle; the row's height)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", `enum-contract-${Math.random().toString(36).slice(2, 8)}`);
    const demo = await bridgeDemoTable(a);
    // The multi-enum's column (the demo's Statuses' dict) + the row's
    // first cell's tags' seed (the option's row id over the column id).
    const { Status: statusColId, Tags: tagsColId } = await a.evaluate(async (tableId) => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const { columns } = await bridge.describeTable(tableId);
      const statusColId = columns.find((column) => column.name === "Status")?.id ?? null;
      const tagsCol = await bridge.createColumn(
        tableId,
        {
          column: {
            name: "Tags",
            type: "text",
            position: columns.length,
            nullable: true,
            reference: { kind: "enum", tableId: "table-statuses-enum", many: true },
          },
        },
        ctx()
      );
      const enumSnapshot = await bridge.snapshotTable("table-statuses-enum", {});
      const nameColumnId = enumSnapshot.columns.find((column) => column.name === "name")?.id ?? null;
      const todoOption =
        nameColumnId === null ? undefined : enumSnapshot.page.rows.find((row) => row.cells[nameColumnId] === "todo");
      if (statusColId === null || todoOption === undefined) {
        throw new Error("the demo's Status column / the todo option stands absent");
      }
      const page = await bridge.snapshotTable(tableId, {});
      const rowId = page.page.rows[0]!.id;
      await bridge.batchRows(
        tableId,
        { ops: [{ op: "update", rowId, cells: { [tagsCol.result.id]: [todoOption.id] } }] },
        ctx()
      );
      return { Status: statusColId, Tags: tagsCol.result.id };
    }, demo.id);
    const doingId = await statusOptionId(a, "doing");

    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const grid = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(grid).toBeVisible(SETTLE);

    const enumCell = a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${statusColId}']`).first();

    // The search's autofocus (the regression): the open stands the input's
    // focus.
    await enumCell.dblclick();
    await a.waitForTimeout(150);
    await expect(a.locator("[data-slot='docblocks/database-enum-picker-search']")).toBeFocused();
    // The filter's stand (the query's stand over the rows).
    await a.keyboard.type("done");
    const visibleRows = a.locator("[data-slot='docblocks/database-enum-picker-row']");
    await expect(visibleRows).toHaveCount(1, SETTLE);
    await expect(visibleRows.first()).toContainText("done");
    await a.keyboard.press("Escape");
    await a.waitForTimeout(200);

    // The single's pick's commit (the regression): the pick stands the
    // value over the bridge.
    await enumCell.dblclick();
    await a.waitForTimeout(150);
    await a.locator(`[data-slot='docblocks/database-enum-picker-row'][data-option-value='${doingId}']`).click();
    await expect(enumCell).toHaveText("doing", SETTLE);

    // The multi's toggle (the regression): the row's press stands the
    // checkbox's toggle (the cell's chips' stand).
    const multiCell = a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${tagsColId}']`).first();
    await multiCell.dblclick();
    await a.waitForTimeout(150);
    const firstOption = a.locator("[data-slot='docblocks/database-ref-multi-option']").first();
    const stateBefore = await firstOption.getAttribute("data-state");
    await firstOption.click();
    const stateAfter = await firstOption.getAttribute("data-state");
    expect(stateBefore).not.toBe(stateAfter);
    await a.keyboard.press("Escape");

    // The row's height's stand (the regression): the cell's line stands
    // the 32 px's stand (the unified's row's height).
    const cellHeight = await enumCell.boundingBox().then((box) => box!.height);
    expect(cellHeight).toBeCloseTo(32, 0);
  } finally {
    await context.close();
  }
});
