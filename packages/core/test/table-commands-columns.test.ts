import { describe, expect, it } from "vitest";

import {
  DocBlocksError,
  InvalidAttrsError,
  InvalidOperationError,
  InvalidRangeError,
  UnknownBlockError,
  createDoc,
} from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "tbl", createdAt: CREATED_AT });

const expectThrows = (fn: () => unknown, ctor: new (message: string) => Error): Error => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ctor);
    expect(error).toBeInstanceOf(DocBlocksError);
    return error as Error;
  }
  throw new Error("expected the command to throw");
};

/** A `cols`-wide table with `rows` complete rows (empty cells). */
function buildTable(doc: Doc, cols: number, rows: number): { table: string; rowIds: string[] } {
  const table = doc.insertBlock("table", { cols });
  const rowIds: string[] = [];
  for (let r = 0; r < rows; r++) {
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    rowIds.push(row);
    for (let c = 0; c < cols; c++) doc.insertBlock("table-cell", undefined, { parent: row });
  }
  return { table, rowIds };
}

/** The cell ids of a row in column order. */
const cellsOf = (doc: Doc, rowId: string): string[] => doc.getChildren(rowId);

/** Seeds a paragraph with the given text in a cell; returns the paragraph id. */
function seedCell(doc: Doc, cellId: string, text: string): string {
  const paragraph = doc.insertBlock("paragraph", undefined, { parent: cellId });
  doc.insertText(paragraph, 0, text);
  return paragraph;
}

/** A cell's attrs (undefined when the cell carries none). */
const cellAttrs = (doc: Doc, cellId: string) => {
  const block = doc.getBlock(cellId)!;
  return block.type === "table-cell" ? block.attrs : undefined;
};

/** The table attrs of a (still-table) block id. */
const tableAttrs = (doc: Doc, tableId: string) => {
  const block = doc.getBlock(tableId)!;
  return "attrs" in block ? block.attrs : undefined;
};

/** The table's columnWidths (undefined for a non-table or an absent attr). */
const tableColumnWidths = (doc: Doc, tableId: string): number[] | undefined => {
  const block = doc.getBlock(tableId)!;
  return block.type === "table" ? block.attrs?.columnWidths : undefined;
};

