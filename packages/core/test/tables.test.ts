import { describe, expect, it } from "vitest";

import { DocBlocksError, InvalidChildError, InvalidOperationError, createDoc } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "t", createdAt: CREATED_AT });

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

describe("insertBlock table-cell", () => {
  it("rejects a cell into a full or over-full row", () => {
    const doc = newDoc();
    const table = doc.insertBlock("table", { cols: 3 });
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    for (let c = 0; c < 3; c++) doc.insertBlock("table-cell", undefined, { parent: row });
    const error = expectThrows(() => doc.insertBlock("table-cell", undefined, { parent: row }), InvalidOperationError);
    expect(error.message).toContain("3");
    expect(doc.getChildren(row)).toHaveLength(3);
  });

  it("fills a row cell by cell up to cols, then stops", () => {
    const doc = newDoc();
    const table = doc.insertBlock("table", { cols: 3 });
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    for (let c = 0; c < 3; c++) doc.insertBlock("table-cell", undefined, { parent: row });
    expect(doc.getChildren(row)).toHaveLength(3);
    expect(() => doc.insertBlock("table-cell", undefined, { parent: row })).toThrow(InvalidOperationError);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });
});

describe("moveBlock table-cell / table-row", () => {
  it("rejects moving a cell to another row or reordering it within the row (the column binding)", () => {
    const doc = newDoc();
    const table = doc.insertBlock("table", { cols: 2 });
    const rowA = doc.insertBlock("table-row", undefined, { parent: table });
    const c0 = doc.insertBlock("table-cell", undefined, { parent: rowA });
    const c1 = doc.insertBlock("table-cell", undefined, { parent: rowA });
    const rowB = doc.insertBlock("table-row", undefined, { parent: table });
    const d0 = doc.insertBlock("table-cell", undefined, { parent: rowB });
    const d1 = doc.insertBlock("table-cell", undefined, { parent: rowB });

    const error = expectThrows(() => doc.moveBlock(c0, rowB, 0), InvalidOperationError);
    expect(error.message).toContain("2");
    expect(doc.getChildren(rowA)).toEqual([c0, c1]); // source row untouched
    expect(doc.getChildren(rowB)).toEqual([d0, d1]);

    // A same-row reorder scrambles the columnOrder binding (the cell keeps
    // its column) — rejected too; the column order is moveTableColumn's job.
    expectThrows(() => doc.moveBlock(c1, rowA, 0), InvalidOperationError);
    expect(doc.getChildren(rowA)).toEqual([c0, c1]);
    // The in-place no-op stands (the position is unchanged).
    doc.moveBlock(c0, rowA, 0);
    expect(doc.getChildren(rowA)).toEqual([c0, c1]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("rejects moving a row into a table with mismatched cols; same-table reorder works", () => {
    const doc = newDoc();
    const t1 = doc.insertBlock("table", { cols: 2 });
    const r1 = doc.insertBlock("table-row", undefined, { parent: t1 });
    doc.insertBlock("table-cell", undefined, { parent: r1 });
    doc.insertBlock("table-cell", undefined, { parent: r1 });
    const t2 = doc.insertBlock("table", { cols: 3 });
    const error = expectThrows(() => doc.moveBlock(r1, t2, 0), InvalidOperationError);
    expect(error.message).toContain("2");
    expect(error.message).toContain("3");
    expect(doc.getChildren(t1)).toEqual([r1]);

    const r2 = doc.insertBlock("table-row", undefined, { parent: t1 });
    doc.insertBlock("table-cell", undefined, { parent: r2 });
    doc.insertBlock("table-cell", undefined, { parent: r2 });
    doc.moveBlock(r2, t1, 0); // complete row, matching cols
    expect(doc.getChildren(t1)).toEqual([r2, r1]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });
});

describe("moveBlock leaf text into / out of the cell's children (registry-legal)", () => {
  /** A 1x1 table with the cell's id. */
  const buildCell = (doc: Doc): string => {
    const table = doc.insertBlock("table", { cols: 1 });
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    return doc.insertBlock("table-cell", undefined, { parent: row });
  };

  it("a leaf text block moves into the cell's children and back to the page (the cell's children are leaf types)", () => {
    const doc = newDoc();
    const cell = buildCell(doc);
    const p = doc.insertBlock("paragraph");

    // Into the cell: the leaf text is registry-legal there.
    doc.moveBlock(p, cell, 0);
    expect(doc.getChildren(cell)).toEqual([p]);
    expect(validateDoc(doc.toJSON())).toEqual([]);

    // Out of the cell, back to the page: legal in both directions.
    doc.moveBlock(p, doc.meta.id, 1);
    expect(doc.getChildren(cell)).toEqual([]);
    expect(doc.getChildren(doc.meta.id)).toContain(p);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("a non-leaf type still cannot move into the cell's children (the child rule stands)", () => {
    const doc = newDoc();
    const cell = buildCell(doc);
    const table = doc.insertBlock("table", { cols: 1 });
    expectThrows(() => doc.moveBlock(table, cell, 0), InvalidChildError);
    expect(doc.getChildren(cell)).toEqual([]);
  });
});

describe("removeBlock table-cell", () => {
  it("rejects dropping a cell from a full row; allows it from an incomplete row", () => {
    const doc = newDoc();
    const table = doc.insertBlock("table", { cols: 2 });
    const fullRow = doc.insertBlock("table-row", undefined, { parent: table });
    const f1 = doc.insertBlock("table-cell", undefined, { parent: fullRow });
    doc.insertBlock("table-cell", undefined, { parent: fullRow });
    const error = expectThrows(() => doc.removeBlock(f1), InvalidOperationError);
    expect(error.message).toContain("2");
    expect(doc.getChildren(fullRow)).toHaveLength(2);

    const partRow = doc.insertBlock("table-row", undefined, { parent: table });
    const p1 = doc.insertBlock("table-cell", undefined, { parent: partRow }); // 1 of 2: incomplete
    doc.removeBlock(p1);
    expect(doc.getBlock(p1)).toBeNull();
    expect(doc.getChildren(partRow)).toEqual([]);
  });
});
