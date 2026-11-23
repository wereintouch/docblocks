import { describe, expect, it } from "vitest";

import { createDoc, fromJSON, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

describe("concurrent database row moves keep a single row position", () => {
  const seedRows = (id: string): { a: Doc; database: string; row: string } => {
    const a = createDoc({ id });
    const database = a.insertBlock("database", {
      columns: [{ id: "value", name: "Value", type: "text" }],
    });
    const row = a.insertRow(database);
    a.insertRow(database);
    a.insertRow(database);
    return { a, database, row };
  };
  const fork = (d: Doc): Doc => loadDoc(d.encode());
  const exchange = (a: Doc, b: Doc): void => {
    const aBytes = a.encode();
    const bBytes = b.encode();
    a.applyUpdate(bBytes);
    b.applyUpdate(aBytes);
  };
  const rowOrderOf = (json: DocJSON, databaseId: string): string[] => {
    const block = json.blocks[databaseId]! as { rowOrder?: string[] };
    return block.rowOrder ?? [];
  };
  /** The read order is well-formed: every rowId exactly once, all rows
   * present, and the JSON loads (the strict validator is clean). */
  const expectSingleOrder = (json: DocJSON, databaseId: string, rowCount: number): void => {
    const order = rowOrderOf(json, databaseId);
    expect(order).toHaveLength(rowCount);
    expect(new Set(order).size).toBe(rowCount);
    expect(validateDoc(json)).toEqual([]);
    expect(() => fromJSON(json)).not.toThrow();
  };

  it("two concurrent row moves converge on a single position on both peers", () => {
    const { a, database, row } = seedRows("database-move");
    const b = fork(a);
    a.moveRow(database, row, 3);
    b.moveRow(database, row, 2);
    exchange(a, b);
    const json = a.toJSON();
    expectSingleOrder(json, database, 3);
    expect(rowOrderOf(json, database).includes(row)).toBe(true);
    // The raw Y.Array may keep both re-inserts; the read deduplicates on
    // the deterministic CRDT order, so both peers see the same single
    // position (the JSONs are byte-equal). The binary snapshot of the
    // raw (duplicated) state reloads too — the read path normalizes it.
    expect(() => loadDoc(a.encode())).not.toThrow();
    expect(JSON.stringify(a.toJSON())).toBe(JSON.stringify(b.toJSON()));
  });

  it("removeRow works after a concurrent move", () => {
    const { a, database, row } = seedRows("database-remove");
    const b = fork(a);
    a.moveRow(database, row, 3);
    b.moveRow(database, row, 2);
    exchange(a, b);
    a.removeRow(database, row);
    exchange(a, b);
    const json = a.toJSON();
    expectSingleOrder(json, database, 2);
    expect(rowOrderOf(json, database)).not.toContain(row);
    expect(JSON.stringify(a.toJSON())).toBe(JSON.stringify(b.toJSON()));
  });

  it("undo of a move works after a concurrent move", () => {
    const { a, database, row } = seedRows("database-undo");
    const b = fork(a);
    a.moveRow(database, row, 3);
    b.moveRow(database, row, 2);
    exchange(a, b);
    a.undo();
    const json = a.toJSON();
    expectSingleOrder(json, database, 3);
    expect(() => loadDoc(a.encode())).not.toThrow();
  });

  it("a concurrent move and remove keep the grid valid (dangling residue)", () => {
    const { a, database, row } = seedRows("database-remove-race");
    const b = fork(a);
    a.moveRow(database, row, 2);
    b.removeRow(database, row);
    exchange(a, b);
    const json = a.toJSON();
    expectSingleOrder(json, database, 2);
    expect(rowOrderOf(json, database)).not.toContain(row);
  });
});
