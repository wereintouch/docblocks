// The table cell merge / split commands: the anchor carries the region's
// spans, the covered cells (and their content) drop, a split restores empty
// cells in the column order. The grid resolver is the placement's source:
// a merged row is legitimately shorter than the column set.
import { describe, expect, it } from "vitest";

import { InvalidOperationError, createDoc, resolveTableGrid } from "../src/core";
import type { Doc } from "../src/core";

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "tbl-merge", createdAt: CREATED_AT });

/** A `cols`-wide table with `rows` complete rows (empty cells). */
function buildTable(doc: Doc, cols: number, rows: number): { table: string; rowIds: string[] } {
  const table = doc.insertBlock("table", { cols });
  const rowIds: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    rowIds.push(row);
    for (let c = 0; c < cols; c += 1) doc.insertBlock("table-cell", undefined, { parent: row });
  }
  return { table, rowIds };
}

/** Seeds a paragraph with the text in a cell; returns the paragraph id. */
function seedCell(doc: Doc, cellId: string, text: string): string {
  const paragraph = doc.insertBlock("paragraph", undefined, { parent: cellId });
  doc.insertText(paragraph, 0, text);
  return paragraph;
}

/** A table-cell's attrs (undefined when the cell carries none). */
function cellAttrs(doc: Doc, cellId: string): Record<string, unknown> | undefined {
  const block = doc.getBlock(cellId);
  if (block === null || block.type !== "table-cell") throw new Error(`not a cell: ${cellId}`);
  return block.attrs as Record<string, unknown> | undefined;
}

/** The cell's plain text (its first child paragraph's runs). */
function cellText(doc: Doc, cellId: string): string {
  const [paragraphId] = doc.getChildren(cellId);
  if (paragraphId === undefined) return "";
  return doc.getText(paragraphId);
}

const expectThrows = (fn: () => unknown, ctor: new (message: string) => Error): Error => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ctor);
    return error as Error;
  }
  throw new Error("expected the command to throw");
};

