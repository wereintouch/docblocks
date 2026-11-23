import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { DetachedBlockError, DocBlocksError, InvalidRangeError, createDoc } from "../src/core";
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

describe("the table row commands", () => {
  it("insertTableRow appends an empty row (cells without content blocks)", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 3, 1);
    const row = doc.insertTableRow(table);
    expect(row).not.toBe(rowIds[0]);
    expect(doc.getChildren(table)).toEqual([...rowIds, row]);
    const cells = cellsOf(doc, row);
    expect(cells).toHaveLength(3);
    for (const cell of cells) expect(doc.getChildren(cell)).toEqual([]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("the new row/cell stand the owner parent (the layout's field, not the array-search fallback)", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 3, 1);
    const blocks = doc.raw.getMap("blocks");
    const parentOf = (id: string): string | undefined => {
      const map = blocks.get(id);
      return map instanceof Y.Map ? (map.get("parent") as string | undefined) : undefined;
    };
    // The insertTableRow's row + its cells.
    const row = doc.insertTableRow(table);
    expect(parentOf(row)).toBe(table);
    for (const cell of cellsOf(doc, row)) expect(parentOf(cell)).toBe(row);
    // The insertTableColumn's cells (every row's new cell).
    doc.insertTableColumn(table);
    for (const rowId of doc.getChildren(table)) {
      const rowCells = cellsOf(doc, rowId);
      expect(parentOf(rowCells[rowCells.length - 1]!)).toBe(rowId);
    }
    // The subtree copies (the row / the column duplicate) stand the parent
    // over the remapped ids (the copied content's parent is the fresh cell).
    const sourceRow = rowIds[0]!;
    seedCell(doc, cellsOf(doc, sourceRow)[0]!, "text");
    const dupRow = doc.duplicateTableRow(table, sourceRow);
    expect(parentOf(dupRow)).toBe(table);
    for (const cell of cellsOf(doc, dupRow)) expect(parentOf(cell)).toBe(dupRow);
    const sourceCell = cellsOf(doc, sourceRow)[0]!;
    const contentOf = (id: string): string[] => doc.getChildren(id);
    expect(parentOf(contentOf(sourceCell)[0]!)).toBe(sourceCell);
    doc.duplicateTableColumn(table, 0);
    const dupRowCells = cellsOf(doc, dupRow);
    for (const cell of dupRowCells) {
      const children = contentOf(cell);
      for (const child of children) expect(parentOf(child)).toBe(cell);
    }
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("insertTableRow lands at the given position (before the first, in the middle)", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 3);
    const middle = doc.insertTableRow(table, 1);
    expect(doc.getChildren(table)).toEqual([rowIds[0]!, middle, rowIds[1]!, rowIds[2]!]);
    const first = doc.insertTableRow(table, 0);
    expect(doc.getChildren(table)).toEqual([first, rowIds[0]!, middle, rowIds[1]!, rowIds[2]!]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("insertTableRow rejects an out-of-range position", () => {
    const doc = newDoc();
    const { table } = buildTable(doc, 2, 1);
    expectThrows(() => doc.insertTableRow(table, -1), InvalidRangeError);
    expectThrows(() => doc.insertTableRow(table, 2), InvalidRangeError);
    expectThrows(() => doc.insertTableRow(table, 0.5), InvalidRangeError);
  });

  it("insertTableRow's new cells inherit the column colors (the column's band stands)", () => {
    const doc = newDoc();
    const { table } = buildTable(doc, 3, 2);
    doc.setTableColumnColor(table, 0, "#112233");
    doc.setTableColumnColor(table, 2, "#445566");
    const row = doc.insertTableRow(table, 1);
    const cells = cellsOf(doc, row);
    expect(cellAttrs(doc, cells[0]!)).toMatchObject({ columnColor: "#112233" });
    // A column without a color writes no color attr (the second column stands plain).
    expect(cellAttrs(doc, cells[1]!)?.columnColor).toBeUndefined();
    expect(cellAttrs(doc, cells[2]!)).toMatchObject({ columnColor: "#445566" });
    // A table without column colors inherits none (no color attr is written).
    const { table: plainTable } = buildTable(doc, 2, 1);
    const plain = doc.insertTableRow(plainTable);
    for (const cell of cellsOf(doc, plain)) expect(cellAttrs(doc, cell)?.columnColor).toBeUndefined();
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("removeTableRow removes the row and its cells; the last row converts the table", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 3);
    doc.removeTableRow(table, rowIds[1]!);
    expect(doc.getChildren(table)).toEqual([rowIds[0]!, rowIds[2]!]);
    expect(doc.getBlock(rowIds[1]!)).toBeNull();
    for (const cell of cellsOf(doc, rowIds[2]!)) expect(doc.getBlock(cell)).not.toBeNull();
    doc.removeTableRow(table, rowIds[0]!);
    doc.removeTableRow(table, rowIds[2]!);
    const block = doc.getBlock(table)!;
    expect(block.type).toBe("paragraph");
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("removeTableRow rejects a foreign rowId", () => {
    const doc = newDoc();
    const { table } = buildTable(doc, 2, 1);
    const stranger = doc.insertBlock("paragraph");
    expectThrows(() => doc.removeTableRow(table, stranger), DetachedBlockError);
  });

  it("undoing the last-row conversion restores the table (one undo step)", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 1);
    const cells = cellsOf(doc, rowIds[0]!);
    seedCell(doc, cells[0]!, "stays");
    const before = doc.toJSON();
    doc.removeTableRow(table, rowIds[0]!);
    expect(doc.getBlock(table)!.type).toBe("paragraph");
    doc.undo();
    expect(doc.getBlock(table)!.type).toBe("table");
    expect(doc.toJSON()).toEqual(before);
  });

  it("moveTableRow uses the pre-move index semantics and rejects the out-of-range", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 3);
    doc.moveTableRow(table, rowIds[2]!, 0);
    expect(doc.getChildren(table)).toEqual([rowIds[2]!, rowIds[0]!, rowIds[1]!]);
    doc.moveTableRow(table, rowIds[2]!, 3); // the end index appends
    expect(doc.getChildren(table)).toEqual([rowIds[0]!, rowIds[1]!, rowIds[2]!]);
    expectThrows(() => doc.moveTableRow(table, rowIds[0]!, 4), InvalidRangeError);
    expectThrows(() => doc.moveTableRow(table, rowIds[0]!, -1), InvalidRangeError);
  });

  it("duplicateTableRow deep-copies the cells (content, marks, colors) and leaves the source", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 1);
    const cells = cellsOf(doc, rowIds[0]!);
    seedCell(doc, cells[0]!, "hello");
    seedCell(doc, cells[1]!, "world");
    doc.setTableRowColor(table, rowIds[0]!, "#aabbcc");
    const copy = doc.duplicateTableRow(table, rowIds[0]!);
    const children = doc.getChildren(table);
    expect(children).toEqual([rowIds[0]!, copy]);
    const copyCells = cellsOf(doc, copy);
    expect(doc.getText(doc.getChildren(copyCells[0]!)[0]!)).toBe("hello");
    expect(doc.getText(doc.getChildren(copyCells[1]!)[0]!)).toBe("world");
    expect(cellAttrs(doc, copyCells[0]!)).toMatchObject({ rowColor: "#aabbcc" });
    // The source stands untouched; the copies are fresh blocks.
    expect(doc.getText(doc.getChildren(cells[0]!)[0]!)).toBe("hello");
    expect(copyCells).not.toEqual(cells);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("clearTableRow empties the cells (the cells stay, the content blocks go)", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 1);
    const cells = cellsOf(doc, rowIds[0]!);
    seedCell(doc, cells[0]!, "a");
    seedCell(doc, cells[1]!, "b");
    doc.clearTableRow(table, rowIds[0]!);
    expect(doc.getChildren(rowIds[0]!)).toEqual(cells);
    for (const cell of cells) expect(doc.getChildren(cell)).toEqual([]);
  });

  it("setTableRowColor sets every cell of the row; null removes it", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 2);
    doc.setTableRowColor(table, rowIds[0]!, "#123456");
    const cells = cellsOf(doc, rowIds[0]!);
    expect(cellAttrs(doc, cells[0]!)).toMatchObject({ rowColor: "#123456" });
    expect(cellAttrs(doc, cells[1]!)).toMatchObject({ rowColor: "#123456" });
    expect(cellAttrs(doc, cellsOf(doc, rowIds[1]!)[0]!)?.rowColor).toBeUndefined();
    doc.setTableRowColor(table, rowIds[0]!, null);
    expect(cellAttrs(doc, cells[0]!)?.rowColor).toBeUndefined();
  });

  it("every row command is one undo step", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 1);
    const before = doc.toJSON();
    doc.insertTableRow(table);
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
    doc.duplicateTableRow(table, rowIds[0]!);
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
    doc.moveTableRow(table, rowIds[0]!, 1);
    expectThrows(() => doc.moveTableRow(table, rowIds[0]!, 99), InvalidRangeError);
    doc.setTableRowColor(table, rowIds[0]!, "#ff0000");
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
  });
});
