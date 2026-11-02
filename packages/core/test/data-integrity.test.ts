import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { InvalidSnapshotError, type Doc, createDoc, fromJSON, loadDoc } from "../src/core";
import { validateDoc } from "../src/schema";
import type { DocJSON, OpaqueBlock } from "../src/schema";

/**
 * Pins for known data-integrity defects. Each test asserts the expected
 * (correct) behavior and is marked `.fails()`: while the underlying defect is
 * present the assertion fails, so the `.fails()` expectation is met and the
 * suite stays green. Once a defect is corrected the assertion passes and this
 * test turns red — convert it to a plain `it()` in the same change.
 *
 * The concurrent-formatting, concurrent-moves,
 * concurrent-shape-insert, concurrent-table-column-insert,
 * and concurrent-row-move tests are fixed behaviors (plain `it()`):
 * the text model is a single Y.Text with mark attributes; the block owner
 * is a single CRDT-resolved `parent` field; the canvas z-order is derived
 * from the children order (the stored `zIndex` is a dense mirror re-derived
 * at read time and on load); the table's column set is the shared
 * `columnOrder` array (the `columnWidths` mirror it as element-level ops,
 * materialized at table creation); the database rowOrder is read with the
 * first-occurrence deduplication (a concurrent moveRow pair leaves both
 * re-inserts in the raw array — the deterministic CRDT order picks the
 * single position on every peer). The snapshot's schema major stands
 * checked on the raw binary before conversion: a stored v: 2 (or a missing
 * / malformed v) is rejected with a clear error, and the JSON path's
 * validator stand (a v2 payload / a missing v) keeps the strict rejection
 * — a reader of major 1 never silently reads v2 data. The cross-minor
 * reader stand is a fixed behavior (plain `it()`): a reader of major
 * 1 opening a newer minor's v1 data tolerates the additive unknowns (an
 * unknown block type stands opaque, an unknown attr and an unknown mark are
 * preserved as-is) and does not lose them on save; the strict validator
 * (the writer's stand) keeps rejecting them.
 *
 * The two peers load the settled state (`loadDoc` of the first peer's bytes),
 * so they are independent Y.Docs of the same content, not a concurrent init.
 */

/** An independent second peer over the same content (settled-state load). */
const fork = (d: Doc): Doc => loadDoc(d.encode());

/** One bidirectional exchange: each side applies the other's full state. */
const merge = (a: Doc, b: Doc): void => {
  const ua = a.encode();
  const ub = b.encode();
  a.applyUpdate(ub);
  b.applyUpdate(ua);
};

/** A single paragraph seeded with the text `abcdef`. */
const seedParagraph = (): { a: Doc; id: string } => {
  const a = createDoc({ id: "pin" });
  const id = a.insertBlock("paragraph");
  a.insertText(id, 0, "abcdef");
  return { a, id };
};

describe("concurrent text and block edits keep the data valid", () => {
  it("concurrent formatting over a shared paragraph keeps the text intact", () => {
    const { a, id } = seedParagraph();
    const b = fork(a);
    a.setMark(id, 1, 4, { type: "bold" });
    b.setMark(id, 2, 5, { type: "italic" });
    merge(a, b);
    expect(a.getText(id)).toBe("abcdef");
    expect(b.getText(id)).toBe("abcdef");
  });

  it("concurrent moves of one block keep a single owner", () => {
    const { a, id } = seedParagraph();
    const surface = a.insertBlock("surface");
    const frameA = a.insertBlock("frame", undefined, { parent: surface });
    const frameB = a.insertBlock("frame", undefined, { parent: surface });
    const b = fork(a);
    a.moveBlock(id, frameA, 0);
    b.moveBlock(id, frameB, 0);
    merge(a, b);
    expect(validateDoc(a.toJSON())).toEqual([]);
  });

  it("concurrent shape inserts into an empty surface yield a reloadable snapshot", () => {
    const a = createDoc({ id: "pin" });
    const surface = a.insertBlock("surface");
    const b = fork(a);
    a.insertBlock("shape", { variant: "rect" }, { parent: surface });
    b.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    merge(a, b);
    expect(() => loadDoc(a.encode())).not.toThrow();
  });

  it("concurrent table column inserts keep the grid consistent", () => {
    const a = createDoc({ id: "pin" });
    const table = a.insertBlock("table", { cols: 1 });
    a.insertTableRow(table);
    const b = fork(a);
    a.insertTableColumn(table, 1);
    b.insertTableColumn(table, 1);
    merge(a, b);
    expect(validateDoc(a.toJSON())).toEqual([]);
  });

  it("concurrent inline database row moves keep the order unique", () => {
    const a = createDoc({ id: "pin" });
    const database = a.insertBlock("database", {
      columns: [{ id: "value", name: "Value", type: "text" }],
    });
    const row = a.insertRow(database);
    a.insertRow(database);
    a.insertRow(database);
    const b = fork(a);
    a.moveRow(database, row, 3);
    b.moveRow(database, row, 2);
    merge(a, b);
    expect(validateDoc(a.toJSON())).toEqual([]);
  });
});