describe("mergeTableCells", () => {
  it("merges a 2x2 rectangle into its top-left cell and drops the covered cells", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 3, 3);
    const cells = rowIds.map((rowId) => doc.getChildren(rowId));
    seedCell(doc, cells[0]![0]!, "anchor");
    seedCell(doc, cells[0]![1]!, "covered");
    seedCell(doc, cells[1]![0]!, "covered");

    doc.mergeTableCells(table, { row: 0, col: 0 }, { row: 1, col: 1 });

    // The anchor carries the spans; the covered cells are gone from their rows.
    expect(cellAttrs(doc, cells[0]![0]!)).toMatchObject({ colspan: 2, rowspan: 2 });
    expect(cellText(doc, cells[0]![0]!)).toBe("anchor");
    expect(doc.getChildren(rowIds[0]!)).toEqual([cells[0]![0]!, cells[0]![2]!]);
    expect(doc.getChildren(rowIds[1]!)).toEqual([cells[1]![2]!]);
    // The discarded cells' subtrees are gone with them.
    expect(doc.getBlock(cells[0]![1]!)).toBeNull();
    expect(doc.getBlock(cells[1]![0]!)).toBeNull();
  });

  it("stands the grid: the covered coordinates resolve to the anchor", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 3, 3);
    const cells = rowIds.map((rowId) => doc.getChildren(rowId));
    doc.mergeTableCells(table, { row: 0, col: 0 }, { row: 1, col: 1 });

    const grid = resolveTableGrid(doc.raw, table);
    expect(grid).not.toBeNull();
    const anchorId = cells[0]![0]!;
    expect(grid!.cellAt(0, 0)?.id).toBe(anchorId);
    expect(grid!.cellAt(0, 1)?.id).toBe(anchorId);
    expect(grid!.cellAt(1, 0)?.id).toBe(anchorId);
    expect(grid!.cellAt(1, 1)?.id).toBe(anchorId);
    expect(grid!.cellAt(0, 2)?.id).toBe(cells[0]![2]!);
    expect(grid!.anchorsIn(0, 0, 1, 1).map((anchor) => anchor.id)).toEqual([anchorId]);
  });

  it("merges a single row without a rowspan attr (the default stands)", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 3, 2);
    const cells = rowIds.map((rowId) => doc.getChildren(rowId));
    doc.mergeTableCells(table, { row: 0, col: 0 }, { row: 0, col: 2 });

    expect(cellAttrs(doc, cells[0]![0]!)).toMatchObject({ colspan: 3 });
    expect(cellAttrs(doc, cells[0]![0]!)?.rowspan).toBeUndefined();
    expect(doc.getChildren(rowIds[0]!)).toEqual([cells[0]![0]!]);
    expect(doc.getChildren(rowIds[1]!)).toEqual(cells[1]);
  });

  it("merges the whole table into one cell", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 2);
    doc.mergeTableCells(table, { row: 0, col: 0 }, { row: 1, col: 1 });
    expect(cellAttrs(doc, doc.getChildren(rowIds[0]!)[0]!)).toMatchObject({ colspan: 2, rowspan: 2 });
    expect(doc.getChildren(rowIds[1]!)).toEqual([]);
  });

  it("expands an existing region when the rectangle contains it whole", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 3, 2);
    const cells = rowIds.map((rowId) => doc.getChildren(rowId));
    doc.mergeTableCells(table, { row: 0, col: 0 }, { row: 0, col: 1 });
    doc.mergeTableCells(table, { row: 0, col: 0 }, { row: 0, col: 2 });
    expect(cellAttrs(doc, cells[0]![0]!)).toMatchObject({ colspan: 3 });
    expect(doc.getChildren(rowIds[0]!)).toEqual([cells[0]![0]!]);
  });

  it("normalizes the corners (any two opposite corners stand the rectangle)", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 3, 3);
    doc.mergeTableCells(table, { row: 1, col: 1 }, { row: 0, col: 0 });
    expect(cellAttrs(doc, doc.getChildren(rowIds[0]!)[0]!)).toMatchObject({ colspan: 2, rowspan: 2 });
  });

  it("is one undo step (the merge reverts whole)", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 3, 3);
    const cells = rowIds.map((rowId) => doc.getChildren(rowId));
    seedCell(doc, cells[1]![0]!, "covered");
    const before = doc.toJSON();
    doc.mergeTableCells(table, { row: 0, col: 0 }, { row: 1, col: 1 });
    expect(doc.canUndo).toBe(true);
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
  });

  it("rejects a degenerate rectangle, an out-of-bounds one and a partial region overlap", () => {
    const doc = newDoc();
    const { table } = buildTable(doc, 3, 3);
    expectThrows(() => doc.mergeTableCells(table, { row: 1, col: 1 }, { row: 1, col: 1 }), InvalidOperationError);
    expectThrows(() => doc.mergeTableCells(table, { row: 2, col: 2 }, { row: 3, col: 2 }), InvalidOperationError);
    expectThrows(() => doc.mergeTableCells(table, { row: -1, col: 0 }, { row: 0, col: 0 }), InvalidOperationError);
    // The 1x2 region cannot take a single extra cell from its right.
    doc.mergeTableCells(table, { row: 0, col: 0 }, { row: 0, col: 1 });
    expectThrows(() => doc.mergeTableCells(table, { row: 0, col: 1 }, { row: 1, col: 2 }), InvalidOperationError);
  });

  it("rejects a rectangle over a gap (a short row) and one whose corner is a covered cell", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 3, 3);
    doc.mergeTableCells(table, { row: 0, col: 0 }, { row: 1, col: 1 });
    // The top-left corner stands covered by the region anchored above it.
    expectThrows(() => doc.mergeTableCells(table, { row: 1, col: 0 }, { row: 2, col: 1 }), InvalidOperationError);
    expect(rowIds).toHaveLength(3);
  });

  it("rejects a non-table block", () => {
    const doc = newDoc();
    const paragraph = doc.insertBlock("paragraph");
    expectThrows(() => doc.mergeTableCells(paragraph, { row: 0, col: 0 }, { row: 0, col: 1 }), InvalidOperationError);
  });
});

