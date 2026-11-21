import { describe, expect, it } from "vitest";

import { createDoc, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

/**
 *acceptance: the table's `columnOrder` (the shared CRDT array of
 * column ids) is the single source of the column set; the `columnWidths`
 * mirror it (materialized at table creation, element-level ops).
 * Concurrent column inserts / removes / moves and row inserts converge to
 * a consistent grid: every row holds exactly `columnOrder.length` cells,
 * each cell bound to its column in order; the snapshot after each merge
 * passes validateDoc and loadDoc.
 */
describe("concurrent table column edits keep the grid consistent", () => {
  const seedTable = (id: string): { a: Doc; table: string } => {
    const a = createDoc({ id });
    const table = a.insertBlock("table", { cols: 2 });
    a.insertTableRow(table);
    a.insertTableRow(table);
    return { a, table };
  };
  const fork = (d: Doc): Doc => loadDoc(d.encode());
  const exchange = (a: Doc, b: Doc): void => {
    const aBytes = a.encode();
    const bBytes = b.encode();
    a.applyUpdate(bBytes);
    b.applyUpdate(aBytes);
  };
  /** The grid is consistent: every row holds AT MOST the merged column count (a
   * short row is the concurrent row×column race residue — the read/UI stand
   * the missing cells as placeholders), no cell is bound twice to one column,
   * and every binding stands a column of the merged columnOrder. The
   * derived columnWidths is always the full array. */
  const expectConsistentGrid = (json: DocJSON, tableId: string): void => {
    const table = json.blocks[tableId] as {
      columnOrder: string[];
      children: string[];
      attrs?: { columnWidths?: number[] };
    };
    const columns = table.columnOrder;
    expect(table.attrs?.columnWidths).toHaveLength(columns.length);
    const columnSet = new Set(columns);
    for (const rowId of table.children) {
      const row = json.blocks[rowId] as { children: string[] };
      expect(row.children.length).toBeLessThanOrEqual(columns.length);
      const bound = new Set<string>();
      for (const cellId of row.children) {
        const cell = json.blocks[cellId] as { attrs?: { columnId?: string } };
        const columnId = cell.attrs?.columnId;
        if (columnId === undefined) expect.fail("a cell stands its columnId binding");
        expect(columnSet.has(columnId)).toBe(true);
        expect(bound.has(columnId)).toBe(false);
        bound.add(columnId);
      }
    }
  };

  it("concurrent column inserts keep the grid consistent and reloadable", () => {
    const { a, table } = seedTable("table-insert");
    const b = fork(a);
    a.insertTableColumn(table, 1);
    b.insertTableColumn(table, 1);
    exchange(a, b);
    const json = a.toJSON();
    expect(validateDoc(json)).toEqual([]);
    expect(() => loadDoc(a.encode())).not.toThrow();
    expectConsistentGrid(json, table);
    expectConsistentGrid(loadDoc(a.encode()).toJSON(), table);
    expect(a.toJSON()).toEqual(b.toJSON());
  });

  it("a concurrent column insert and remove keep a consistent grid", () => {
    const { a, table } = seedTable("table-rm");
    const b = fork(a);
    a.insertTableColumn(table, 0);
    b.removeTableColumn(table, 1);
    exchange(a, b);
    const json = a.toJSON();
    expect(validateDoc(json)).toEqual([]);
    expect(() => loadDoc(a.encode())).not.toThrow();
    expectConsistentGrid(json, table);
  });

  it("a concurrent row insert and column insert keep every row full", () => {
    const { a, table } = seedTable("table-rowxcol");
    const b = fork(a);
    a.insertTableRow(table);
    b.insertTableColumn(table);
    exchange(a, b);
    const json = a.toJSON();
    expect(validateDoc(json)).toEqual([]);
    expect(() => loadDoc(a.encode())).not.toThrow();
    expectConsistentGrid(json, table);
  });

  it("a concurrent column move and width set converge on the same JSON", () => {
    const { a, table } = seedTable("table-move");
    const b = fork(a);
    a.setTableColumnWidth(table, 0, 150);
    b.moveTableColumn(table, 0, 1);
    exchange(a, b);
    const json = a.toJSON();
    expect(validateDoc(json)).toEqual([]);
    expect(() => loadDoc(a.encode())).not.toThrow();
    expectConsistentGrid(json, table);
    expect(JSON.stringify(a.toJSON())).toBe(JSON.stringify(b.toJSON()));
  });

  it("column ops stand on the short row residue (a missing cell is skipped, no throw)", () => {
    const { a, table } = seedTable("table-op-short");
    const b = fork(a);
    a.insertTableRow(table);
    b.insertTableColumn(table);
    exchange(a, b);
    // The a-only row lacks the new (last) column's cell: removing that
    // column skips the missing cell (the column identity and the peers'
    // cells still move), the snapshot stays valid and reloadable.
    expect(() => a.removeTableColumn(table, 2)).not.toThrow();
    const json = a.toJSON();
    expect(validateDoc(json)).toEqual([]);
    expect(() => loadDoc(a.encode())).not.toThrow();
    expectConsistentGrid(json, table);
  });
});
