import { describe, expect, it } from "vitest";

import {
  InvalidCellValueError,
  InvalidOperationError,
  InvalidRangeError,
  UnknownBlockError,
  UnknownColumnError,
  UnknownRowError,
  createDoc,
  fromJSON,
} from "../src/core";
import type { Doc } from "../src/core";
import type { DatabaseAttrs } from "../src/schema";
import { validateDoc } from "../src/schema";

/**
 * The database block: rows as data (the cell map + the row order) and the
 * row commands — insertRow, setCell, removeRow, moveRow (validate-first,
 * typed errors, the pre-move index semantics). The validation boundary
 * (the strict branch, the lenient reader, the reactivity) is
 * database-validation.test.ts.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

const COLUMNS: DatabaseAttrs["columns"] = [
  { id: "name", name: "Name", type: "text" },
  { id: "count", name: "Count", type: "number" },
  { id: "done", name: "Done", type: "checkbox" },
  { id: "status", name: "Status", type: "select", options: ["active", "done"] },
  { id: "tags", name: "Tags", type: "multi-select", options: ["a", "b"] },
  { id: "day", name: "Day", type: "date" },
];

/** A fresh doc with one database block (the seed columns), ids r0, r1, ... */
const withDatabase = (): { doc: Doc; db: string } => {
  const doc = createDoc({ id: "r", createdAt: CREATED_AT });
  const db = doc.insertBlock("database", { columns: COLUMNS });
  return { doc, db };
};

/** Seeds two rows with values across the column types; returns the row ids. */
const seedRows = (doc: Doc, db: string): [string, string] => {
  const r1 = doc.insertRow(db);
  const r2 = doc.insertRow(db);
  doc.setCell(db, r1, "name", "first");
  doc.setCell(db, r1, "done", false);
  doc.setCell(db, r1, "status", "active");
  doc.setCell(db, r1, "tags", ["a", "b"]);
  doc.setCell(db, r1, "count", 1.5);
  doc.setCell(db, r1, "day", "2026-01-01");
  doc.setCell(db, r2, "name", "second");
  doc.setCell(db, r2, "count", 3);
  return [r1, r2];
};

const expectThrows = (fn: () => unknown, ctor: new (message: string) => Error): Error => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ctor);
    return error as Error;
  }
  throw new Error("expected the command to throw");
};