describe("snapshot and serialization", () => {
  it("an unknown major version is rejected on load", () => {
    const { a } = seedParagraph();
    a.raw.getMap("meta").set("v", 2);
    expect(() => loadDoc(a.encode())).toThrow(/unsupported schema version 2/);
  });

  it("a v1 snapshot loads (the supported major stands)", () => {
    const { a } = seedParagraph();
    const restored = loadDoc(a.encode());
    expect(restored.toJSON().v).toBe(1);
    expect(restored.meta.v).toBe(1);
  });

  it("a missing schema version is rejected on load (before the content is interpreted)", () => {
    const { a } = seedParagraph();
    a.raw.getMap("meta").delete("v");
    expect(() => loadDoc(a.encode())).toThrow(/missing or malformed schema version/);
  });

  it("a malformed schema version (a non-number) is rejected on load", () => {
    const { a } = seedParagraph();
    a.raw.getMap("meta").set("v", "1");
    expect(() => loadDoc(a.encode())).toThrow(/missing or malformed schema version/);
  });

  it("the JSON path: a v2 payload is rejected by the validator (no silent downgrade)", () => {
    const { a } = seedParagraph();
    const json = a.toJSON();
    let thrown: unknown;
    try {
      fromJSON({ ...json, v: 2 as 1 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(InvalidSnapshotError);
    expect((thrown as Error).message).toContain("Unsupported schema version 2 (expected 1).");
  });

  it("the JSON path: a missing schema version is rejected (the strict validator stand)", () => {
    const { a } = seedParagraph();
    const json = a.toJSON();
    const rest: Record<string, unknown> = { ...json };
    delete rest.v;
    let thrown: unknown;
    try {
      fromJSON(rest as unknown as typeof json);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(InvalidSnapshotError);
    expect((thrown as Error).message).toContain('Missing required field "v".');
  });

  it("an additive v1 attr survives loading (the lenient load keeps it)", () => {
    const { a, id } = seedParagraph();
    const attrs = new Y.Map();
    attrs.set("futureFlag", "preserve-me");
    const entry = a.raw.getMap("blocks").get(id) as Y.Map<unknown>;
    entry.set("attrs", attrs);
    const restored = loadDoc(a.encode());
    expect(restored.toJSON().blocks[id]).toMatchObject({ attrs: { futureFlag: "preserve-me" } });
    // The re-save keeps the attr (the opaque stand round-trips, no data loss).
    expect(loadDoc(restored.encode()).toJSON().blocks[id]).toMatchObject({ attrs: { futureFlag: "preserve-me" } });
  });
});

describe("the reserved id stand", () => {
  // The id-keyed dictionaries (blocks / rows / cells) are plain objects in the
  // JSON format: an id that collides with an Object.prototype key would be
  // lost on the round trip (the __proto__ trap — the assignment reassigns the
  // prototype instead of creating an own key). The engine rejects the reserved
  // keys as ids at every input boundary (the commands + fromJSON) with a clear
  // error, so no id-keyed dictionary ever carries one.
  it("insertBlock rejects a reserved block id", () => {
    const d = createDoc({ id: "r" });
    for (const id of ["__proto__", "constructor", "toString"]) {
      expect(() => d.insertBlock("paragraph", undefined, { id })).toThrow(/reserved/);
    }
  });

  it("createDoc rejects a reserved document id", () => {
    for (const id of ["__proto__", "constructor", "toString"]) {
      expect(() => createDoc({ id })).toThrow(/reserved/);
    }
  });

  it("fromJSON rejects a reserved block id (the JSON.parse input stand)", () => {
    // A raw JSON string with __proto__ as an OWN block key: JSON.parse creates
    // it as an own data property (bypassing the __proto__ setter), so the
    // reader sees it and rejects it.
    const raw =
      '{"v":1,"id":"d","title":"t","createdAt":"2026-10-10T00:00:00.000Z","blocks":{"__proto__":{"type":"paragraph","content":[{"text":"x","marks":{}}]},"d":{"type":"root","children":["__proto__"]}}}';
    const parsed = JSON.parse(raw) as DocJSON;
    expect(Object.hasOwn(parsed.blocks, "__proto__")).toBe(true);
    let thrown: unknown;
    try {
      fromJSON(parsed);
    } catch (e) {
      thrown = e;
    }
    const message = thrown instanceof Error ? thrown.message : "";
    expect(message).toContain("reserved");
  });

  it("fromJSON rejects a reserved row and column id (the database dictionaries)", () => {
    // The rows (rowId -> cells) and cells (colId -> value) are id-keyed maps
    // too: a reserved row id or column id would be lost on the round trip.
    const raw =
      '{"v":1,"id":"d","title":"t","createdAt":"2026-10-10T00:00:00.000Z","blocks":{"d":{"type":"root","children":["db"]},"db":{"type":"database","attrs":{"columns":[{"id":"constructor","type":"text"}]},"rows":{"toString":{}},"rowOrder":["toString"]}}}';
    const errs = validateDoc(JSON.parse(raw) as DocJSON);
    const reserved = errs.filter((e) => e.message.includes("reserved"));
    // The reserved column id, the reserved row id (the rows key), and the
    // reserved row id (the rowOrder entry).
    expect(reserved).toHaveLength(3);
  });
});

describe("the cross-minor reader stand", () => {
  // An unknown mark on the text: the load tolerates it and the run keeps it.
  it("an additive v1 mark survives loading (the run keeps the unknown mark)", () => {
    const { a, id } = seedParagraph();
    const content = (a.raw.getMap("blocks").get(id) as Y.Map<unknown>).get("content") as Y.Text;
    content.format(0, 3, { wavy: true });
    const restored = loadDoc(a.encode());
    // The run keeps the unknown mark (the export preserves it as-is).
    const runs = (restored.toJSON().blocks[id] as OpaqueBlock).content;
    expect(runs?.[0]?.marks).toMatchObject({ wavy: true });
    // The text is intact and the re-save keeps the unknown mark.
    expect(restored.getText(id)).toBe("abcdef");
    const again = loadDoc(restored.encode());
    expect((again.toJSON().blocks[id] as OpaqueBlock).content?.[0]?.marks).toMatchObject({ wavy: true });
  });

  // An unknown block type: the load tolerates it (opaque), the block and its
  // fields survive the round trip, and its id stays in the root order.
  it("an additive v1 type loads as opaque data and survives the round trip", () => {
    const base = createDoc({ id: "pin" });
    base.insertBlock("paragraph"); // a known child so the root order is non-empty
    const json = base.toJSON();
    const id = "future1";
    const future: OpaqueBlock = { type: "future-block", attrs: { futureFlag: "preserve-me" } };
    const root = json.blocks[json.id] as { children?: string[] };
    root.children = [...(root.children ?? []), id];
    const doc = fromJSON({ ...json, blocks: { ...json.blocks, [id]: future } });
    // The opaque block stands in the export with its fields as-is.
    expect(doc.toJSON().blocks[id]).toMatchObject({ type: "future-block", attrs: { futureFlag: "preserve-me" } });
    // The re-save (encode -> load) keeps the opaque data (no loss on save).
    const again = loadDoc(doc.encode());
    expect(again.toJSON().blocks[id]).toMatchObject({ type: "future-block", attrs: { futureFlag: "preserve-me" } });
    // The unknown type's id stays in the root order (not dropped as dangling).
    expect(again.getChildren(again.meta.id)).toContain(id);
  });

  // Additive top-level fields beyond attrs/content/children/geometry (a
  // future minor's data) survive the round trip: the opaque stand keeps them
  // as-is on read and on write (the data-never-broken contract).
  it("the opaque stand keeps additive top-level fields across the round trip", () => {
    const base = createDoc({ id: "pin" });
    base.insertBlock("paragraph");
    const json = base.toJSON();
    const id = "future3";
    const future: OpaqueBlock = {
      type: "future-block",
      attrs: { futureFlag: "preserve-me" },
      state: { level: 2, tags: ["a", "b"] },
      order: ["x", "y"],
      weight: 7,
      enabled: true,
    };
    const root = json.blocks[json.id] as { children?: string[] };
    root.children = [...(root.children ?? []), id];
    const doc = fromJSON({ ...json, blocks: { ...json.blocks, [id]: future } });
    // The export carries the additive fields as-is (exactly these fields).
    expect(doc.toJSON().blocks[id]).toEqual(future);
    // The re-save keeps them (no loss on save); the layout-only parent
    // field never reaches the JSON.
    const again = loadDoc(doc.encode());
    expect(again.toJSON().blocks[id]).toEqual(future);
    expect("parent" in again.toJSON().blocks[id]!).toBe(false);
  });

  // Additive nested fields (an object attr's fields) and an additive /
  // legacy geometry field: the lenient (cross-minor) boundary preserves
  // them as-is (the known fields keep their value checks), the strict
  // validator (the writer's stand) keeps rejecting them, and the data
  // survives the round trip.
  it("the lenient load preserves additive nested attr fields and geometry fields", () => {
    const base = createDoc({ id: "pin" });
    const embed = base.insertBlock("sync-embed", { ref: { docId: "other", blockId: "b1" } });
    const paragraph = base.insertBlock("paragraph");
    const json = base.toJSON();
    // The additive nested field on the known object attr, and the legacy
    // geometry field on a known block.
    const embedJson = json.blocks[embed] as { attrs?: { ref?: Record<string, unknown> } };
    embedJson.attrs!.ref!.anchor = "top";
    const paragraphJson = json.blocks[paragraph] as Record<string, unknown>;
    paragraphJson.geometry = { x: 0, y: 0, w: 100, h: 40, rotation: 90 };
    // The lenient boundary accepts the document.
    expect(validateDoc(json, true)).toEqual([]);
    // The strict posture rejects both additive fields.
    const strictPaths = validateDoc(json).map((error) => error.path);
    expect(strictPaths).toContain(`blocks.${embed}.attrs.ref.anchor`);
    expect(strictPaths).toContain(`blocks.${paragraph}.geometry.rotation`);
    // The lenient load keeps the fields in the export (no data loss).
    const doc = fromJSON(json);
    expect(doc.toJSON().blocks[embed]!).toMatchObject({
      type: "sync-embed",
      attrs: { ref: { docId: "other", blockId: "b1", anchor: "top" } },
    });
    expect(doc.toJSON().blocks[paragraph]!).toMatchObject({
      type: "paragraph",
      geometry: { x: 0, y: 0, w: 100, h: 40, rotation: 90 },
    });
  });

  // A NEW enum value on a known attr (a future minor's data): the lenient
  // load preserves it as-is (the strict validator keeps rejecting it), and
  // the value survives the round trip.
  it("the lenient load preserves a new enum value on a known attr", () => {
    const base = createDoc({ id: "pin" });
    const heading = base.insertBlock("heading", { level: 1 });
    const surface = base.insertBlock("surface");
    const shape = base.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const json = base.toJSON();
    const headingJson = json.blocks[heading] as { attrs?: { level?: number } };
    headingJson.attrs!.level = 7;
    const shapeJson = json.blocks[shape] as { attrs?: { variant?: string } };
    shapeJson.attrs!.variant = "hexagon";
    // The lenient boundary accepts the document.
    expect(validateDoc(json, true)).toEqual([]);
    // The strict posture rejects both new values.
    const strictPaths = validateDoc(json).map((error) => error.path);
    expect(strictPaths).toContain(`blocks.${heading}.attrs.level`);
    expect(strictPaths).toContain(`blocks.${shape}.attrs.variant`);
    // The lenient load keeps the values in the export (no data loss).
    const doc = fromJSON(json);
    expect(doc.toJSON().blocks[heading]!).toMatchObject({ type: "heading", attrs: { level: 7 } });
    expect(doc.toJSON().blocks[shape]!).toMatchObject({ type: "shape", attrs: { variant: "hexagon" } });
    const again = loadDoc(doc.encode());
    expect(again.toJSON().blocks[heading]!).toMatchObject({ type: "heading", attrs: { level: 7 } });
    expect(again.toJSON().blocks[shape]!).toMatchObject({ type: "shape", attrs: { variant: "hexagon" } });
  });

  // fromJSON is a reader boundary like the snapshot load: the additive
  // unknowns are tolerated (not rejected), the known data is still validated.
  it("fromJSON accepts the cross-minor stand and the strict validator rejects it", () => {
    const base = createDoc({ id: "pin" });
    base.insertBlock("paragraph");
    const json = base.toJSON();
    const id = "future2";
    const future: OpaqueBlock = { type: "future-block" };
    const root = json.blocks[json.id] as { children?: string[] };
    root.children = [...(root.children ?? []), id];
    const extended = { ...json, blocks: { ...json.blocks, [id]: future } };
    // The lenient reader boundary accepts it (the opaque block is preserved).
    expect(fromJSON(extended).toJSON().blocks[id]).toMatchObject({ type: "future-block" });
    // The strict validator (the writer's stand) rejects the unknown type.
    expect(validateDoc(extended).some((e) => e.message.includes("Unknown block type"))).toBe(true);
  });

  // The database's column types: a future (additive) type cannot have its
  // value contract checked by this reader — the lenient load skips the
  // check (the data stands); the known types' checks stand.
  it("a future database column type survives the lenient load (the value check stands skipped)", () => {
    const base = createDoc({ id: "pin" });
    const dbId = base.insertBlock("database", {
      columns: [{ id: "name", name: "Name", type: "text" }],
    });
    const json = base.toJSON();
    const db = json.blocks[dbId] as {
      attrs?: { columns?: Array<Record<string, unknown>> };
      rows?: Record<string, Record<string, unknown>>;
      rowOrder?: string[];
    };
    const columns = [
      ...((db.attrs?.columns as Array<Record<string, unknown>> | undefined) ?? []),
      { id: "rating", name: "Rating", type: "future-rating", options: ["good", "bad"] },
    ];
    db.attrs = { ...db.attrs, columns };
    db.rows = { ...db.rows, r1: { rating: "good" } };
    db.rowOrder = [...(db.rowOrder ?? []), "r1"];
    const extended = { ...json, blocks: { ...json.blocks, [dbId]: db } } as DocJSON;

    // The lenient reader boundary preserves the future type and its value
    // (the value check and the options presence stand skipped).
    const loaded = fromJSON(extended);
    expect(loaded.toJSON().blocks[dbId]).toEqual(db);
    // The strict validator (the writer's stand) rejects the unknown type.
    expect(validateDoc(extended).some((e) => e.message.includes("unknown column type"))).toBe(true);
  });

  it("the lenient database stand still checks the known column types", () => {
    const base = createDoc({ id: "pin" });
    const dbId = base.insertBlock("database", {
      columns: [{ id: "name", name: "Name", type: "text" }],
    });
    const json = base.toJSON();
    const db = json.blocks[dbId] as {
      attrs?: { columns?: Array<Record<string, unknown>> };
      rows?: Record<string, Record<string, unknown>>;
      rowOrder?: string[];
    };
    db.rows = { ...db.rows, r1: { name: 42 } };
    db.rowOrder = [...(db.rowOrder ?? []), "r1"];
    const extended = { ...json, blocks: { ...json.blocks, [dbId]: db } } as DocJSON;
    // A known type's value contract fails the lenient load (the known-data
    // checks stand over the cross-minor posture).
    expect(validateDoc(extended, true).some((e) => e.message.includes("must be a non-empty string"))).toBe(true);
    expect(() => fromJSON(extended)).toThrow(InvalidSnapshotError);
  });
});