describe("the table column commands", () => {
  it("insertTableColumn inserts at the position and keeps cols/widths in sync", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 2);
    doc.setTableColumnWidth(table, 0, 150);
    doc.insertTableColumn(table, 1);
    expect(tableAttrs(doc, table)).toMatchObject({ columnWidths: [150, 100, 100] });
    for (const row of rowIds) expect(cellsOf(doc, row)).toHaveLength(3);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("insertTableColumn lands at the first position (the widths follow)", () => {
    const doc = newDoc();
    const { table } = buildTable(doc, 2, 2);
    doc.setTableColumnWidth(table, 0, 150);
    doc.insertTableColumn(table, 0);
    expect(tableAttrs(doc, table)).toMatchObject({ columnWidths: [100, 150, 100] });
  });

  it("insertTableColumn rejects an out-of-range position", () => {
    const doc = newDoc();
    const { table } = buildTable(doc, 2, 2);
    expectThrows(() => doc.insertTableColumn(table, -1), InvalidRangeError);
    expectThrows(() => doc.insertTableColumn(table, 3), InvalidRangeError);
  });

  it("insertTableColumn without an index appends at the end", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 2);
    doc.insertTableColumn(table);
    expect(tableAttrs(doc, table)).toMatchObject({ columnWidths: [100, 100, 100] });
    expect(cellsOf(doc, rowIds[0]!)).toHaveLength(3);
  });

  it("insertTableColumn's new cells inherit the row colors (the row's band stands)", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 3);
    doc.setTableRowColor(table, rowIds[0]!, "#778899");
    doc.setTableRowColor(table, rowIds[2]!, "#aabbcc");
    doc.insertTableColumn(table, 1);
    const rowCells = rowIds.map((row) => cellsOf(doc, row));
    expect(cellAttrs(doc, rowCells[0]![1]!)).toMatchObject({ rowColor: "#778899" });
    expect(cellAttrs(doc, rowCells[1]![1]!)?.rowColor).toBeUndefined();
    expect(cellAttrs(doc, rowCells[2]![1]!)).toMatchObject({ rowColor: "#aabbcc" });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("removeTableColumn removes the cells in every row and the width entry", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 3, 2);
    const widths = [120, 100, 160];
    doc.setTableColumnWidth(table, 0, widths[0]!);
    doc.setTableColumnWidth(table, 2, widths[2]!);
    const removedCells = rowIds.map((row) => cellsOf(doc, row)[1]!);
    seedCell(doc, removedCells[0]!, "gone");
    doc.removeTableColumn(table, 1);
    expect(tableAttrs(doc, table)).toMatchObject({ columnWidths: [120, 160] });
    for (const row of rowIds) expect(cellsOf(doc, row)).toHaveLength(2);
    for (const cell of removedCells) expect(doc.getBlock(cell)).toBeNull();
  });

  it("removing the last column converts the table into a paragraph (the id and indent stand)", () => {
    const doc = newDoc();
    doc.insertBlock("paragraph"); // indent 0
    doc.insertBlock("list-item", { list: "bullet", indent: 1 }); // indent 1
    const table = doc.insertBlock("table", { cols: 1, indent: 2 });
    doc.insertBlock("table-row", undefined, { parent: table });
    doc.insertBlock("table-cell", undefined, { parent: doc.getChildren(table)[0]! });
    doc.removeTableColumn(table, 0);
    const block = doc.getBlock(table)!;
    expect(block.type).toBe("paragraph");
    expect("attrs" in block ? block.attrs : undefined).toMatchObject({ indent: 2 });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("moveTableColumn moves the cells of every row with the width and the colors", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 3, 2);
    doc.setTableColumnWidth(table, 1, 200);
    doc.setTableColumnColor(table, 1, "#abcdef");
    doc.moveTableColumn(table, 1, 0);
    expect(tableAttrs(doc, table)).toMatchObject({ columnWidths: [200, 100, 100] });
    for (const row of rowIds) {
      const cell = cellsOf(doc, row)[0]!;
      expect(cellAttrs(doc, cell)).toMatchObject({ columnColor: "#abcdef" });
    }
    expectThrows(() => doc.moveTableColumn(table, 3, 0), InvalidRangeError);
    expectThrows(() => doc.moveTableColumn(table, 0, 4), InvalidRangeError);
  });

  it("moveTableColumn moves the width entry with the column", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 3, 2);
    doc.setTableColumnWidth(table, 0, 150);
    doc.setTableColumnWidth(table, 2, 160);
    doc.moveTableColumn(table, 2, 0);
    expect(tableColumnWidths(doc, table)).toEqual([160, 150, 100]);
    for (const row of rowIds) expect(cellsOf(doc, row)).toHaveLength(3);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("duplicateTableColumn deep-copies the cells and the width entry", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 2);
    const sourceCells = rowIds.map((row) => cellsOf(doc, row)[0]!);
    doc.setTableColumnWidth(table, 0, 130);
    doc.setTableColumnColor(table, 0, "#111111");
    for (const cell of sourceCells) seedCell(doc, cell, "copy me");
    doc.duplicateTableColumn(table, 0);
    expect(tableAttrs(doc, table)).toMatchObject({ columnWidths: [130, 130, 100] });
    for (const row of rowIds) {
      const cells = cellsOf(doc, row);
      expect(doc.getText(doc.getChildren(cells[1]!)[0]!)).toBe("copy me");
      expect(cellAttrs(doc, cells[1]!)).toMatchObject({ columnColor: "#111111" });
    }
    expect(doc.getText(doc.getChildren(sourceCells[0]!)[0]!)).toBe("copy me");
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("clearTableColumn empties the cells of the column in every row", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 2);
    for (const row of rowIds) {
      const cells = cellsOf(doc, row);
      seedCell(doc, cells[0]!, "x");
      seedCell(doc, cells[1]!, "y");
    }
    doc.clearTableColumn(table, 0);
    for (const row of rowIds) {
      const cells = cellsOf(doc, row);
      expect(doc.getChildren(cells[0]!)).toEqual([]);
      expect(doc.getChildren(cells[1]!)).toHaveLength(1);
    }
  });

  it("setTableColumnColor sets every cell of the column; null removes it", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 2);
    doc.setTableColumnColor(table, 1, "#222222");
    for (const row of rowIds) {
      const cells = cellsOf(doc, row);
      expect(cellAttrs(doc, cells[1]!)).toMatchObject({ columnColor: "#222222" });
      expect(cellAttrs(doc, cells[0]!)?.columnColor).toBeUndefined();
    }
    doc.setTableColumnColor(table, 1, null);
    for (const row of rowIds) {
      expect(cellAttrs(doc, cellsOf(doc, row)[1]!)?.columnColor).toBeUndefined();
    }
    expectThrows(() => doc.setTableColumnColor(table, 5, "#123456"), InvalidRangeError);
  });

  it("setTableColumnWidth is a zero-byte no-op on an equal value and rejects < 50", () => {
    const doc = newDoc();
    const { table } = buildTable(doc, 2, 1);
    doc.setTableColumnWidth(table, 0, 120);
    const bytes = doc.encode().byteLength;
    doc.setTableColumnWidth(table, 0, 120);
    expect(doc.encode().byteLength).toBe(bytes);
    expectThrows(() => doc.setTableColumnWidth(table, 0, 49.5), InvalidAttrsError);
    expectThrows(() => doc.setTableColumnWidth(table, 0, Number.NaN), InvalidAttrsError);
  });

  it("setTableColumnWidth to the standing value is a zero-byte no-op", () => {
    const doc = newDoc();
    const { table } = buildTable(doc, 2, 1);
    const bytes = doc.encode().byteLength;
    doc.setTableColumnWidth(table, 0, 100);
    expect(doc.encode().byteLength).toBe(bytes);
    expect(tableColumnWidths(doc, table)).toEqual([100, 100]);
  });

  it("every column command is one undo step", () => {
    const doc = newDoc();
    const { table } = buildTable(doc, 2, 1);
    const before = doc.toJSON();
    doc.insertTableColumn(table);
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
    doc.removeTableColumn(table, 0);
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
    doc.duplicateTableColumn(table, 0);
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
  });

  it("rejects commands on a non-table block", () => {
    const doc = newDoc();
    const paragraph = doc.insertBlock("paragraph");
    expectThrows(() => doc.insertTableRow(paragraph), InvalidOperationError);
    expectThrows(() => doc.insertTableColumn(paragraph), InvalidOperationError);
    expectThrows(() => doc.removeTableColumn(paragraph, 0), InvalidOperationError);
    const ghost = "ghost";
    expectThrows(() => doc.removeTableColumn(ghost, 0), UnknownBlockError);
  });
});
