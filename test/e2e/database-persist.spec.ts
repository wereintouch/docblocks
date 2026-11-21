// The harness's persistent bridge's stand: the tables / the rows / the
// row-link's id stand the tab's reload's restore (the snapshot's save's
// debounce, the grid's render's regression).
import { expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

test("the bridge's state survives the tab's reload (the harness's persistent bridge: the tables / the rows / the row-link ids stand over the restore)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", `db-persist-${Math.random().toString(36).slice(2, 8)}`);
    // The table + the rows (the generated row ids: the restore's pk stand)
    // + the row-link's reference over the other table's row.
    const { tableId, nameColId, ownerColId, rowIds, annId } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const table = await bridge.createTable({ name: "Persist" }, ctx());
      const id = table.result.id;
      const nameCol = await bridge.createColumn(
        id,
        { column: { name: "Name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const people = await bridge.createTable({ name: "Persist People" }, ctx());
      const peopleId = people.result.id;
      // The display column (the row-link's display resolution stands the
      // first text column — its absence stands the raw id's stand).
      const peopleNameCol = await bridge.createColumn(
        peopleId,
        { column: { name: "Name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const peopleRows = await bridge.batchRows(
        peopleId,
        { ops: [{ op: "create", row: { [peopleNameCol.result.id]: "Ann" }, beforeRowId: null }] },
        ctx()
      );
      const ownerCol = await bridge.createColumn(
        id,
        {
          column: {
            name: "Owner",
            type: "text",
            position: 1,
            nullable: true,
            reference: { kind: "row", tableId: peopleId, many: false },
          },
        },
        ctx()
      );
      const rows = await bridge.batchRows(
        id,
        {
          ops: [
            {
              op: "create",
              row: {
                [nameCol.result.id]: "Row one",
                [ownerCol.result.id]: peopleRows.result.rows[0]!.id,
              },
              beforeRowId: null,
            },
            { op: "create", row: { [nameCol.result.id]: "Row two" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      return {
        tableId: id,
        nameColId: nameCol.result.id,
        ownerColId: ownerCol.result.id,
        rowIds: rows.result.rows.map((row) => row.id),
        annId: peopleRows.result.rows[0]!.id,
      };
    });
    // The snapshot's save (the debounce's window + the re-read's pass).
    await a.waitForTimeout(750);
    await a.reload();
    await expect(a.getByTestId("status-a")).toHaveText("connected");

    // The restore: the table's id / the rows' ids / the cells / the
    // row-link's reference stand (the doc's references survive too).
    const after = await a.evaluate(
      async ({ id, nameColId, ownerColId }) => {
        const page = await window.__bridge!.snapshotTable(id, {});
        return {
          ids: page.page.rows.map((row) => row.id),
          owner: page.page.rows[0]?.cells[ownerColId] ?? null,
          name: page.page.rows[0]?.cells[nameColId] ?? null,
        };
      },
      { id: tableId, nameColId, ownerColId }
    );
    expect(after.ids).toEqual(rowIds);
    expect(after.owner).toBe(annId);
    expect(after.name).toBe("Row one");

    // The grid renders the restored rows (the restore stands before the
    // grid's first read; the row-link's display stands the restored
    // reference).
    await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), tableId);
    const gridA = a.locator("[data-slot='docblocks/database-grid']");
    await expect(gridA).toBeVisible(SETTLE);
    await expect(gridA.getByText("Row one")).toBeVisible(SETTLE);
    await expect(gridA.getByText("Row two")).toBeVisible(SETTLE);
    // The row-link's display (the joined name over the restored id).
    const ownerCell = gridA.locator(`[data-slot='docblocks/database-cell'][data-column-id='${ownerColId}']`).first();
    await expect(ownerCell).toContainText("Ann", SETTLE);
  } finally {
    await context.close();
  }
});