describe("the generic cell insert over a region", () => {
  it("rejects a cell insert into a merged row (the region's cells come from the split)", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 3, 2);
    doc.mergeTableCells(table, { row: 0, col: 0 }, { row: 0, col: 2 });
    expectThrows(() => doc.insertBlock("table-cell", undefined, { parent: rowIds[0]! }), InvalidOperationError);
    // The untouched row keeps taking cells (none — it is full) and the
    // region's row stands as the split left it.
    expect(doc.getChildren(rowIds[0]!)).toHaveLength(1);
  });
});

describe("splitTableCells", () => {
  it("restores empty cells in the column order and keeps the anchor's content", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 3, 3);
    const cells = rowIds.map((rowId) => doc.getChildren(rowId));
    seedCell(doc, cells[0]![0]!, "anchor");
    doc.mergeTableCells(table, { row: 0, col: 0 }, { row: 1, col: 1 });

    doc.splitTableCells(table, 1, 1);

    expect(cellAttrs(doc, cells[0]![0]!)?.colspan).toBeUndefined();
    expect(cellAttrs(doc, cells[0]![0]!)?.rowspan).toBeUndefined();
    expect(cellText(doc, cells[0]![0]!)).toBe("anchor");
    const top = doc.getChildren(rowIds[0]!);
    const second = doc.getChildren(rowIds[1]!);
    expect(top).toHaveLength(3);
    expect(second).toHaveLength(3);
    expect(top[0]).toBe(cells[0]![0]!);
    expect(top[2]).toBe(cells[0]![2]!);
    // The restored cells stand empty.
    expect(doc.getChildren(top[1]!)).toEqual([]);
    expect(doc.getChildren(second[0]!)).toEqual([]);
    expect(doc.getChildren(second[1]!)).toEqual([]);
    expect(doc.getBlock(second[0]!)).toMatchObject({ type: "table-cell" });
  });

  it("restores cells with their column bindings in the column order", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 3, 2);
    const tableBlock = doc.getBlock(table);
    const columnIds = tableBlock !== null && tableBlock.type === "table" ? tableBlock.columnOrder : [];
    doc.mergeTableCells(table, { row: 0, col: 0 }, { row: 0, col: 2 });
    doc.splitTableCells(table, 0, 0);
    const cells = doc.getChildren(rowIds[0]!);
    expect(cells.map((cellId) => cellAttrs(doc, cellId)?.columnId)).toEqual(columnIds);
  });

  it("is a no-op over a single cell (no transaction, no change emitted)", () => {
    const doc = newDoc();
    const { table } = buildTable(doc, 2, 2);
    const before = doc.toJSON();
    let changes = 0;
    const off = doc.onChange(() => {
      changes += 1;
    });
    doc.splitTableCells(table, 0, 0);
    off();
    expect(doc.toJSON()).toEqual(before);
    expect(changes).toBe(0);
  });

  it("is one undo step (the split reverts whole)", () => {
    const doc = newDoc();
    const { table } = buildTable(doc, 3, 3);
    doc.mergeTableCells(table, { row: 0, col: 0 }, { row: 1, col: 1 });
    const merged = doc.toJSON();
    doc.splitTableCells(table, 0, 0);
    doc.undo();
    expect(doc.toJSON()).toEqual(merged);
  });

  it("rejects a coordinate with no cell", () => {
    const doc = newDoc();
    const { table } = buildTable(doc, 2, 2);
    expectThrows(() => doc.splitTableCells(table, 5, 5), InvalidOperationError);
  });
});

describe("the merged table over the wire", () => {
  it("a merge converges on both peers", () => {
    const docA = newDoc();
    const { table, rowIds } = buildTable(docA, 3, 2);
    const docB = createDoc({ id: "tbl-merge-b", createdAt: CREATED_AT });
    docB.applyUpdate(docA.encode());
    const stateB = docB.encode();

    docA.mergeTableCells(table, { row: 0, col: 0 }, { row: 1, col: 1 });
    docB.applyUpdate(docA.encode());
    docA.applyUpdate(stateB);

    expect(docB.toJSON()).toEqual(docA.toJSON());
    const grid = resolveTableGrid(docB.raw, table);
    expect(grid?.cellAt(1, 1)?.colspan).toBe(2);
    expect(docB.getChildren(rowIds[1]!)).toHaveLength(1);
  });
});
