// The cell's pickers' unified row height's stand (the enum / the
// multi-enum / the row-link's lines) + the pick's contract's regression
// (the commit over the pane's bridge).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

/**
 * The pane's default-bridge demo table (the playground seeds it per page at
 * module load — id `table-demo` (derived from the name), name "Demo",
 * 3 rows). Polls until the async seed settles and returns the first
 * table's ref. The id stands the name's slug derivation (deterministic),
 * so the `tableId` reference resolves on every page of the context's
 * storage.
 */
async function bridgeDemoTable(page: Page): Promise<{ id: string; name: string }> {
  let result: { id: string; name: string } | null = null;
  await expect
    .poll(async () => {
      result = await page.evaluate(async () => {
        if (window.__bridge === undefined) return null;
        const tables = await window.__bridge.listTables();
        // The seed creates the enum's system table before the Demo table
        // (it stands the catalog out), so the demo is found by name, not by
        // position.
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

test("the cell's pickers stand the unified row height (the enum / the multi-enum / the row-link's lines; the pick's contract stands)", async ({
  browser,
}) => {
  // A single pane: the heights are the computed styles (no sync needed);
  // a unique room (the relay keeps the room's doc for the dev server's
  // lifetime).
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", `db-pickheight-${Math.random().toString(36).slice(2, 8)}`);
    const demo = await bridgeDemoTable(a);
    // The multi-enum + the row-link's columns (over the pane's own bridge:
    // the demo's Statuses dict + the linked People table).
    const colIds = await a.evaluate(async (tableId) => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const { columns } = await bridge.describeTable(tableId);
      const statusColId = columns.find((column) => column.name === "Status")?.id ?? null;
      if (statusColId === null) throw new Error("the demo's Status column stands absent");
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
      const people = await bridge.createTable({ name: "People" }, ctx());
      const peopleId = people.result.id;
      const peopleNameCol = await bridge.createColumn(
        peopleId,
        { column: { name: "Name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const peopleRows = await bridge.batchRows(
        peopleId,
        {
          ops: [
            { op: "create", row: { [peopleNameCol.result.id]: "Ann" }, beforeRowId: null },
            { op: "create", row: { [peopleNameCol.result.id]: "Bo" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      const ownerCol = await bridge.createColumn(
        tableId,
        {
          column: {
            name: "Owner",
            type: "text",
            position: columns.length + 1,
            nullable: true,
            reference: { kind: "row", tableId: peopleId, many: false },
          },
        },
        ctx()
      );
      const enumSnapshot = await bridge.snapshotTable("table-statuses-enum", {});
      const nameColumnId = enumSnapshot.columns.find((column) => column.name === "name")?.id ?? null;
      const todoOption =
        nameColumnId === null ? undefined : enumSnapshot.page.rows.find((row) => row.cells[nameColumnId] === "todo");
      if (todoOption === undefined) throw new Error("the todo option stands absent");
      const page = await bridge.snapshotTable(tableId, {});
      const rowId = page.page.rows[0]!.id;
      await bridge.batchRows(
        tableId,
        {
          ops: [
            {
              op: "update",
              rowId,
              cells: {
                [tagsCol.result.id]: [todoOption.id],
                [ownerCol.result.id]: peopleRows.result.rows[0]!.id,
              },
            },
          ],
        },
        ctx()
      );
      return { tags: tagsCol.result.id, owner: ownerCol.result.id, status: statusColId };
    }, demo.id);
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const gridA = a.locator("[data-slot='docblocks/database-grid']");
    await expect(gridA.first()).toBeVisible(SETTLE);
    const cell = (colId: string) =>
      a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${colId}']`).first();

    // The single-enum's list — the grid's main picker (the height's
    // stand: the option's line over the theme's tokens). The picker is
    // the custom popover (the Radix's Select is out over the enum).
    await cell(colIds.status).dblclick();
    await a.waitForTimeout(150);
    const enumRow = a.locator("[data-slot='docblocks/database-enum-picker-row']").first();
    await expect(enumRow).toBeVisible(SETTLE);
    const enumHeight = await enumRow.evaluate((el) => getComputedStyle(el).height);
    await a.keyboard.press("Escape");

    // The multi-enum's list (the checkbox rows — the row's line stands the
    // checkbox's visual; the press stands the row's toggle).
    await cell(colIds.tags).dblclick();
    const multiRow = a.locator("[data-slot='docblocks/database-ref-multi-option']");
    await expect(multiRow.first()).toBeVisible(SETTLE);
    const multiHeight = await multiRow.first().evaluate((el) => getComputedStyle(el).height);
    await a.keyboard.press("Escape");

    // The row-link's picker (the search + the row lines).
    await cell(colIds.owner).dblclick();
    const rowLinkRow = a.locator("[data-slot='docblocks/database-row-picker-row']");
    await expect(rowLinkRow.first()).toBeVisible(SETTLE);
    const rowLinkHeight = await rowLinkRow.first().evaluate((el) => getComputedStyle(el).height);

    // The unified stand: every picker's row stands the main picker's
    // height (the padding + the font-size + the line-height over the
    // theme's tokens).
    expect(multiHeight).toBe(enumHeight);
    expect(rowLinkHeight).toBe(enumHeight);

    // The pick's contract stands (the regression): the enum's pick commits
    // over the bridge (the cell stands the value). The row's option-value
    // stands the option's row id (the pk's stand = the dict's value).
    const doneId = await statusOptionId(a, "done");
    await cell(colIds.status).dblclick();
    await a.waitForTimeout(150);
    const doneRow = a.locator(`[data-slot='docblocks/database-enum-picker-row'][data-option-value='${doneId}']`);
    await expect(doneRow).toBeVisible(SETTLE);
    await doneRow.click();
    await expect(cell(colIds.status)).toHaveText("done", SETTLE);
    const status = await a.evaluate(
      async ({ tableId, columnId }) => {
        const page = await window.__bridge!.snapshotTable(tableId, {});
        return page.page.rows[0]?.cells[columnId] ?? null;
      },
      { tableId: demo.id, columnId: colIds.status }
    );
    expect(status).toBe(doneId);
  } finally {
    await context.close();
  }
});
