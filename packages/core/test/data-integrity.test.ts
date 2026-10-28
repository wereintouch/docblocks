import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { type Doc, createDoc, fromJSON, loadDoc } from "../src/core";
import { validateDoc } from "../src/schema";

/**
 * Pins for known data-integrity defects. Each test asserts the expected
 * (correct) behavior and is marked `.fails()`: while the underlying defect is
 * present the assertion fails, so the `.fails()` expectation is met and the
 * suite stays green. Once a defect is corrected the assertion passes and this
 * test turns red — convert it to a plain `it()` in the same change.
 *
 * The concurrent-formatting and concurrent-moves tests are fixed
 * behaviors (plain `it()`): the text model is a single Y.Text with mark
 * attributes (concurrent formatting keeps the text intact), and the block
 * owner is a single CRDT-resolved `parent` field (concurrent moves keep one
 * owner).
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

  it.fails("concurrent shape inserts into an empty surface yield a reloadable snapshot", () => {
    const a = createDoc({ id: "pin" });
    const surface = a.insertBlock("surface");
    const b = fork(a);
    a.insertBlock("shape", { variant: "rect" }, { parent: surface });
    b.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    merge(a, b);
    expect(() => loadDoc(a.encode())).not.toThrow();
  });

  it.fails("concurrent table column inserts keep the grid consistent", () => {
    const a = createDoc({ id: "pin" });
    const table = a.insertBlock("table", { cols: 1 });
    a.insertTableRow(table);
    const b = fork(a);
    a.insertTableColumn(table, 1);
    b.insertTableColumn(table, 1);
    merge(a, b);
    expect(validateDoc(a.toJSON())).toEqual([]);
  });

  it.fails("concurrent inline database row moves keep the order unique", () => {
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
  it.fails("an unknown major version is rejected on load", () => {
    const { a } = seedParagraph();
    a.raw.getMap("meta").set("v", 2);
    expect(() => loadDoc(a.encode())).toThrow();
  });

  it.fails("an additive v1 attr survives loading", () => {
    const { a, id } = seedParagraph();
    const attrs = new Y.Map();
    attrs.set("futureFlag", "preserve-me");
    const entry = a.raw.getMap("blocks").get(id) as Y.Map<unknown>;
    entry.set("attrs", attrs);
    expect(() => loadDoc(a.encode())).not.toThrow();
  });

  it.fails("an opaque block id (__proto__) survives a JSON round trip", () => {
    const d = createDoc({ id: "pin" });
    const id = d.insertBlock("paragraph", undefined, { id: "__proto__" });
    d.insertText(id, 0, "keep");
    const restored = fromJSON(JSON.parse(JSON.stringify(d.toJSON())));
    expect(restored.getText(id)).toBe("keep");
  });
});
