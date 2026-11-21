// The enum's picker's stand: the width's clamp (the cell's floor, the
// option's drive, the 220 px's ceiling) and the rows' selected's stand
// (the current value / the empty's clear).
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

/** The demo table's column ids by their schema names (the bridge's
 * schema read — the column ids stand the bridge's allocation, not the
 * spec's stand). */
async function demoColumns<K extends string>(
  page: Page,
  tableId: string,
  names: readonly K[]
): Promise<Record<K, string>> {
  const ids = await page.evaluate(
    async ({ tableId, names }) => {
      const { columns } = await window.__bridge!.describeTable(tableId);
      return names.map((name) => columns.find((column) => column.name === name)?.id ?? null);
    },
    { tableId, names }
  );
  const out = {} as Record<K, string>;
  names.forEach((name, index) => {
    const id = ids[index]!;
    if (id === null) throw new Error(`the demo table's "${name}" column stands absent`);
    out[name] = id;
  });
  return out;
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

/** The picker's popover (the Radix's content — the last's over the
 *  stacked's stand). */
const pickerPopover = (page: Page) => page.locator("[data-slot='popover-content']").last();

test("the enum's picker width stands the clamp (the cell's floor, the option's drive, the 220 px's ceiling)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", `enum-width-${Math.random().toString(36).slice(2, 8)}`);
    const demo = await bridgeDemoTable(a);
    // The long's options (the drive over the 220 px's ceiling): the
    // system's table's stand over the bridge (the pk's rows).
    const longColId = await a.evaluate(async (tableId) => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const longTable = await bridge.createTable(
        { name: `Enum Width ${Math.random().toString(36).slice(2, 6)}`, system: true },
        ctx()
      );
      const longTableId = longTable.result.id;
      const nameCol = await bridge.createColumn(
        longTableId,
        { column: { name: "name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      await bridge.createColumn(
        longTableId,
        { column: { name: "color", type: "text", position: 1, nullable: true } },
        ctx()
      );
      const { columns } = await bridge.describeTable(tableId);
      const longCol = await bridge.createColumn(
        tableId,
        {
          column: {
            name: "Long",
            type: "text",
            position: columns.length,
            nullable: true,
            reference: { kind: "enum", tableId: longTableId, many: false },
          },
        },
        ctx()
      );
      await bridge.batchRows(
        longTableId,
        {
          ops: [
            { op: "create", row: { [nameCol.result.id]: "Short" }, beforeRowId: null },
            { op: "create", row: { [nameCol.result.id]: "Implementation details review cycle" }, beforeRowId: null },
            { op: "create", row: { [nameCol.result.id]: "Medium option" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      return longCol.result.id;
    }, demo.id);
    const { Status: statusColId } = await demoColumns(a, demo.id, ["Status"]);

    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const grid = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(grid).toBeVisible(SETTLE);

    const cell = (colId: string) =>
      a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${colId}']`).first();
    const openPicker = async (colId: string) => {
      await cell(colId).dblclick();
      await a.waitForTimeout(150);
    };
    const closePicker = () => a.keyboard.press("Escape");

    // The short's options' stand (the demo's Statuses): the picker's width
    // stands the cell's floor (the trigger's width — the options' labels
    // are narrower than the cell).
    await openPicker(statusColId);
    const statusTrigger = a.locator("[data-slot='docblocks/database-enum-picker-trigger']").first();
    const statusTriggerWidth = await statusTrigger.boundingBox().then((box) => box!.width);
    const statusPopoverWidth = await pickerPopover(a)
      .boundingBox()
      .then((box) => box!.width);
    expect(Math.abs(statusPopoverWidth - statusTriggerWidth)).toBeLessThanOrEqual(2);
    await closePicker();

    // The long's options' stand: the widest label's drive over the
    // 220 px's ceiling (the "Implementation details review cycle's" label
    // + the row's chrome stands over the 220's floor — the ceiling's clamp).
    await openPicker(longColId);
    const longPopoverBox = await pickerPopover(a).boundingBox();
    expect(longPopoverBox!.width).toBeLessThanOrEqual(222);
    expect(longPopoverBox!.width).toBeGreaterThan(150);
    // The rows' stand over the clamp (the label's full's line — the
    // ellipsis is out).
    const longRow = a.locator("[data-slot='docblocks/database-enum-picker-row']").first();
    const longRowWidth = await longRow.boundingBox().then((box) => box!.width);
    expect(longRowWidth).toBeLessThanOrEqual(longPopoverBox!.width);
    await closePicker();
  } finally {
    await context.close();
  }
});

test("the picker's rows stand the selection (the current value's highlight; the empty's clear's highlight)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", `enum-select-${Math.random().toString(36).slice(2, 8)}`);
    const demo = await bridgeDemoTable(a);
    const { Status: statusColId, Title: titleColId } = await demoColumns(a, demo.id, ["Status", "Title"]);
    // The empty's value's row (the clear's highlight's stand): the seed's
    // rows stand filled — the new's row over the missing's status.
    const emptyRowIndex = await a.evaluate(
      async ({ tableId, statusColId, titleColId }) => {
        const bridge = window.__bridge!;
        const snapshot = await bridge.snapshotTable(tableId, {});
        const empty = snapshot.page.rows.findIndex((row) => row.cells[statusColId] == null);
        if (empty !== -1) return empty;
        await bridge.batchRows(
          tableId,
          { ops: [{ op: "create", row: { [titleColId]: "The empty's row" }, beforeRowId: null }] },
          { operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() }
        );
        const fresh = await bridge.snapshotTable(tableId, {});
        return fresh.page.rows.length - 1;
      },
      { tableId: demo.id, statusColId, titleColId }
    );
    const todoId = await statusOptionId(a, "todo");
    const doingId = await statusOptionId(a, "doing");

    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const grid = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(grid).toBeVisible(SETTLE);

    const filledCell = a
      .locator(`[data-slot='docblocks/database-cell'][data-column-id='${statusColId}']`)
      .filter({ hasText: "todo" })
      .first();
    const emptyCell = a
      .locator(`[data-slot='docblocks/database-cell'][data-column-id='${statusColId}'][data-row='${emptyRowIndex}']`)
      .first();

    // The filled's cell: the current value's row stands the selected's
    // background (the muted's stand over the row's default).
    await filledCell.dblclick();
    await a.waitForTimeout(150);
    const bgOf = (value: string) =>
      a
        .locator(`[data-slot='docblocks/database-enum-picker-row'][data-option-value='${value}']`)
        .evaluate((el) => getComputedStyle(el).backgroundColor);
    const selectedBg = await bgOf(todoId);
    const unselectedBg = await bgOf(doingId);
    expect(selectedBg).not.toBe(unselectedBg);
    await a.keyboard.press("Escape");
    await a.waitForTimeout(200);

    // The empty's cell: the clear's row stands the selected's background,
    // the options' rows stand the default.
    await emptyCell.dblclick();
    await a.waitForTimeout(150);
    const clearBg = await a
      .locator("[data-slot='docblocks/database-enum-picker-clear']")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(clearBg).toBe(selectedBg);
    const optionBg = await bgOf(todoId);
    expect(optionBg).toBe(unselectedBg);
  } finally {
    await context.close();
  }
});
