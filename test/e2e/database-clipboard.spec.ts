import { expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

const GRID_MIME = "application/x-docblocks-database-grid";

test("the mixed structured paste preserves reference ids, highlights the range, and undoes once", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const page = await context.newPage();
  try {
    await openPane(page, "a", "db-structured-paste");
    const seed = await page.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const refs = await bridge.createTable({ name: "Clipboard refs" }, ctx());
      const name = await bridge.createColumn(
        refs.result.id,
        { column: { name: "Name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const refRows = await bridge.batchRows(
        refs.result.id,
        {
          ops: [
            { op: "create", row: { [name.result.id]: "Old" }, beforeRowId: null },
            { op: "create", row: { [name.result.id]: "New" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      const table = await bridge.createTable({ name: "Clipboard grid" }, ctx());
      const tableId = table.result.id;
      const specs = [
        { name: "Text", type: "text" },
        { name: "Number", type: "integer" },
        { name: "Boolean", type: "boolean" },
        { name: "Enum", type: "text", reference: { kind: "enum" as const, tableId: refs.result.id, many: false } },
        { name: "Row", type: "text", reference: { kind: "row" as const, tableId: refs.result.id, many: false } },
      ];
      const columnIds: string[] = [];
      for (const [position, spec] of specs.entries()) {
        const column = await bridge.createColumn(tableId, { column: { ...spec, position, nullable: true } }, ctx());
        columnIds.push(column.result.id);
      }
      const oldId = refRows.result.rows[0]!.id;
      const newId = refRows.result.rows[1]!.id;
      await bridge.batchRows(
        tableId,
        {
          ops: [
            {
              op: "create",
              row: { [columnIds[0]!]: "old", [columnIds[3]!]: oldId, [columnIds[4]!]: oldId },
              beforeRowId: null,
            },
          ],
        },
        ctx()
      );
      window.__paneDocs!.a!.insertBlock("database", { tableId });
      return { tableId, columnIds, oldId, newId };
    });
    const first = page.locator("[data-slot='docblocks/database-cell'][data-row='0'][data-col='0']");
    await expect(first).toBeVisible(SETTLE);
    await first.click();
    const payload = JSON.stringify({
      v: 1,
      tableId: seed.tableId,
      cells: [
        ["new-a", 8, true, seed.newId, seed.newId],
        ["new-b", 9, false, seed.newId, seed.newId],
      ],
    });
    await first.evaluate(
      (cell, { mime, raw }) => {
        const data = new DataTransfer();
        data.setData(mime, raw);
        data.setData("text/plain", "new-a\t8\ttrue\tNew\tNew\nnew-b\t9\tfalse\tNew\tNew");
        cell.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      },
      { mime: GRID_MIME, raw: payload }
    );
    await expect(page.locator("[data-slot='docblocks/database-cell']")).toHaveCount(10, SETTLE);
    await expect(page.locator("[data-slot='docblocks/database-paste-range']")).toHaveCount(10, SETTLE);
    const values = await page.evaluate(async (tableId) => {
      const snapshot = await window.__bridge!.snapshotTable(tableId, {});
      return snapshot.page.rows.map((row) => row.cells);
    }, seed.tableId);
    for (const cells of values) {
      expect(cells[seed.columnIds[1]!]).toEqual(expect.any(Number));
      expect(typeof cells[seed.columnIds[2]!]).toBe("boolean");
      expect(cells[seed.columnIds[3]!]).toBe(seed.newId);
      expect(cells[seed.columnIds[4]!]).toBe(seed.newId);
    }
    await page.locator("[data-slot='docblocks/database-cell'][data-row='1'][data-col='0']").click();
    await expect(page.locator("[data-slot='docblocks/database-paste-range']")).toHaveCount(0);
    await page.locator("[data-slot='docblocks/database-undo']").click();
    await expect(page.locator("[data-slot='docblocks/database-cell']")).toHaveCount(5, SETTLE);
    const restored = await page.evaluate(async (tableId) => {
      const snapshot = await window.__bridge!.snapshotTable(tableId, {});
      return snapshot.page.rows[0]!.cells;
    }, seed.tableId);
    expect(restored[seed.columnIds[0]!]).toBe("old");
    expect(restored[seed.columnIds[3]!]).toBe(seed.oldId);
    expect(restored[seed.columnIds[4]!]).toBe(seed.oldId);
  } finally {
    await context.close();
  }
});
