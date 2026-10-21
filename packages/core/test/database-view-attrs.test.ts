import { describe, expect, it } from "vitest";

import { InvalidAttrsError, createDoc, fromJSON } from "../src/core";
import type { Doc } from "../src/core";
import { BLOCK_REGISTRY, validateDoc } from "../src/schema";
import type { DatabaseAttrs, DatabaseBlock, DatabaseFilterPayload } from "../src/schema";

/**
 * The database block's view attributes (the external-form view state,
 * 2026-10-19): the `filter` (the recursive and/or payload), the
 * `columnOrder` / `hiddenColumns` / `views` / `viewType`. These are CRDT
 * block attrs (undo-able) — the structure of the `filter` payload is
 * checked by the validator's recursive branch (the and/or logic, the
 * condition shape, the bounded recursion depth).
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

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

const external = (attrs: Record<string, unknown>): Record<string, unknown> => ({
  type: "database",
  attrs: { tableId: "t1", ...attrs },
  rows: {},
  rowOrder: [],
});

describe("the view attrs (the external-form view state)", () => {
  it("the registry declares the view attrs (filter / columnOrder / hiddenColumns / columnWidths / views / viewType / name)", () => {
    const attrs = BLOCK_REGISTRY.database.attrs ?? {};
    expect(Object.keys(attrs).sort()).toEqual(
      [
        "columnOrder",
        "columnWidths",
        "columns",
        "filter",
        "hiddenColumns",
        "indent",
        "name",
        "tableId",
        "views",
        "viewType",
      ].sort()
    );
    expect(attrs.filter).toEqual({ kind: "object" });
    expect(attrs.viewType).toEqual({ kind: "enum", values: ["table", "kanban", "calendar"] });
    expect(attrs.columnOrder).toEqual({ kind: "array", items: { kind: "string", nonEmpty: true } });
    expect(attrs.hiddenColumns).toEqual({ kind: "array", items: { kind: "string", nonEmpty: true } });
    // The per-visible-column widths: px with the 50 floor (like the table's).
    expect(attrs.columnWidths).toEqual({ kind: "array", items: { kind: "number", min: 50 } });
    expect(attrs.views).toEqual({ kind: "array" });
    // The display name: the absent-or-empty string (the empty is the
    // "remove the override" idiom), so no nonEmpty constraint.
    expect(attrs.name).toEqual({ kind: "string" });
  });

  it("the view attrs round-trip (insertBlock + toJSON / fromJSON)", () => {
    const doc: Doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const filter: DatabaseFilterPayload = {
      logic: "and",
      conditions: [{ columnId: "count", op: "gt", value: 1 }],
      groups: [{ logic: "or", conditions: [{ columnId: "status", op: "eq", value: "done" }] }],
    };
    const db = doc.insertBlock("database", {
      tableId: "t1",
      filter,
      columnOrder: ["b", "a"],
      hiddenColumns: ["c"],
      views: [{ id: "v1", name: "Mine" }],
      viewType: "kanban",
    });

    const block = doc.getBlock(db)! as DatabaseBlock;
    expect(block.attrs.tableId).toBe("t1");
    expect(block.attrs.viewType).toBe("kanban");
    expect(block.attrs.hiddenColumns).toEqual(["c"]);

    const json = JSON.parse(JSON.stringify(doc.toJSON()));
    const other = fromJSON(json);
    const restored = other.getBlock(db)! as DatabaseBlock;
    expect(restored.attrs.viewType).toBe("kanban");
    expect(restored.attrs.columnOrder).toEqual(["b", "a"]);
    expect(restored.attrs.hiddenColumns).toEqual(["c"]);
    expect(restored.attrs.views).toEqual([{ id: "v1", name: "Mine" }]);
    expect(restored.attrs.filter).toEqual(filter);
  });

  it("the name attr round-trips (the override and the empty-string removal idiom)", () => {
    const doc: Doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const db = doc.insertBlock("database", { tableId: "t1", name: "Tasks" });
    expect((doc.getBlock(db)! as DatabaseBlock).attrs.name).toBe("Tasks");
    // The empty string stands (it is the "remove the override" write;
    // updateBlock never removes attrs).
    doc.updateBlock(db, { name: "" });
    expect((doc.getBlock(db)! as DatabaseBlock).attrs.name).toBe("");

    const json = JSON.parse(JSON.stringify(doc.toJSON()));
    const restored = (fromJSON(json).getBlock(db)! as DatabaseBlock).attrs;
    expect(restored.name).toBe("");

    // A non-string name is rejected by the validator.
    const errors = validate(external({ name: 42 }));
    expect(errors.some((error) => error.includes("name"))).toBe(true);
  });

  it("an unknown viewType is rejected (the v1 enum)", () => {
    const errors = validate(external({ viewType: "gantt" }));
    expect(errors.some((error) => error.includes("viewType"))).toBe(true);
  });

  it("a non-array columnOrder / hiddenColumns is rejected", () => {
    expect(validate(external({ columnOrder: "a" }))).not.toEqual([]);
    expect(validate(external({ hiddenColumns: { a: 1 } }))).not.toEqual([]);
  });

  it("the columnWidths attr round-trips (the updateBlock patch; the 50 px floor stands)", () => {
    const doc: Doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const db = doc.insertBlock("database", { tableId: "t1" });

    doc.updateBlock(db, { columnWidths: [160, 90] });
    expect((doc.getBlock(db)! as DatabaseBlock).attrs.columnWidths).toEqual([160, 90]);

    // One undo step reverts the widths (the view state is the doc's data).
    doc.undo();
    expect((doc.getBlock(db)! as DatabaseBlock).attrs.columnWidths).toBeUndefined();

    // The JSON round-trip keeps the widths.
    doc.updateBlock(db, { columnWidths: [160, 90] });
    const json = JSON.parse(JSON.stringify(doc.toJSON()));
    const restored = (fromJSON(json).getBlock(db)! as DatabaseBlock).attrs;
    expect(restored.columnWidths).toEqual([160, 90]);

    // Below the 50 px floor (or a non-number) the validator rejects the patch.
    expect(() => doc.updateBlock(db, { columnWidths: [40] })).toThrow();
    expect(() => doc.updateBlock(db, { columnWidths: ["wide"] as unknown as number[] })).toThrow();
  });
});

describe("the filter payload (the recursive and/or)", () => {
  it("a nested and/or payload is valid", () => {
    const filter: DatabaseFilterPayload = {
      logic: "and",
      conditions: [{ columnId: "a", op: "eq", value: 1 }],
      groups: [
        {
          logic: "or",
          conditions: [],
          groups: [{ logic: "and", conditions: [{ columnId: "b", op: "not-empty" }] }],
        },
      ],
    };
    expect(validate(external({ filter }))).toEqual([]);
  });

  it("a missing groups (or null) is valid", () => {
    expect(validate(external({ filter: { logic: "or", conditions: [{ columnId: "a", op: "eq" }] } }))).toEqual([]);
    expect(validate(external({ filter: { logic: "and", conditions: [], groups: null } }))).toEqual([]);
  });

  it("rejects a non-object filter", () => {
    const errors = validate(external({ filter: [1, 2, 3] }));
    expect(errors.some((error) => error.includes("The filter must be a plain object"))).toBe(true);
  });

  it("rejects a bad logic", () => {
    const errors = validate(external({ filter: { logic: "xor", conditions: [] } }));
    expect(errors.some((error) => error.includes('must be "and" or "or"'))).toBe(true);
  });

  it("rejects a non-array conditions", () => {
    const errors = validate(external({ filter: { logic: "and", conditions: "nope" } }));
    expect(errors.some((error) => error.includes("conditions must be an array"))).toBe(true);
  });

  it("rejects a condition missing the columnId or the op", () => {
    expect(validate(external({ filter: { logic: "and", conditions: [{ op: "eq" }] } }))).not.toEqual([]);
    expect(validate(external({ filter: { logic: "and", conditions: [{ columnId: "a" }] } }))).not.toEqual([]);
    // An empty columnId / op is rejected (nonEmpty).
    expect(validate(external({ filter: { logic: "and", conditions: [{ columnId: "", op: "eq" }] } }))).not.toEqual([]);
  });

  it("rejects a non-array / non-null groups", () => {
    const errors = validate(external({ filter: { logic: "and", conditions: [], groups: 5 } }));
    expect(errors.some((error) => error.includes("groups must be an array or null"))).toBe(true);
  });

  it("bounds the recursion depth (a too-deep group is rejected)", () => {
    // Build a chain deeper than the cap (MAX_DATABASE_FILTER_DEPTH = 8).
    let payload: DatabaseFilterPayload = { logic: "and", conditions: [{ columnId: "a", op: "eq" }] };
    for (let i = 0; i < 12; i += 1) {
      payload = { logic: "or", conditions: [], groups: [payload] };
    }
    const errors = validate(external({ filter: payload }));
    expect(errors.some((error) => error.includes("maximum recursion depth"))).toBe(true);
  });

  it("the invalid filter is rejected on insert (the strict attrs guard)", () => {
    const doc: Doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    expectThrows(
      () =>
        doc.insertBlock("database", {
          tableId: "t1",
          filter: { logic: "bad", conditions: [] },
        } as unknown as DatabaseAttrs),
      InvalidAttrsError
    );
  });

  it("the invalid filter is rejected on updateBlock (the command-level attrs guard)", () => {
    const doc: Doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const id = doc.insertBlock("database", { tableId: "t1" });
    // The filter-only patch stands the recursive check too (the columns /
    // tableId patch guard alone would let it through).
    const err = expectThrows(
      () => doc.updateBlock(id, { filter: { logic: "xor", conditions: [] } } as unknown as DatabaseAttrs),
      InvalidAttrsError
    );
    expect(err.message).toContain('must be "and" or "or"');
    // The doc stands (the pre-patch attrs are untouched).
    expect((doc.getBlock(id) as DatabaseBlock).attrs?.filter).toBeUndefined();
    // A valid filter patch stands (the guard is not over-strict).
    doc.updateBlock(id, { filter: { logic: "and", conditions: [{ columnId: "a", op: "eq", value: 1 }] } });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });
});
