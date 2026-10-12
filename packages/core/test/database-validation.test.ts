import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { InvalidAttrsError, createDoc, loadDoc } from "../src/core";
import type { Change, Doc } from "../src/core";
import type { DatabaseAttrs } from "../src/schema";
import { validateDoc } from "../src/schema";

/**
 * The database block's strict/lenient validation boundary: the updateBlock
 * columns patch (the post-patch invariants), the nested-field reactivity,
 * the strict validator branch, and the lenient reader (newer-minor data).
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

/** A fresh doc with one database block (the seed columns). */
const withDatabase = (): { doc: Doc; db: string } => {
  const doc = createDoc({ id: "r", createdAt: CREATED_AT });
  const db = doc.insertBlock("database", { columns: COLUMNS });
  return { doc, db };
};

/** Seeds two rows with values across the column types; returns the row ids. */
const seedRows = (doc: Doc, db: string): string[] => {
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

describe("updateBlock: the columns patch", () => {
  it("replaces the columns array when the strict invariants stay held", () => {
    const { doc, db } = withDatabase();
    const r1 = doc.insertRow(db);
    doc.setCell(db, r1, "name", "first");
    // Dropping only the columns no row references: the post-patch block
    // stays valid, the write goes through.
    const columns = COLUMNS.slice(0, 3); // name, count, done
    doc.updateBlock(db, { columns });
    expect(doc.getBlock(db)).toMatchObject({ attrs: { columns }, rows: { [r1]: { name: "first" } } });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("a post-patch state that breaks the invariants -> InvalidAttrsError", () => {
    const { doc, db } = withDatabase();
    const r1 = seedRows(doc, db)[0]!;
    doc.setCell(db, r1, "name", "first");
    // Dropping the column that the existing row references...
    expect(() => doc.updateBlock(db, { columns: [{ id: "count", name: "Count", type: "number" }] })).toThrow(
      InvalidAttrsError
    );
    // ...and a select column without options (the type-dependent rule).
    expect(() => doc.updateBlock(db, { columns: [{ id: "status", name: "Status", type: "select" }] })).toThrow(
      InvalidAttrsError
    );
    expect(validateDoc(doc.toJSON())).toEqual([]); // the failed patches left the doc valid
  });
});

describe("reactivity (the nested fields)", () => {
  it("every row command fires onChange with the database id; onBlock follows", () => {
    const { doc, db } = withDatabase();
    const changes: Change[] = [];
    const blocks: unknown[] = [];
    const offChange = doc.onChange((change) => changes.push(change));
    const offBlock = doc.onBlock(db, (block) => blocks.push(block));

    const r1 = doc.insertRow(db);
    doc.setCell(db, r1, "name", "first");
    doc.moveRow(db, r1, 0); // moving to the own index still writes (delete + reinsert)
    doc.removeRow(db, r1);

    offChange();
    offBlock();
    expect(changes).toHaveLength(4);
    for (const change of changes) expect(change.blockIds).toEqual([db]);
    expect(blocks).toHaveLength(4); // the block itself survives the row removal
    expect(blocks[0]).toMatchObject({ rowOrder: [r1] });
    expect(blocks[1]).toMatchObject({ rows: { [r1]: { name: "first" } } });
    expect(blocks[2]).toMatchObject({ rows: { [r1]: { name: "first" } }, rowOrder: [r1] });
    expect(blocks[3]).toMatchObject({ rows: {}, rowOrder: [] });
  });

  it("a remote cell set fires onChange with the database id", () => {
    const { doc: base, db } = withDatabase();
    const r1 = base.insertRow(db);
    // The loadDoc twins share the base's client clocks (the house
    // reactivity pattern), so the delta is the cell set only.
    const state = base.encode();
    const doc = loadDoc(state);
    const peer = loadDoc(state);
    const changes: Change[] = [];
    const off = doc.onChange((change) => changes.push(change));
    peer.setCell(db, r1, "name", "remote");
    doc.applyUpdate(peer.encodeUpdate(Y.encodeStateVector(doc.raw)));
    off();
    expect(changes).toEqual([{ blockIds: [db], metaChanged: false }]);
    expect(doc.getBlock(db)).toMatchObject({ rows: { [r1]: { name: "remote" } } });
  });
});

describe("strict validator (validateDoc)", () => {
  const databaseDoc = (block: Record<string, unknown>): unknown => ({
    v: 1,
    id: "d1",
    title: "",
    createdAt: CREATED_AT,
    blocks: {
      d1: { type: "root", children: ["db1"] },
      db1: { type: "database", attrs: { columns: COLUMNS }, ...block },
    },
  });

  it("flags cell values that break the column type contract", () => {
    const errors = validateDoc(
      databaseDoc({
        rows: {
          r1: { name: "", status: "nope", count: Number.NaN, tags: ["x"], day: 42, unknown: "v" },
        },
        rowOrder: ["r1"],
      })
    );
    for (const path of [
      "blocks.db1.rows.r1.name",
      "blocks.db1.rows.r1.status",
      "blocks.db1.rows.r1.count",
      "blocks.db1.rows.r1.tags",
      "blocks.db1.rows.r1.day",
      "blocks.db1.rows.r1.unknown",
    ]) {
      expect(errors.some((entry) => entry.path === path)).toBe(true);
    }
  });

  it("flags rowOrder/rows set mismatches: missing, extra, duplicated rows", () => {
    const missing = validateDoc(databaseDoc({ rows: { r1: {}, r2: {} }, rowOrder: ["r1"] }));
    expect(missing.some((e) => e.path === "blocks.db1.rowOrder" && e.message.includes("r2"))).toBe(true);
    const extra = validateDoc(databaseDoc({ rows: { r1: {} }, rowOrder: ["r1", "r2"] }));
    expect(extra.some((e) => e.path === "blocks.db1.rowOrder" && e.message.includes("r2"))).toBe(true);
    const duplicated = validateDoc(databaseDoc({ rows: { r1: {} }, rowOrder: ["r1", "r1"] }));
    expect(duplicated.some((e) => e.path === "blocks.db1.rowOrder" && e.message.includes("more than once"))).toBe(true);
    const notAnArray = validateDoc(databaseDoc({ rows: {}, rowOrder: "r1" }));
    expect(notAnArray.some((e) => e.path === "blocks.db1.rowOrder")).toBe(true);
    const missingRows = validateDoc(databaseDoc({ rowOrder: [] }));
    expect(missingRows.some((e) => e.path === "blocks.db1.rows")).toBe(true);
  });

  it("flags the options rules and duplicate column ids", () => {
    const selectWithoutOptions = validateDoc(
      databaseDoc({
        attrs: { columns: [{ id: "s", name: "S", type: "select" }] },
        rows: {},
        rowOrder: [],
      })
    );
    expect(selectWithoutOptions.some((e) => e.message.includes("requires a non-empty options"))).toBe(true);
    const optionsOnText = validateDoc(
      databaseDoc({
        attrs: { columns: [{ id: "t", name: "T", type: "text", options: ["x"] }] },
        rows: {},
        rowOrder: [],
      })
    );
    expect(optionsOnText.some((e) => e.message.includes("must not carry options"))).toBe(true);
    const duplicateIds = validateDoc(
      databaseDoc({
        attrs: {
          columns: [
            { id: "c", name: "A", type: "text" },
            { id: "c", name: "B", type: "text" },
          ],
        },
        rows: {},
        rowOrder: [],
      })
    );
    expect(duplicateIds.some((e) => e.message.includes("Duplicate column id"))).toBe(true);
  });

  it("flags rows / rowOrder on non-database types", () => {
    const withRows = {
      v: 1,
      id: "d1",
      title: "",
      createdAt: CREATED_AT,
      blocks: { d1: { type: "root", children: ["p1"] }, p1: { type: "paragraph", rows: {}, rowOrder: [] } },
    };
    const errors = validateDoc(withRows);
    expect(errors.some((e) => e.path === "blocks.p1.rows")).toBe(true);
    expect(errors.some((e) => e.path === "blocks.p1.rowOrder")).toBe(true);
  });

  it("accepts a well-formed database", () => {
    expect(validateDoc(databaseDoc({ rows: { r1: { name: "first", tags: [] } }, rowOrder: ["r1"] }))).toEqual([]);
  });
});

describe("lenient reader (newer-minor data)", () => {
  it("reads an unknown column type and an odd cell as-is; the validator flags them", () => {
    const { doc, db } = withDatabase();
    const r1 = doc.insertRow(db);
    doc.setCell(db, r1, "name", "first");
    // A column type this core's registry does not know, and a cell of a
    // shape this core does not know, written at the CRDT level: the way
    // newer-minor data arrives (over the wire, not via the commands). The
    // column element is a plain immutable value (Yjs arrays carry no
    // nested Y types), so the newer column replaces the element in place.
    doc.raw.transact(() => {
      const block = doc.raw.getMap("blocks").get(db) as Y.Map<unknown>;
      const columns = (block.get("attrs") as Y.Map<unknown>).get("columns") as Y.Array<unknown>;
      columns.delete(0, columns.length);
      columns.insert(0, [{ id: "name", name: "Name", type: "rich-text" }]);
      const row = (block.get("rows") as Y.Map<unknown>).get(r1) as Y.Map<unknown>;
      row.set("name", { runs: [{ text: "rich", marks: {} }] });
    });

    const target = createDoc({ id: "r", createdAt: CREATED_AT });
    target.applyUpdate(doc.encode()); // the CRDT level applies remote data without validation

    expect(target.getBlock(db)).toEqual({
      type: "database",
      attrs: { columns: [{ id: "name", name: "Name", type: "rich-text" }] },
      rows: { [r1]: { name: { runs: [{ text: "rich", marks: {} }] } } },
      rowOrder: [r1],
    });
    const errors = validateDoc(target.toJSON());
    expect(errors.some((e) => e.path === `blocks.${db}.attrs.columns[0].type`)).toBe(true);
    expect(errors.some((e) => e.path === `blocks.${db}.rows.${r1}.name`)).toBe(true);
  });
});
