// The structural guards over the merged regions: a column / row move or
// insert that would cut a region is rejected; a removal inside a span
// shrinks it; a removal the region's own cell stands on is rejected.
import { describe, expect, it } from "vitest";

import { InvalidOperationError, createDoc } from "../src/core";
import type { Doc } from "../src/core";

const CREATED_AT = "2026-11-25T00:00:00.000Z";

/** A 4x3 table with the row 0's cells 1..2 merged. */
function tableWithRegion(): { doc: Doc; tableId: string; rowIds: string[] } {
  const doc = createDoc({ id: "tbl-guards", createdAt: CREATED_AT });
  const tableId = doc.insertBlock("table", { cols: 4 });
  const rowIds: string[] = [];
  for (let row = 0; row < 3; row += 1) {
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    rowIds.push(rowId);
    for (let col = 0; col < 4; col += 1) doc.insertBlock("table-cell", undefined, { parent: rowId });
  }
  doc.mergeTableCells(tableId, { row: 0, col: 1 }, { row: 0, col: 2 });
  return { doc, tableId, rowIds };
}

const expectThrows = (fn: () => unknown, needle: string): void => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidOperationError);
    expect((error as Error).message).toContain(needle);
    return;
  }
  throw new Error("expected the command to throw");
};

/** The column index of every kept cell in the row (the binding read). */
function columnsOf(doc: Doc, tableId: string, rowId: string): number[] {
  const order = doc.getBlock(tableId);
  if (order === null || order.type !== "table") throw new Error("not a table");
  return doc.getChildren(rowId).map((cellId) => {
    const cell = doc.getBlock(cellId);
    const columnId = cell !== null && cell.type === "table-cell" ? cell.attrs?.columnId : undefined;
    return columnId === undefined ? -1 : order.columnOrder.indexOf(columnId);
  });
}

describe("the column guards over a region", () => {
  it("rejects a move through a region (the region locks its columns)", () => {
    const { doc, tableId } = tableWithRegion();
    const before = doc.toJSON();
    // Column 0 -> past the region (the band crosses it) and column 3 -> into it.
    expectThrows(() => doc.moveTableColumn(tableId, 0, 3), "crosses a merged region");
    expectThrows(() => doc.moveTableColumn(tableId, 3, 1), "crosses a merged region");
    expect(doc.toJSON()).toEqual(before);
  });

  it("allows a move free of the region", () => {
    const { doc, tableId, rowIds } = tableWithRegion();
    // The region covers the columns 1..2: a band touching them is rejected
    // (2..3 ends on the region's edge), an appended free column stands.
    expectThrows(() => doc.moveTableColumn(tableId, 2, 3), "crosses a merged region");
    doc.moveTableColumn(tableId, 3, 4);
    expect(columnsOf(doc, tableId, rowIds[1]!)).toEqual([0, 1, 2, 3]);
  });

  it("rejects an insert strictly inside the region's span, accepts its edges", () => {
    const { doc, tableId, rowIds } = tableWithRegion();
    expectThrows(() => doc.insertTableColumn(tableId, 2), "inside a merged region");
    doc.insertTableColumn(tableId, 1);
    expect(columnsOf(doc, tableId, rowIds[1]!)).toHaveLength(5);
  });

  it("shrinks the span over a removal inside it and rejects the region's own column", () => {
    const { doc, tableId, rowIds } = tableWithRegion();
    expectThrows(() => doc.removeTableColumn(tableId, 1), "carries a merged region's cell");
    doc.removeTableColumn(tableId, 2);
    const anchorRow = doc.getChildren(rowIds[0]!);
    const anchor = doc.getBlock(anchorRow[0]!);
    // The span shrinks to a single column (the key stands absent at 1).
    expect(anchor?.type === "table-cell" ? anchor.attrs?.colspan : "missing").toBeUndefined();
  });

  it("rejects a duplicate that cuts the region", () => {
    const { doc, tableId } = tableWithRegion();
    expectThrows(() => doc.duplicateTableColumn(tableId, 1), "cuts a merged region");
  });
});

describe("the row guards over a region", () => {
  it("rejects a row move through a rowspan region; a removal inside it shrinks the span", () => {
    const doc = createDoc({ id: "tbl-guards-rows", createdAt: CREATED_AT });
    const tableId = doc.insertBlock("table", { cols: 2 });
    const rowIds: string[] = [];
    for (let row = 0; row < 4; row += 1) {
      const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
      rowIds.push(rowId);
      for (let col = 0; col < 2; col += 1) doc.insertBlock("table-cell", undefined, { parent: rowId });
    }
    doc.mergeTableCells(tableId, { row: 1, col: 0 }, { row: 2, col: 0 });

    expectThrows(() => doc.moveTableRow(tableId, rowIds[0]!, 3), "crosses a merged region");
    expectThrows(() => doc.insertTableRow(tableId, 2), "inside a merged region");
    expectThrows(() => doc.removeTableRow(tableId, rowIds[1]!), "carries a merged region's cell");

    // The row 2 stands inside the span: the removal shrinks it.
    doc.removeTableRow(tableId, rowIds[2]!);
    const anchor = doc.getBlock(doc.getChildren(rowIds[1]!)[0]!);
    expect(anchor?.type === "table-cell" ? anchor.attrs?.rowspan : "missing").toBeUndefined();
  });
});
