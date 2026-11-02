import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { type Doc, InvalidSnapshotError, createDoc, fromJSON, loadDoc } from "../src/core";
import { attrsToMarkSet } from "../src/core/text-model";
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

  it("insertRow rejects a reserved row id (the generateId's stand)", () => {
    // The row id comes from the doc's generator (a custom generateId can
    // mint a reserved id): the command's own guard rejects it (the rows'
    // dictionary would lose the key on the JSON export).
    let minted = 0;
    const d = createDoc({ id: "r-row", generateId: () => (minted++ === 1 ? "__proto__" : `id${minted}`) });
    const db = d.insertBlock("database", { columns: [{ id: "c1", name: "C", type: "text" }] });
    expect(() => d.insertRow(db)).toThrow(/reserved/);
  });
});

describe("the layout-only fields stand out of the JSON export", () => {
  // The 'parent' field (the block's owner — the CRDT-resolved stand of a
  // concurrent move) is Yjs-layout-only: it never reaches the JSON (the
  // reader derives it from the tree). The export must not leak it into any
  // block (a stray key would pass the validator — the validator has no
  // closed set of block keys — so the stand is the export's own).
  it("the 'parent' field stands absent from every block's JSON (the nested stands included)", () => {
    const d = createDoc({ id: "no-parent" });
    const p = d.insertBlock("paragraph");
    d.insertText(p, 0, "top");
    const list = d.insertBlock("list-item", { list: "bullet", indent: 1 });
    d.insertText(list, 0, "nested");
    const table = d.insertBlock("table", { cols: 1 });
    d.insertTableRow(table);
    const json = d.toJSON();
    expect(Object.keys(json.blocks).length).toBeGreaterThan(4); // root + the blocks above + the table's row / cell
    for (const block of Object.values(json.blocks)) {
      expect(Object.hasOwn(block, "parent"), `the block "${block.type}" leaks the layout-only parent`).toBe(false);
    }
  });
});

describe("the snapshot's plain values stand no aliasing over the store", () => {
  // The read boundary must not hand out the CRDT store's own plain
  // values (a post-read mutation of the snapshot would corrupt the doc
  // outside any transaction — 0 change events, persisted through the
  // toJSON).
  it("the multi-select cell's snapshot stands no aliasing (the mutation stands no corruption)", () => {
    const doc = createDoc({ id: "d" });
    const db = doc.insertBlock("database", {
      columns: [{ id: "m", name: "M", type: "multi-select", options: ["a", "b"] }],
    });
    const row = doc.insertRow(db);
    doc.setCell(db, row, "m", ["a"]);
    let changes = 0;
    doc.onChange(() => changes++);
    const snapshot = doc.getBlock(db) as unknown as { rows?: Record<string, Record<string, unknown>> } | null;
    const cells = snapshot?.rows?.[row] as Record<string, unknown>;
    expect(cells.m).toEqual(["a"]);
    // The mutation over the snapshot (the aliasing stand): the store stands
    // untouched — no change event, the data stands.
    (cells.m as unknown[]).push("b");
    expect(changes).toBe(0);
    const after = doc.getBlock(db) as unknown as { rows?: Record<string, Record<string, unknown>> } | null;
    expect(after?.rows?.[row]?.m).toEqual(["a"]);
  });

  it("the shape's points tuples stand no aliasing (the mutation stands no corruption)", () => {
    const doc = createDoc({ id: "d" });
    const surface = doc.insertBlock("surface");
    const shape = doc.insertBlock(
      "shape",
      {
        variant: "rect",
        points: [
          [0, 0],
          [10, 10],
        ],
      },
      { parent: surface }
    );
    const read = (id: string) =>
      (doc.getBlock(id) as unknown as { attrs?: { points?: number[][] } } | null)?.attrs?.points;
    const before = read(shape);
    expect(before).toEqual([
      [0, 0],
      [10, 10],
    ]);
    before?.[0]?.push(99);
    expect(read(shape)).toEqual([
      [0, 0],
      [10, 10],
    ]);
  });
});

