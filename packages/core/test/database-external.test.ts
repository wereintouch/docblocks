import { describe, expect, it } from "vitest";

import {
  ExternalDatabaseError,
  InvalidAttrsError,
  InvalidOperationError,
  UnknownBlockError,
  createDoc,
  fromJSON,
} from "../src/core";
import type { Doc } from "../src/core";
import type { DatabaseAttrs } from "../src/schema";
import { validateDoc } from "../src/schema";

/**
 * The database block's external form (the `tableId` reference):
 * the rows and the schema live in the consumer's relational database, and
 * the document keeps only the reference — the dual-shape validator (inline
 * / external mutual exclusion), the `setDatabaseTable` command (the inline
 * → external move in one transact), the row-command refusal (the typed
 * ExternalDatabaseError), and the strict guide for a raw `updateBlock`
 * `tableId` onto the inline form.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

const COLUMNS: DatabaseAttrs["columns"] = [
  { id: "name", name: "Name", type: "text" },
  { id: "count", name: "Count", type: "number" },
];

const expectThrows = (fn: () => unknown, ctor: new (message: string) => Error): Error => {
  try {
    fn();
  } catch (error) {
    if (error instanceof ctor) return error;
    throw error;
  }
  throw new Error(`Expected ${ctor.name} but nothing was thrown.`);
};

/** The strict validator on a single-block doc JSON (the block at `db`). */
const validate = (block: Record<string, unknown>): string[] => {
  const json = {
    v: 1,
    id: "r",
    title: "T",
    createdAt: CREATED_AT,
    blocks: {
      r: { type: "root", children: ["db"] },
      db: block,
    },
  };
  return validateDoc(json).map((error) => error.message);
};

describe("the external form (the tableId reference)", () => {
  it("the validator: the external form is valid with no columns / rows / rowOrder", () => {
    const errors = validate({ type: "database", attrs: { tableId: "t1" }, rows: {}, rowOrder: [] });
    expect(errors).toEqual([]);
  });

  it("the validator: the external form may omit rows / rowOrder in the JSON", () => {
    const errors = validate({ type: "database", attrs: { tableId: "t1" } });
    expect(errors).toEqual([]);
  });

  it("the validator: the external form rejects inline columns", () => {
    const errors = validate({
      type: "database",
      attrs: { tableId: "t1", columns: COLUMNS },
      rows: {},
      rowOrder: [],
    });
    expect(errors).toEqual([`The external form (the "tableId" reference) must not carry the inline "columns" schema.`]);
  });

  it("the validator: the external form rejects inline rows", () => {
    const errors = validate({
      type: "database",
      attrs: { tableId: "t1" },
      rows: { r1: { name: "first" } },
      rowOrder: ["r1"],
    });
    expect(errors).toContain(`The external form (the "tableId" reference) must not carry inline rows.`);
  });

  it("the validator: the external form rejects a non-empty rowOrder", () => {
    const errors = validate({ type: "database", attrs: { tableId: "t1" }, rows: {}, rowOrder: ["r1"] });
    expect(errors).toContain(`The external form (the "tableId" reference) must not carry inline row order.`);
  });

  it("the validator: the inline form without columns is an error", () => {
    const errors = validate({ type: "database", attrs: {}, rows: {}, rowOrder: [] });
    expect(errors).toContain(`Missing required field "columns" (the inline form); the external form sets "tableId".`);
  });

  it("the validator: an empty-string tableId is rejected (the non-empty rule)", () => {
    const errors = validate({ type: "database", attrs: { tableId: "" }, rows: {}, rowOrder: [] });
    expect(errors.some((message) => message.includes("tableId"))).toBe(true);
  });
});

