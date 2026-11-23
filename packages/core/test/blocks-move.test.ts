import { describe, expect, it } from "vitest";

import { InvalidChildError, InvalidOperationError, InvalidRangeError, UnknownBlockError, createDoc } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "r", createdAt: CREATED_AT });

describe("moveBlock", () => {
  it("reorders within the same parent with pre-move index semantics", () => {
    const doc = newDoc();
    const a = doc.insertBlock("paragraph");
    const b = doc.insertBlock("paragraph");
    const c = doc.insertBlock("paragraph");
    const d = doc.insertBlock("paragraph");
    // c sits at index 2, after removal index 1 lands between a and b.
    doc.moveBlock(c, "r", 1);
    expect(doc.getChildren("r")).toEqual([a, c, b, d]);
    // a sits at index 0 < 3: removal shifts the target left by one.
    doc.moveBlock(a, "r", 3);
    expect(doc.getChildren("r")).toEqual([c, b, a, d]);
    // toIndex === toLength appends at the end.
    doc.moveBlock(c, "r", 4);
    expect(doc.getChildren("r")).toEqual([b, a, d, c]);
  });

  it("reorders within the flat page sequence (the nesting is the indent attr)", () => {
    const doc = newDoc();
    const a = doc.insertBlock("list-item", { list: "bullet" });
    const b = doc.insertBlock("list-item", { list: "bullet" });
    const c = doc.insertBlock("list-item", { list: "bullet" });
    // b nested under a = b after a with indent 1 (one sequence, two attrs).
    doc.updateBlock(b, { indent: 1 });
    // c moves in front of a; a's nesting stands.
    doc.moveBlock(c, "r", 0);
    expect(doc.getChildren("r")).toEqual([c, a, b]);
    expect(doc.getChildren(a)).toEqual([]); // structurally childless
    expect((doc.getBlock(b) as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("rejects invalid moves with typed errors", () => {
    const doc = newDoc();
    const a = doc.insertBlock("paragraph");
    const li = doc.insertBlock("list-item", { list: "bullet" });
    const table = doc.insertBlock("table", { cols: 1 });
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    const cell = doc.insertBlock("table-cell", undefined, { parent: row });

    expect(() => doc.moveBlock("r", "r", 0)).toThrow(InvalidOperationError);
    expect(() => doc.moveBlock("nope", "r", 0)).toThrow(UnknownBlockError);
    expect(() => doc.moveBlock(a, "nope", 0)).toThrow(UnknownBlockError);
    expect(() => doc.moveBlock(a, table, 0)).toThrow(InvalidChildError);
    expect(() => doc.moveBlock(a, "r", 10)).toThrow(InvalidRangeError);
    expect(() => doc.moveBlock(a, "r", -1)).toThrow(InvalidRangeError);
    expect(() => doc.moveBlock(li, li, 0)).toThrow(InvalidOperationError);
    // Moving into a page-content block: it is not a container (the flat
    // page sequence is the only page context).
    const text = doc.insertBlock("paragraph");
    expect(() => doc.moveBlock(a, li, 0)).toThrow(InvalidOperationError);
    expect(() => doc.moveBlock(a, text, 0)).toThrow(InvalidOperationError);
    // The child-type restriction applies to moves, not just inserts.
    expect(() => doc.moveBlock(li, cell, 0)).toThrow(InvalidChildError);
    expect(() => doc.moveBlock(table, cell, 0)).toThrow(InvalidChildError);
  });
});

describe("removeBlock", () => {
  it("removes the block and cascades its whole subtree", () => {
    const doc = newDoc();
    const keep = doc.insertBlock("paragraph");
    const table = doc.insertBlock("table", { cols: 2 });
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    const c1 = doc.insertBlock("table-cell", undefined, { parent: row });
    const c2 = doc.insertBlock("table-cell", undefined, { parent: row });
    const inner = doc.insertBlock("paragraph", undefined, { parent: c1 });

    doc.removeBlock(table);

    for (const id of [table, row, c1, c2, inner]) expect(doc.getBlock(id)).toBeNull();
    expect(doc.getChildren("r")).toEqual([keep]);
    expect(Object.keys(doc.toJSON().blocks).sort()).toEqual([keep, "r"].sort());
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("rejects removing the root or a missing block", () => {
    const doc = newDoc();
    expect(() => doc.removeBlock("r")).toThrow(InvalidOperationError);
    expect(() => doc.removeBlock("nope")).toThrow(UnknownBlockError);
  });
});