describe("the embed's src stands the unsafe-scheme rejection", () => {
  // The kind x src cross-field rule: the write posture
  // rejects the `javascript:` / the foreign `data:` (the XSS over the
  // consumer's `allow-same-origin` + `allow-scripts` grant, the phishing
  // surface); the lenient load keeps the value as data (the renderer gates
  // it), the `html` kind stands its own `data:text/html` snippet.
  it("the write posture rejects the unsafe scheme (the insert + the update stands)", () => {
    const doc = createDoc({ id: "d" });
    expect(() => doc.insertBlock("embed", { kind: "iframe", src: "javascript:alert(1)" })).toThrow(/not a safe URL/);
    expect(() => doc.insertBlock("embed", { kind: "iframe", src: "data:text/html,<script>alert(1)</script>" })).toThrow(
      /not a safe URL/
    );
    // The browser's leading-control trim (the `javascript:` after the C0
    // run stands the scheme detection's bypass) is undone.
    expect(() => doc.insertBlock("embed", { kind: "iframe", src: "\tjavascript:alert(1)" })).toThrow(/not a safe URL/);
    const id = doc.insertBlock("embed", { kind: "iframe", src: "https://example.com" });
    expect(() => doc.updateBlock(id, { src: "javascript:alert(1)" })).toThrow(/not a safe URL/);
    expect(() => doc.updateBlock(id, { src: "data:text/html,<x>" })).toThrow(/not a safe URL/);
    // The safe stand: the absolute http/https over every kind.
    doc.updateBlock(id, { src: "https://github.com/x/y" });
  });

  it("the html kind stands the data:text/html snippet (the kind's purpose)", () => {
    const doc = createDoc({ id: "d" });
    const html = doc.insertBlock("embed", { kind: "html", src: "data:text/html,<h1>hi</h1>" });
    doc.updateBlock(html, { src: "data:text/html;base64,PGgxPmhpPC9oPg==" });
    doc.insertBlock("embed", { kind: "html", src: "https://example.com/page.html" });
  });

  it("the strict validator rejects the unsafe src; the lenient load keeps it (the data stand)", () => {
    const base = {
      v: 1,
      id: "d",
      title: "t",
      createdAt: "2026-10-10T00:00:00.000Z",
      blocks: {
        d: { type: "root" as const, children: ["e"] },
        e: { type: "embed" as const, attrs: { kind: "iframe", src: "javascript:alert(1)" } },
      },
    };
    expect(validateDoc(JSON.parse(JSON.stringify(base)) as DocJSON).some((e) => e.path.includes("src"))).toBe(true);
    const loaded = fromJSON(JSON.parse(JSON.stringify(base)) as DocJSON);
    const block = loaded.getBlock("e") as { attrs?: { src?: string } } | null;
    expect(block?.attrs?.src).toBe("javascript:alert(1)");
  });
});