describe("insertRow / setCell", () => {
  it("appends empty rows and sets values of every column type", () => {
    const { doc, db } = withDatabase();
    const [r1, r2] = seedRows(doc, db);

    expect(doc.getBlock(db)).toEqual({
      type: "database",
      attrs: { columns: COLUMNS },
      rows: {
        [r1]: { name: "first", done: false, status: "active", tags: ["a", "b"], count: 1.5, day: "2026-01-01" },
        [r2]: { name: "second", count: 3 },
      },
      rowOrder: [r1, r2],
    });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("generates row ids via the doc's id generator", () => {
    let n = 0;
    const doc = createDoc({ id: "d", createdAt: CREATED_AT, generateId: () => `x${n++}` });
    const db = doc.insertBlock("database", { columns: COLUMNS });
    expect(doc.insertRow(db)).toBe("x1"); // x0 is the block id
  });

  it("setCell with undefined removes the cell; the row stays", () => {
    const { doc, db } = withDatabase();
    const [r1, r2] = seedRows(doc, db);
    doc.setCell(db, r1, "name", undefined);
    expect(doc.getBlock(db)).toMatchObject({
      rows: { [r1]: {}, [r2]: { name: "second", count: 3 } },
      rowOrder: [r1, r2],
    });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("a repeated set of the current value is a no-op (no update bytes)", () => {
    const { doc, db } = withDatabase();
    const [r1, r2] = seedRows(doc, db);
    const before = doc.encode().byteLength;
    doc.setCell(db, r1, "name", "first"); // the same string
    doc.setCell(db, r1, "tags", ["a", "b"]); // the same array (a fresh Y.Array would churn)
    doc.setCell(db, r2, "day", undefined); // already unset (twice)
    doc.setCell(db, r2, "day", undefined);
    expect(doc.encode().byteLength).toBe(before);
  });

  it("rejects wrong-typed values with InvalidCellValueError (the doc is untouched)", () => {
    const { doc, db } = withDatabase();
    const r1 = seedRows(doc, db)[0]!;
    const before = doc.toJSON();
    const cases: Array<[string, unknown]> = [
      ["name", ""], // text: must be non-empty
      ["name", 42],
      ["day", ""], // date: a plain non-empty string in v1
      ["count", Number.NaN], // number: must be finite
      ["count", Number.POSITIVE_INFINITY],
      ["count", "3"],
      ["done", "yes"], // checkbox: must be a boolean
      ["status", "archived"], // select: must be one of the options
      ["status", ["active"]],
      ["tags", "a"], // multi-select: must be an array
      ["tags", ["a", "c"]], // a multi-select element outside the options
      ["tags", ["a", 1]],
    ];
    for (const [colId, value] of cases) {
      const error = expectThrows(() => doc.setCell(db, r1, colId, value as never), InvalidCellValueError);
      expect(error.message).toContain(colId);
    }
    expect(doc.toJSON()).toEqual(before); // every throw left the doc untouched
  });

  it("rejects unknown rows / columns / non-database blocks with typed errors", () => {
    const { doc, db } = withDatabase();
    const r1 = seedRows(doc, db)[0]!;
    const p = doc.insertBlock("paragraph");

    const missingRow = expectThrows(() => doc.setCell(db, "nope", "name", "x"), UnknownRowError);
    expect(missingRow.message).toContain("nope");
    const missingColumn = expectThrows(() => doc.setCell(db, r1, "nope", "x"), UnknownColumnError);
    expect(missingColumn.message).toContain("nope");
    expectThrows(() => doc.setCell(p, r1, "name", "x"), InvalidOperationError);
    expectThrows(() => doc.setCell("nope", r1, "name", "x"), UnknownBlockError);
  });
});

describe("removeRow / moveRow", () => {
  it("removes the row and its rowOrder entry", () => {
    const { doc, db } = withDatabase();
    const [r1, r2] = seedRows(doc, db);
    doc.removeRow(db, r1);
    expect(doc.getBlock(db)).toMatchObject({ rows: { [r2]: { name: "second", count: 3 } }, rowOrder: [r2] });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("moves a row with pre-move index semantics, like moveBlock", () => {
    const { doc, db } = withDatabase();
    const a = doc.insertRow(db);
    const b = doc.insertRow(db);
    const c = doc.insertRow(db);
    doc.moveRow(db, c, 1); // c at 2, after removal index 1 lands between a and b
    expect(doc.getBlock(db)).toMatchObject({ rowOrder: [a, c, b] });
    doc.moveRow(db, a, 3); // a at 0 < 3: removal shifts the target left by one
    expect(doc.getBlock(db)).toMatchObject({ rowOrder: [c, b, a] });
    doc.moveRow(db, c, 3); // toIndex === toLength appends at the end
    expect(doc.getBlock(db)).toMatchObject({ rowOrder: [b, a, c] });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("rejects invalid rows / indexes with typed errors", () => {
    const { doc, db } = withDatabase();
    const r1 = doc.insertRow(db);
    expectThrows(() => doc.removeRow(db, "nope"), UnknownRowError);
    expectThrows(() => doc.moveRow(db, "nope", 0), UnknownRowError);
    expectThrows(() => doc.moveRow(db, r1, 2), InvalidRangeError);
    expectThrows(() => doc.moveRow(db, r1, -1), InvalidRangeError);
  });
});

describe("layout and reads", () => {
  it("round-trips rows + rowOrder: toJSON -> fromJSON -> toJSON is identical", () => {
    const { doc, db } = withDatabase();
    seedRows(doc, db);
    const before = doc.toJSON();
    const restored = fromJSON(before);
    expect(restored.toJSON()).toEqual(before);
    expect(restored.getBlock(db)).toEqual(before.blocks[db]);
  });

  it("rows are data, not blocks: no children, and removeBlock drops the whole block", () => {
    const { doc, db } = withDatabase();
    seedRows(doc, db);
    expect(doc.getChildren(db)).toEqual([]);
    const table = doc.insertBlock("table", { cols: 1 });
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    const cell = doc.insertBlock("table-cell", undefined, { parent: row });
    const nested = doc.insertBlock("database", { columns: COLUMNS }, { parent: cell }); // a leaf type
    expect(validateDoc(doc.toJSON())).toEqual([]);
    doc.removeBlock(nested);
    expect(doc.getBlock(nested)).toBeNull();
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("reads stay plain snapshots (the structural plainness contract)", () => {
    const { doc, db } = withDatabase();
    seedRows(doc, db);
    const block = doc.getBlock(db);
    if (block === null || block.type !== "database") throw new Error("expected the database block");
    expect(JSON.parse(JSON.stringify(block))).toEqual(block);
    expect(JSON.parse(JSON.stringify(doc.toJSON()))).toEqual(doc.toJSON());
    // The snapshot is a fresh plain copy: mutating it does nothing.
    (block.rows as Record<string, unknown>)["mutated"] = { bogus: true };
    expect(doc.getBlock(db)).not.toHaveProperty("rows.mutated");
  });
});

describe("determinism", () => {
  it("same commands + injected ids -> equal toJSON", () => {
    const make = (): Doc => {
      let n = 0;
      return createDoc({ id: "d", createdAt: CREATED_AT, generateId: () => `b${n++}` });
    };
    const run = (doc: Doc): void => {
      const db = doc.insertBlock("database", { columns: COLUMNS });
      const r1 = doc.insertRow(db);
      const r2 = doc.insertRow(db);
      doc.setCell(db, r1, "name", "first");
      doc.setCell(db, r1, "tags", ["a"]);
      doc.setCell(db, r2, "count", 7);
      doc.moveRow(db, r1, 1);
      doc.removeRow(db, r2);
    };
    const first = make();
    const second = make();
    run(first);
    run(second);
    expect(first.toJSON()).toEqual(second.toJSON());
  });
});

describe("caller-state isolation (no aliasing into the CRDT)", () => {
  it("a caller-retained multi-select array mutated after setCell leaves the doc unchanged", () => {
    const { doc, db } = withDatabase();
    const row = doc.insertRow(db);
    const caller = ["a"];
    doc.setCell(db, row, "tags", caller);

    caller.push("b");
    const block = doc.getBlock(db);
    if (block === null || block.type !== "database") throw new Error("unreachable: the block must be a database");
    expect(block.rows[row]).toEqual({ tags: ["a"] });
  });

  it("a caller-retained columns array mutated after insertBlock leaves the doc unchanged", () => {
    const doc = createDoc({ id: "c", createdAt: CREATED_AT });
    const column = { id: "name", name: "Name", type: "text" as const };
    const db = doc.insertBlock("database", { columns: [column] });

    // The caller retains the column object (and the array it lives in).
    column.name = "MUTATED";
    const block = doc.getBlock(db);
    if (block === null || block.type !== "database") throw new Error("unreachable: the block must be a database");
    const columns = block.attrs.columns;
    if (columns === undefined) throw new Error("unreachable: the block must carry its columns");
    expect(columns).toHaveLength(1);
    expect(columns[0]?.name).toBe("Name");
  });
});
