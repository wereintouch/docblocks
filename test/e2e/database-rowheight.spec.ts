// The grid's row's constant height's stand: every column's type fits the
// standard row (the enum's add's growth stands none, the theme flip's
// stand stands none).
import { expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

test("the grid's rows stand the constant height (every column type fits the standard row; the enum's add grows none; the theme flip stands none)", async ({
  browser,
}) => {
  // A single pane: the heights are the bounding boxes (no sync needed);
  // a unique room (the relay keeps the room's doc for the dev server's
  // lifetime).
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", `db-rowheight-${Math.random().toString(36).slice(2, 8)}`);
    // A fresh table over the pane's own bridge: the text column only.
    const tableId = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const table = await bridge.createTable({ name: "All types" }, ctx());
      const id = table.result.id;
      const aCol = await bridge.createColumn(
        id,
        { column: { name: "A", type: "text", position: 0, nullable: true } },
        ctx()
      );
      await bridge.batchRows(
        id,
        {
          ops: [
            { op: "create", row: { [aCol.result.id]: "Task one" }, beforeRowId: null },
            { op: "create", row: { [aCol.result.id]: "Task two" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      return id;
    });
    await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), tableId);
    const gridA = a.locator("[data-slot='docblocks/database-grid']");
    await expect(gridA.first()).toBeVisible(SETTLE);
    const rowHeight = (row: number) =>
      a
        .locator(`[data-slot='docblocks/database-cell'][data-row='${row}']`)
        .all()
        .then(async (cells) => Promise.all(cells.map((cell) => cell.evaluate((el) => getComputedStyle(el).height))));

    // The text-only stand: every row stands the standard height (the
    // empty / the text's cells alike).
    const base = await rowHeight(0);
    expect(new Set(base).size).toBe(1);
    expect(await rowHeight(1)).toEqual(base);

    // The enum's column's add: the grid stands live (the bridge's event),
    // and the row's height stands — the trigger fits the standard row
    // (no grow; the new column's cells stand the stand's height).
    const e1ColId = await a.evaluate(async (id) => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const { columns } = await bridge.describeTable(id);
      const e1Col = await bridge.createColumn(
        id,
        {
          column: {
            name: "E1",
            type: "text",
            position: columns.length,
            nullable: true,
            reference: { kind: "enum", tableId: "table-statuses-enum", many: false },
          },
        },
        ctx()
      );
      const enumSnapshot = await bridge.snapshotTable("table-statuses-enum", {});
      const nameColumnId = enumSnapshot.columns.find((column) => column.name === "name")?.id ?? null;
      const todoOption =
        nameColumnId === null ? undefined : enumSnapshot.page.rows.find((row) => row.cells[nameColumnId] === "todo");
      if (todoOption === undefined) throw new Error("the todo option stands absent");
      const page = await bridge.snapshotTable(id, {});
      const rowId = page.page.rows[0]!.id;
      await bridge.batchRows(
        id,
        { ops: [{ op: "update", rowId, cells: { [e1Col.result.id]: todoOption.id } }] },
        ctx()
      );
      return e1Col.result.id;
    }, tableId);
    await expect(a.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${e1ColId}']`)).toBeVisible(
      SETTLE
    );
    const afterEnum = await rowHeight(0);
    expect(new Set(afterEnum).size).toBe(1);
    expect(afterEnum.every((h) => h === base[0])).toBe(true);
    const afterEnumRow1 = await rowHeight(1);
    expect(afterEnumRow1.every((h) => h === base[0])).toBe(true);

    // Every column type over the same table (the multi-enum / the
    // row-link / the date / the datetime / the number / the boolean):
    // the row's height stands over all of them.
    const b1ColId = await a.evaluate(async (id) => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const { columns } = await bridge.describeTable(id);
      const e2Col = await bridge.createColumn(
        id,
        {
          column: {
            name: "E2",
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
        { ops: [{ op: "create", row: { [peopleNameCol.result.id]: "Ann" }, beforeRowId: null }] },
        ctx()
      );
      const r1Col = await bridge.createColumn(
        id,
        {
          column: {
            name: "R1",
            type: "text",
            position: columns.length + 1,
            nullable: true,
            reference: { kind: "row", tableId: peopleId, many: false },
          },
        },
        ctx()
      );
      const d1Col = await bridge.createColumn(
        id,
        { column: { name: "D1", type: "date", position: columns.length + 2, nullable: true } },
        ctx()
      );
      const dt1Col = await bridge.createColumn(
        id,
        { column: { name: "DT1", type: "timestamptz", position: columns.length + 3, nullable: true } },
        ctx()
      );
      const n1Col = await bridge.createColumn(
        id,
        { column: { name: "N1", type: "integer", position: columns.length + 4, nullable: true } },
        ctx()
      );
      const b1Col = await bridge.createColumn(
        id,
        { column: { name: "B1", type: "boolean", position: columns.length + 5, nullable: true } },
        ctx()
      );
      const enumSnapshot = await bridge.snapshotTable("table-statuses-enum", {});
      const nameColumnId = enumSnapshot.columns.find((column) => column.name === "name")?.id ?? null;
      const todoOption =
        nameColumnId === null ? undefined : enumSnapshot.page.rows.find((row) => row.cells[nameColumnId] === "todo");
      if (todoOption === undefined) throw new Error("the todo option stands absent");
      const page = await bridge.snapshotTable(id, {});
      const rowId = page.page.rows[0]!.id;
      await bridge.batchRows(
        id,
        {
          ops: [
            {
              op: "update",
              rowId,
              cells: {
                [e2Col.result.id]: [todoOption.id],
                [r1Col.result.id]: peopleRows.result.rows[0]!.id,
                [d1Col.result.id]: "2026-09-01",
                [dt1Col.result.id]: "2026-12-15T18:00",
                [n1Col.result.id]: 7,
                [b1Col.result.id]: true,
              },
            },
          ],
        },
        ctx()
      );
      return b1Col.result.id;
    }, tableId);
    await expect(a.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${b1ColId}']`)).toBeVisible(
      SETTLE
    );
    const all = await rowHeight(0);
    expect(new Set(all).size).toBe(1);
    expect(all.every((h) => h === base[0])).toBe(true);

    // The theme flip (the harness stands dark by default): the height
    // stands (the token is the theme-independent stand).
    await a.evaluate(() => document.documentElement.classList.remove("dark"));
    await expect
      .poll(async () => {
        const heights = await rowHeight(0);
        return new Set(heights).size === 1 && heights.every((h) => h === base[0]);
      }, SETTLE)
      .toBe(true);
  } finally {
    await context.close();
  }
});