describe("the reserved attr / mark key stand (the prototype pollution boundary)", () => {
  // The id-keyed dictionaries reject the reserved keys outright; the
  // key-open boundaries (the read's snapshot assembly, the command's merge,
  // the mark / attr conversions) stand the key as an OWN data property
  // instead — the `plain[key] = value` assignment with the `__proto__` key
  // reassigns the snapshot's prototype (an attacker's object whose getters
  // run on property access), the JSON export loses the data.
  it("the read boundary stands the reserved attr key as an own property (the prototype stands untouched)", () => {
    const doc = createDoc({ id: "d" });
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "x");
    // The remote input's stand: the raw Yjs write stands no validation —
    // a crafted update carries the reserved key into the attrs map. The
    // value is an own-data object (the JSON.parse stand — the object
    // literal's `__proto__` is the prototype itself, not a data key).
    const crafted = JSON.parse('{"__proto__":{"payload":"x"},"level":2}') as Record<string, unknown>;
    const yblock = doc.raw.getMap("blocks").get(p) as Y.Map<unknown>;
    const yattrs = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(crafted)) yattrs.set(key, value);
    yblock.set("attrs", yattrs);
    // The fresh load (the read boundary) stands the data neutralized.
    const loaded = loadDoc(doc.encode());
    const block = loaded.getBlock(p) as { attrs?: Record<string, unknown> } | null;
    const attrs = block?.attrs;
    expect(attrs).toBeDefined();
    expect(Object.hasOwn(attrs!, "__proto__")).toBe(true);
    // The own data key stands the value (no reassignment — the attacker's
    // object is the value, not the prototype: its members never run as the
    // snapshot's, the prototype stands Object.prototype).
    expect(attrs!.__proto__).toEqual({ payload: "x" });
    expect(Object.getPrototypeOf(attrs!)).toBe(Object.prototype);
    // The ordinary attr stands beside it, and the JSON export keeps the key
    // (the own enumerable property serializes — the round trip stands).
    expect(attrs!.level).toBe(2);
    expect(JSON.stringify(attrs)).toContain("__proto__");
  });

  it("the command's merge stands the reserved key (the strict stand rejects the patch)", () => {
    const doc = createDoc({ id: "d" });
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "x");
    // The JSON.parse stand (the object literal's `__proto__` stands the
    // prototype, not an own patch key): the own reserved key reaches the
    // merge, and the strict validation decides it (the hasOwn stand — no
    // inherited spec).
    const patch = JSON.parse('{"level":2,"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(() => doc.updateBlock(p, patch as Parameters<typeof doc.updateBlock>[1])).toThrow(/Invalid attrs/);
  });

  it("the reserved attr name stands no registry spec (the validator's hasOwn stand)", () => {
    // An inherited Object.prototype member (toString-class name) stands no
    // spec: the unknown-attr branch decides it (strict rejects, lenient
    // preserves the data).
    const base = {
      v: 1,
      id: "d",
      title: "t",
      createdAt: "2026-10-10T00:00:00.000Z",
      blocks: {
        d: { type: "root" as const, children: ["p"] },
        p: { type: "paragraph" as const, content: [{ text: "x", marks: {} }], attrs: { toString: 1 } },
      },
    };
    expect(validateDoc(JSON.parse(JSON.stringify(base)) as DocJSON).some((e) => e.message.includes("toString"))).toBe(
      true
    );
    const loaded = fromJSON(JSON.parse(JSON.stringify(base)) as DocJSON);
    const block = loaded.getBlock("p") as { attrs?: Record<string, unknown> } | null;
    expect(Object.hasOwn(block?.attrs ?? {}, "toString")).toBe(true);
    expect((block?.attrs as Record<string, unknown>).toString).toBe(1);
  });

  it("the crafted character attribute's reserved key stands the marks' own property (no execution)", () => {
    // The CRDT's layer (Yjs) already stands the reserved character
    // attribute key (it drops it on format — the crafted key never
    // reaches the marks over the wire); the conversion's own stand is
    // pinned directly (the boundary itself: an open key stands the own
    // property, the prototype stands untouched, the ordinary attrs stand).
    const crafted = JSON.parse('{"__proto__":{"polluted":true},"bold":true,"link":{"href":"https://x"}}') as Record<
      string,
      unknown
    >;
    const marks = attrsToMarkSet(crafted) as Record<string, unknown>;
    expect(Object.hasOwn(marks, "__proto__")).toBe(true);
    expect(marks.__proto__).toEqual({ polluted: true });
    expect(marks.bold).toBe(true);
    expect(marks.link).toEqual({ href: "https://x" });
    expect(Object.getPrototypeOf(marks)).toBe(Object.prototype);
    // The reserved mark name stands no registry spec (the hasOwn stand —
    // the inherited member stands the unknown-mark pass-through).
    const reservedName = JSON.parse('{"toString":{"x":1}}') as Record<string, unknown>;
    const marks2 = attrsToMarkSet(reservedName) as Record<string, unknown>;
    expect(Object.hasOwn(marks2, "toString")).toBe(true);
    expect(Object.getPrototypeOf(marks2)).toBe(Object.prototype);
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

  // A future field on a KNOWN mark (the cross-minor additive): the lenient
  // load tolerates it (the validator's mark-fields stand), and the read
  // path passes it through (any value shape — the data is not lost on save).
  it("a future field on a known mark survives the lenient load (the value shape stands preserved)", () => {
    const { a, id } = seedParagraph();
    const content = (a.raw.getMap("blocks").get(id) as Y.Map<unknown>).get("content") as Y.Text;
    content.format(0, 3, { mention: { kind: "user", id: "u1", label: "Alice", refs: ["doc-9"] } });
    const restored = loadDoc(a.encode());
    const runs = (restored.toJSON().blocks[id] as OpaqueBlock).content;
    expect(runs?.[0]?.marks).toMatchObject({
      mention: { kind: "user", id: "u1", label: "Alice", refs: ["doc-9"] },
    });
    expect(restored.getText(id)).toBe("abcdef");
    // The re-save keeps the future field (no loss on save).
    const again = loadDoc(restored.encode());
    expect((again.toJSON().blocks[id] as OpaqueBlock).content?.[0]?.marks).toMatchObject({
      mention: { kind: "user", id: "u1", label: "Alice", refs: ["doc-9"] },
    });
    // The strict validator (the writer's stand) rejects the unknown field.
    expect(validateDoc(restored.toJSON()).some((e) => e.message.includes('Unknown attribute "refs"'))).toBe(true);
  });

  it("a new enum value on a known mark field survives the lenient load", () => {
    const { a, id } = seedParagraph();
    const content = (a.raw.getMap("blocks").get(id) as Y.Map<unknown>).get("content") as Y.Text;
    content.format(0, 3, { mention: { kind: "page", id: "d9", label: "Doc" } });
    const restored = loadDoc(a.encode());
    const runs = (restored.toJSON().blocks[id] as OpaqueBlock).content;
    expect(runs?.[0]?.marks).toMatchObject({ mention: { kind: "page", id: "d9", label: "Doc" } });
    const again = loadDoc(restored.encode());
    expect((again.toJSON().blocks[id] as OpaqueBlock).content?.[0]?.marks).toMatchObject({ mention: { kind: "page" } });
    // The strict validator (the writer's stand) rejects the new enum value.
    expect(validateDoc(restored.toJSON()).some((e) => e.message.includes("must be one of"))).toBe(true);
  });

  // The corruption stand: a known field with a non-string value is dropped
  // on read (a future minor cannot change a known field's contract — the
  // live view degrades gracefully, the text stands; the snapshot boundary
  // rejects the corrupted state loudly — the strict posture protects the
  // data we own).
  it("a non-string value on a known mark field stands dropped on read (the corruption stand)", () => {
    const { a, id } = seedParagraph();
    const content = (a.raw.getMap("blocks").get(id) as Y.Map<unknown>).get("content") as Y.Text;
    content.format(0, 3, { mention: { kind: 42, id: "u1", label: "Alice" } });
    // The live view degrades gracefully: the field is dropped, the text stands.
    const runs = (a.toJSON().blocks[id] as OpaqueBlock).content;
    const mention = (runs?.[0]?.marks as Record<string, unknown> | undefined)?.mention as Record<string, unknown>;
    expect(mention).toMatchObject({ id: "u1", label: "Alice" });
    expect(mention).not.toHaveProperty("kind");
    expect(a.getText(id)).toBe("abcdef");
    // The snapshot boundary rejects the corrupted state loudly (a required
    // field stands missing after the protective drop — the load must not
    // silently stand a truncated mark).
    expect(() => loadDoc(a.encode())).toThrow(InvalidSnapshotError);
  });

  it("a future attribute on a known single-attr mark survives the lenient load", () => {
    const { a, id } = seedParagraph();
    const content = (a.raw.getMap("blocks").get(id) as Y.Map<unknown>).get("content") as Y.Text;
    content.format(0, 3, { link: { href: "https://example.com", data: { deep: true } } });
    const restored = loadDoc(a.encode());
    const runs = (restored.toJSON().blocks[id] as OpaqueBlock).content;
    expect(runs?.[0]?.marks).toMatchObject({
      link: { href: "https://example.com", data: { deep: true } },
    });
    const again = loadDoc(restored.encode());
    expect((again.toJSON().blocks[id] as OpaqueBlock).content?.[0]?.marks).toMatchObject({
      link: { data: { deep: true } },
    });
    expect(validateDoc(restored.toJSON()).some((e) => e.message.includes('Unknown attribute "data"'))).toBe(true);
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