describe("insertBlock and setDatabaseTable", () => {
  it("insertBlock seeds the external form directly", () => {
    const doc = createDoc({ id: "r", createdAt: CREATED_AT });
    const db = doc.insertBlock("database", { tableId: "t1" });
    const block = doc.getBlock(db);
    expect(block?.type).toBe("database");
    if (block?.type !== "database") throw new Error("unreachable");
    expect(block.attrs.tableId).toBe("t1");
    expect(block.attrs.columns).toBeUndefined();
    expect(block.rows).toEqual({});
    expect(block.rowOrder).toEqual([]);
  });

  it("insertBlock rejects the mixed form (tableId + columns)", () => {
    const doc = createDoc({ id: "r", createdAt: CREATED_AT });
    expectThrows(() => doc.insertBlock("database", { tableId: "t1", columns: COLUMNS }), InvalidAttrsError);
  });

  it("setDatabaseTable moves the inline form to the external reference in one transact", () => {
    const doc = createDoc({ id: "r", createdAt: CREATED_AT });
    const db = doc.insertBlock("database", { columns: COLUMNS });
    const r1 = doc.insertRow(db);
    doc.setCell(db, r1, "name", "first");

    doc.setDatabaseTable(db, "t1");

    const block = doc.getBlock(db);
    expect(block?.type).toBe("database");
    if (block?.type !== "database") throw new Error("unreachable");
    expect(block.attrs.tableId).toBe("t1");
    expect(block.attrs.columns).toBeUndefined();
    expect(block.rows).toEqual({});
    expect(block.rowOrder).toEqual([]);
  });

  it("setDatabaseTable is one undo step: the undo restores the inline rows and the schema", () => {
    const doc = createDoc({ id: "r", createdAt: CREATED_AT });
    const db = doc.insertBlock("database", { columns: COLUMNS });
    const r1 = doc.insertRow(db);
    doc.setCell(db, r1, "name", "first");

    doc.setDatabaseTable(db, "t1");
    doc.undo();

    const block = doc.getBlock(db);
    expect(block?.type).toBe("database");
    if (block?.type !== "database") throw new Error("unreachable");
    expect(block.attrs.tableId).toBeUndefined();
    expect(block.attrs.columns?.map((column) => column.id)).toEqual(["name", "count"]);
    expect(Object.keys(block.rows)).toEqual([r1]);
    expect(block.rows[r1]).toEqual({ name: "first" });
  });

  it("setDatabaseTable re-links an external block to another table", () => {
    const doc = createDoc({ id: "r", createdAt: CREATED_AT });
    const db = doc.insertBlock("database", { tableId: "t1" });
    doc.setDatabaseTable(db, "t2");
    const block = doc.getBlock(db);
    expect(block?.type).toBe("database");
    if (block?.type !== "database") throw new Error("unreachable");
    expect(block.attrs.tableId).toBe("t2");
  });

  it("setDatabaseTable: the typed errors (the empty reference, the unknown block)", () => {
    const doc = createDoc({ id: "r", createdAt: CREATED_AT });
    const db = doc.insertBlock("database", { columns: COLUMNS });
    expectThrows(() => doc.setDatabaseTable(db, ""), InvalidOperationError);
    expectThrows(() => doc.setDatabaseTable("nope", "t1"), UnknownBlockError);
  });

  it("the round trip: the external form survives toJSON / fromJSON", () => {
    const doc = createDoc({ id: "r", createdAt: CREATED_AT });
    const db = doc.insertBlock("database", { tableId: "t1" });
    const json = JSON.parse(JSON.stringify(doc.toJSON()));

    const other = fromJSON(json);
    const block = other.getBlock(db);
    expect(block?.type).toBe("database");
    if (block?.type !== "database") throw new Error("unreachable");
    expect(block.attrs.tableId).toBe("t1");
    expect(block.attrs.columns).toBeUndefined();
    expect(block.rows).toEqual({});
    expect(block.rowOrder).toEqual([]);
  });
});

describe("the row commands refuse the external form", () => {
  const externalDoc = (): { doc: Doc; db: string } => {
    const doc = createDoc({ id: "r", createdAt: CREATED_AT });
    const db = doc.insertBlock("database", { tableId: "t1" });
    return { doc, db };
  };

  it("insertRow refuses with the typed error", () => {
    const { doc, db } = externalDoc();
    expectThrows(() => doc.insertRow(db), ExternalDatabaseError);
  });

  it("setCell refuses with the typed error", () => {
    const { doc, db } = externalDoc();
    expectThrows(() => doc.setCell(db, "r1", "name", "first"), ExternalDatabaseError);
  });

  it("removeRow refuses with the typed error", () => {
    const { doc, db } = externalDoc();
    expectThrows(() => doc.removeRow(db, "r1"), ExternalDatabaseError);
  });

  it("moveRow refuses with the typed error", () => {
    const { doc, db } = externalDoc();
    expectThrows(() => doc.moveRow(db, "r1", 0), ExternalDatabaseError);
  });

  it("the inline → external transition: the rows stop working at the reference", () => {
    const doc = createDoc({ id: "r", createdAt: CREATED_AT });
    const db = doc.insertBlock("database", { columns: COLUMNS });
    const r1 = doc.insertRow(db);
    doc.setDatabaseTable(db, "t1");
    expectThrows(() => doc.setCell(db, r1, "name", "second"), ExternalDatabaseError);
  });
});

describe("the strict guide for a raw tableId patch", () => {
  it("updateBlock(tableId) onto the inline form is rejected (use setDatabaseTable)", () => {
    const doc = createDoc({ id: "r", createdAt: CREATED_AT });
    const db = doc.insertBlock("database", { columns: COLUMNS });
    expectThrows(() => doc.updateBlock(db, { tableId: "t1" }), InvalidAttrsError);
  });

  it("updateBlock(view attrs) stands on the external form", () => {
    const doc = createDoc({ id: "r", createdAt: CREATED_AT });
    doc.insertBlock("paragraph", {});
    const db = doc.insertBlock("database", { tableId: "t1" });
    doc.updateBlock(db, { indent: 1 });
    const block = doc.getBlock(db);
    expect(block?.type).toBe("database");
    if (block?.type !== "database") throw new Error("unreachable");
    expect(block.attrs.tableId).toBe("t1");
    expect(block.attrs.indent).toBe(1);
  });
});
