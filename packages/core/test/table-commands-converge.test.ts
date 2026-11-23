import { describe, expect, it } from "vitest";

import { createDoc } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";

const CREATED_AT = "2026-01-01T00:00:00Z";

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
