// The enum's overflow's stands: the single press's picker over the
// clipped value (the wide cell keeps the double press) and the multi's
// tall's list over the clipped chips (the wide's stand stays the compact).
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

/** Set the database block's column width (the block's `columnWidths`
 *  attribute — the index's stand over the rendered header's order). */
async function setColumnWidth(page: Page, blockId: string, colId: string, width: number): Promise<void> {
  await page.evaluate(
    ([id, target, w]) => {
      const [blockId, colId, width] = [id, target, w] as [string, string, number];
      const headerCells = document.querySelectorAll(
        `[data-block-id='${blockId}'] [data-slot='docblocks/database-header-cell']`
      );
      const order = [...headerCells].map((el) => el.getAttribute("data-column-id") as string);
      const block = window.__paneDocs!.a!.getBlock(blockId) as unknown as { columnWidths?: number[] };
      const existing = block.columnWidths ?? [];
      const next = order.map((cid, i) => (cid === colId ? width : (existing[i] ?? 160)));
      window.__paneDocs!.a!.updateBlock(blockId, { columnWidths: next });
    },
    [blockId, colId, width]
  );
}

/** The picker's popover (the Radix's content — the last's over the
 *  stacked's stand). */
const pickerPopover = (page: Page) => page.locator("[data-slot='popover-content']").last();

test("the enum's overflow's stand: the single press stands the picker (the clipped value; the wide cell keeps the double press)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", `enum-overflow-${Math.random().toString(36).slice(2, 8)}`);
    const demo = await bridgeDemoTable(a);
    // The long's option (the value's display stands over the clip's
    // ellipsis — the single press's trigger's stand).
    const { longColId, shortId } = await a.evaluate(async (tableId) => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const longTable = await bridge.createTable(
        { name: `Enum Overflow ${Math.random().toString(36).slice(2, 6)}`, system: true },
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
      const rows = await bridge.batchRows(
        longTableId,
        {
          ops: [
            { op: "create", row: { [nameCol.result.id]: "ok" }, beforeRowId: null },
            { op: "create", row: { [nameCol.result.id]: "Implementation details review cycle" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      const shortId = rows.result.rows[0]!.id;
      const longId = rows.result.rows[1]!.id;
      const page = await bridge.snapshotTable(tableId, {});
      const rowId = page.page.rows[0]!.id;
      await bridge.batchRows(
        tableId,
        { ops: [{ op: "update", rowId, cells: { [longCol.result.id]: longId } }] },
        ctx()
      );
      return { longColId: longCol.result.id, shortId, longId };
    }, demo.id);

    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const grid = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(grid).toBeVisible(SETTLE);

    const cell = a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${longColId}']`).first();
    const popoverVisible = async () => pickerPopover(a).isVisible();

    // The wide's stand: the value's full's line — the single press stands
    // the selection only (the double press is the picker's stand).
    await setColumnWidth(a, blockId, longColId, 400);
    await expect(cell).toContainText("Implementation details review cycle", SETTLE);
    await cell.click();
    await a.waitForTimeout(200);
    expect(await popoverVisible()).toBe(false);
    await cell.dblclick();
    await a.waitForTimeout(200);
    expect(await popoverVisible()).toBe(true);
    await a.keyboard.press("Escape");
    await a.waitForTimeout(200);

    // The clipped's stand: the narrow's column (the value's ellipsis) —
    // the single press stands the picker.
    await setColumnWidth(a, blockId, longColId, 110);
    await expect
      .poll(
        async () =>
          cell
            .locator('[data-slot="docblocks/database-ref-chip"]')
            .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
        SETTLE
      )
      .toBe(true);
    await cell.click();
    await a.waitForTimeout(200);
    expect(await popoverVisible()).toBe(true);
    // The picked's stand (the regression): the option's row's pick stands
    // the value (the short's option over the long's).
    const shortRow = a.locator(`[data-slot='docblocks/database-enum-picker-row'][data-option-value='${shortId}']`);
    await shortRow.click();
    await expect(cell).toHaveText("ok", SETTLE);
  } finally {
    await context.close();
  }
});

test("the multi's overflow stretches the list (the clipped chips' tall's stand; the wide's stand stays the compact)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", `enum-tall-${Math.random().toString(36).slice(2, 8)}`);
    const demo = await bridgeDemoTable(a);
    // The multi-enum's column over the long's system's table (the chips'
    // train stands the clip's fade).
    const longtagsColId = await a.evaluate(async (tableId) => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const longTable = await bridge.createTable(
        { name: `Enum Tall ${Math.random().toString(36).slice(2, 6)}`, system: true },
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
      await bridge.createColumn(
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
      const longtagsCol = await bridge.createColumn(
        tableId,
        {
          column: {
            name: "LongTags",
            type: "text",
            position: columns.length + 1,
            nullable: true,
            reference: { kind: "enum", tableId: longTableId, many: true },
          },
        },
        ctx()
      );
      const rows = await bridge.batchRows(
        longTableId,
        {
          ops: [
            { op: "create", row: { [nameCol.result.id]: "Longer option label one" }, beforeRowId: null },
            { op: "create", row: { [nameCol.result.id]: "Another longish label" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      const firstId = rows.result.rows[0]!.id;
      const secondId = rows.result.rows[1]!.id;
      const page = await bridge.snapshotTable(tableId, {});
      const rowId = page.page.rows[0]!.id;
      await bridge.batchRows(
        tableId,
        { ops: [{ op: "update", rowId, cells: { [longtagsCol.result.id]: [firstId, secondId] } }] },
        ctx()
      );
      return longtagsCol.result.id;
    }, demo.id);

    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const grid = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(grid).toBeVisible(SETTLE);
    const cell = a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${longtagsColId}']`).first();
    await expect(cell).toBeVisible(SETTLE);

    const maxHeightOf = () =>
      a.locator("[data-slot='docblocks/database-enum-picker-list']").evaluate((el) => getComputedStyle(el).maxHeight);

    // The wide's stand (the chips' full's train): the compact's list
    // (the 192 px's stand).
    await setColumnWidth(a, blockId, longtagsColId, 420);
    await expect
      .poll(
        async () =>
          cell
            .locator('[data-slot="docblocks/database-ref-chips"]')
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        SETTLE
      )
      .toBe(true);
    await cell.dblclick();
    await a.waitForTimeout(150);
    expect(await maxHeightOf()).toBe("192px");
    await a.keyboard.press("Escape");
    await a.waitForTimeout(200);

    // The clipped's stand (the fade's mask over the train): the tall's
    // list (the 320 px's stand — the values' full's stand over the
    // scroll's inner stand).
    await setColumnWidth(a, blockId, longtagsColId, 120);
    await expect
      .poll(
        async () =>
          cell
            .locator('[data-slot="docblocks/database-ref-chips"]')
            .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
        SETTLE
      )
      .toBe(true);
    await cell.dblclick();
    await a.waitForTimeout(150);
    expect(await maxHeightOf()).toBe("320px");
  } finally {
    await context.close();
  }
});
