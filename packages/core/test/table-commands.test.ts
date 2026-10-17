import { describe, expect, it } from "vitest";

import {
  DetachedBlockError,
  DocBlocksError,
  InvalidAttrsError,
  InvalidOperationError,
  InvalidRangeError,
  UnknownBlockError,
  createDoc,
  fromJSON,
} from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

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

describe("the table schema extensions", () => {
  it("accepts the cell color attrs and the columnWidths array (round-trip)", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 2);
    doc.setTableColumnColor(table, 0, "#112233");
    doc.setTableRowColor(table, rowIds[0]!, "#445566");
    doc.setTableColumnWidth(table, 1, 180);
    const json = doc.toJSON();
    const firstCell = doc.getChildren(rowIds[0]!)[0]!;
    const cell = doc.getBlock(firstCell)!;
    expect("attrs" in cell && cell.attrs).toMatchObject({ columnColor: "#112233", rowColor: "#445566" });
    expect(validateDoc(json)).toEqual([]);
    const revived = fromJSON(json);
    expect(revived.toJSON()).toEqual(json);
  });

  it("rejects a non-hex cell color and a bad columnWidths entry (strict validator)", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 1);
    expectThrows(() => doc.setTableRowColor(table, rowIds[0]!, "red"), InvalidAttrsError);
    expectThrows(() => doc.setTableColumnWidth(table, 0, 40), InvalidAttrsError);
    const json: DocJSON = {
      v: 1,
      id: "x",
      title: "",
      createdAt: CREATED_AT,
      blocks: {
        x: { type: "root", children: [table] },
        [table]: {
          type: "table",
          attrs: { cols: 2, columnWidths: [50] },
          children: [rowIds[0]!],
        },
        [rowIds[0]!]: { type: "table-row", children: ["c1", "c2"] },
        c1: { type: "table-cell", attrs: { rowColor: "nope" }, content: [], children: [] },
        c2: { type: "table-cell", content: [], children: [] },
      },
    } as DocJSON;
    const paths = validateDoc(json).map((error) => error.path);
    expect(paths).toContain("blocks.c1.attrs.rowColor");
    expect(paths.filter((path) => path.endsWith(".attrs.columnWidths"))).toHaveLength(1);
  });
});

/** A cell's attrs (undefined when the cell carries none). */
const cellAttrs = (doc: Doc, cellId: string) => {
  const block = doc.getBlock(cellId)!;
  return "attrs" in block ? block.attrs : undefined;
};

/** The table attrs of a (still-table) block id. */
const tableAttrs = (doc: Doc, tableId: string) => {
  const block = doc.getBlock(tableId)!;
  return "attrs" in block ? block.attrs : undefined;
};

/** The table's columnWidths (undefined for a non-table or an absent attr). */
const tableColumnWidths = (doc: Doc, tableId: string): number[] | undefined => {
  const block = doc.getBlock(tableId)!;
  return block.type === "table" ? block.attrs.columnWidths : undefined;
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

  it("insertTableRow lands right after afterRowId", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 3);
    const row = doc.insertTableRow(table, rowIds[1]!);
    expect(doc.getChildren(table)).toEqual([rowIds[0]!, rowIds[1]!, row, rowIds[2]!]);
  });

  it("insertTableRow rejects a foreign afterRowId", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 1);
    const stranger = doc.insertBlock("paragraph");
    expectThrows(() => doc.insertTableRow(table, stranger), DetachedBlockError);
    expectThrows(() => doc.insertTableRow(stranger, rowIds[0]!), InvalidOperationError);
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
    expect(cellAttrs(doc, cellsOf(doc, rowIds[1]!)[0]!)).toBeUndefined();
    doc.setTableRowColor(table, rowIds[0]!, null);
    expect(cellAttrs(doc, cells[0]!)).toBeUndefined();
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

describe("the table column commands", () => {
  it("insertTableColumn appends a 100 px column and keeps cols/widths in sync", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 2);
    doc.setTableColumnWidth(table, 0, 150);
    doc.insertTableColumn(table, 0);
    expect(tableAttrs(doc, table)).toMatchObject({ cols: 3, columnWidths: [150, 100, 100] });
    for (const row of rowIds) expect(cellsOf(doc, row)).toHaveLength(3);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("insertTableColumn without an index appends at the end", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 2);
    doc.insertTableColumn(table);
    expect(tableAttrs(doc, table)).toMatchObject({ cols: 3, columnWidths: [100, 100, 100] });
    expect(cellsOf(doc, rowIds[0]!)).toHaveLength(3);
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
    expect(tableAttrs(doc, table)).toMatchObject({ cols: 2, columnWidths: [120, 160] });
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

  it("moveTableColumn over an absent columnWidths moves only the cells", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 3, 2);
    doc.moveTableColumn(table, 2, 0);
    expect(tableAttrs(doc, table)).toMatchObject({ cols: 3 });
    expect(tableColumnWidths(doc, table)).toBeUndefined();
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
    expect(tableAttrs(doc, table)).toMatchObject({ cols: 3, columnWidths: [130, 130, 100] });
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
      expect(cellAttrs(doc, cells[0]!)).toBeUndefined();
    }
    doc.setTableColumnColor(table, 1, null);
    for (const row of rowIds) {
      expect(cellAttrs(doc, cellsOf(doc, row)[1]!)).toBeUndefined();
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

  it("setTableColumnWidth to the default value does not materialize the array (zero-byte no-op)", () => {
    const doc = newDoc();
    const { table } = buildTable(doc, 2, 1);
    const bytes = doc.encode().byteLength;
    doc.setTableColumnWidth(table, 0, 100);
    expect(doc.encode().byteLength).toBe(bytes);
    expect(tableColumnWidths(doc, table)).toBeUndefined();
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

describe("the table row/column commands converge", () => {
  it("two peers with divergent commands reach the same JSON", () => {
    const a = createDoc({ id: "cv", createdAt: CREATED_AT });
    const b = createDoc({ id: "cv", createdAt: CREATED_AT });
    // Shared base: a 2x2 table with content in two cells and materialized
    // widths (the divergent width ops stay element-level over the shared array).
    const { table, rowIds } = buildTable(a, 2, 2);
    const cells0 = cellsOf(a, rowIds[0]!);
    seedCell(a, cells0[0]!, "p1");
    seedCell(a, cells0[1]!, "p2");
    a.setTableColumnWidth(table, 0, 130);
    b.applyUpdate(a.encode());
    a.applyUpdate(b.encode());
    // Divergent local commands; each peer only references blocks it knows.
    const rowA = a.insertTableRow(table);
    a.applyUpdate(b.encode());
    b.applyUpdate(a.encode());
    a.moveTableColumn(table, 0, 1);
    const rowB = b.insertTableRow(table);
    b.applyUpdate(a.encode());
    a.applyUpdate(b.encode());
    b.moveTableRow(table, rowA, 0);
    b.setTableColumnWidth(table, 0, 140);
    a.setTableColumnColor(table, 1, "#101010");
    a.duplicateTableColumn(table, 1);
    b.setTableRowColor(table, rowB, "#202020");
    a.applyUpdate(b.encode());
    b.applyUpdate(a.encode());
    a.applyUpdate(b.encode());
    expect(JSON.stringify(a.toJSON())).toBe(JSON.stringify(b.toJSON()));
    expect(validateDoc(a.toJSON())).toEqual([]);
  });
});
