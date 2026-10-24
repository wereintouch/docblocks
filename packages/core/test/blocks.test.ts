import { describe, expect, it } from "vitest";

import {
  DetachedBlockError,
  DocBlocksError,
  InvalidAttrsError,
  InvalidChildError,
  InvalidOperationError,
  InvalidRangeError,
  UnknownBlockError,
  UnknownBlockTypeError,
  createDoc,
  fromJSON,
} from "../src/core";
import type { Doc } from "../src/core";
import type { BlockAttrsPatch, BlockType, CanvasRef, HeadingAttrs, ShapeAttrs } from "../src/schema";
import { validateDoc } from "../src/schema";

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "r", createdAt: CREATED_AT });

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

describe("insertBlock", () => {
  it("inserts every non-root type with the registry shape", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    const h = doc.insertBlock("heading", { level: 1 });
    const li = doc.insertBlock("list-item", { list: "bullet" });
    const q = doc.insertBlock("quote", { align: "center" });
    const c = doc.insertBlock("callout");
    const code = doc.insertBlock("code");
    const table = doc.insertBlock("table", { cols: 2 });
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    const c1 = doc.insertBlock("table-cell", undefined, { parent: row });
    const c2 = doc.insertBlock("table-cell", undefined, { parent: row });
    const image = doc.insertBlock("image", { src: "blobs/x.png" });
    const embed = doc.insertBlock("embed", { kind: "iframe", src: "https://example.com" });
    const sync = doc.insertBlock("sync-embed", { ref: { docId: "master-1", blockId: "b9" } });
    const database = doc.insertBlock("database", {
      columns: [{ id: "name", name: "Name", type: "text" }],
    });
    const divider = doc.insertBlock("divider");
    const surface = doc.insertBlock("surface");
    const shape = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const connector = doc.insertBlock(
      "connector",
      { start: { blockId: surface }, end: { blockId: shape } },
      { parent: surface }
    );
    const frame = doc.insertBlock("frame", undefined, { parent: surface });
    const canvasText = doc.insertBlock("canvas-text", undefined, { parent: surface });

    expect(doc.getChildren("r")).toEqual([p, h, li, q, c, code, table, image, embed, sync, database, divider, surface]);
    expect(doc.getChildren(table)).toEqual([row]);
    expect(doc.getChildren(row)).toEqual([c1, c2]);
    expect(doc.getChildren(surface)).toEqual([shape, connector, frame, canvasText]);
    expect(doc.getBlock(h)).toEqual({ type: "heading", attrs: { level: 1 } });
    expect(doc.getBlock(li)).toEqual({ type: "list-item", attrs: { list: "bullet" } });
    expect(doc.getBlock(q)).toEqual({ type: "quote", attrs: { align: "center" } });
    expect(doc.getBlock(image)).toEqual({ type: "image", attrs: { src: "blobs/x.png" } });
    expect(doc.getBlock(embed)).toEqual({ type: "embed", attrs: { kind: "iframe", src: "https://example.com" } });
    expect(doc.getBlock(sync)).toEqual({ type: "sync-embed", attrs: { ref: { docId: "master-1", blockId: "b9" } } });
    expect(doc.getBlock(database)).toEqual({
      type: "database",
      attrs: { columns: [{ id: "name", name: "Name", type: "text" }] },
      rows: {},
      rowOrder: [],
    });
    expect(doc.getBlock(divider)).toEqual({ type: "divider" });
    expect(doc.getBlock(surface)).toEqual({ type: "surface", children: [shape, connector, frame, canvasText] });
    expect(doc.getBlock(shape)).toEqual({ type: "shape", attrs: { variant: "rect", zIndex: 1 } });
    expect(doc.getBlock(connector)).toEqual({
      type: "connector",
      attrs: { start: { blockId: surface }, end: { blockId: shape }, zIndex: 2 },
    });
    expect(doc.getBlock(frame)).toEqual({ type: "frame" });
    expect(doc.getBlock(canvasText)).toEqual({ type: "canvas-text", attrs: { zIndex: 3 } });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("inserts after the given sibling and appends by default", () => {
    const doc = newDoc();
    const p1 = doc.insertBlock("paragraph");
    const p2 = doc.insertBlock("paragraph", undefined, { after: p1 });
    const p3 = doc.insertBlock("paragraph");
    const p4 = doc.insertBlock("paragraph", undefined, { after: p1 });
    expect(doc.getChildren("r")).toEqual([p1, p4, p2, p3]);
  });

  it("page content is a flat sequence: insert under a page-content block is rejected", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    const li = doc.insertBlock("list-item", { list: "bullet" });
    // The remodeled page types are not containers anymore: nesting is the
    // `indent` attr in the page sequence, not a child of the block.
    expectThrows(() => doc.insertBlock("paragraph", undefined, { parent: p }), InvalidOperationError);
    expectThrows(() => doc.insertBlock("list-item", { list: "bullet" }, { parent: li }), InvalidOperationError);
    // The doc stands; the flat sequence is the only page-context.
    expect(doc.getChildren("r")).toEqual([p, li]);
    // The same sequence expressed with indents round-trips and validates.
    const indented = doc.insertBlock("paragraph");
    doc.updateBlock(indented, { indent: 1 });
    expect(doc.getBlock(indented)).toEqual({ type: "paragraph", attrs: { indent: 1 } });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("generates block ids via the doc's id generator", () => {
    let n = 0;
    const doc = createDoc({ id: "d", createdAt: CREATED_AT, generateId: () => `b${n++}` });
    expect(doc.insertBlock("paragraph")).toBe("b0");
    expect(doc.insertBlock("divider")).toBe("b1");
  });

  it("accepts an explicit block id and rejects a colliding / empty one", () => {
    const doc = newDoc();
    const id = doc.insertBlock("paragraph", undefined, { id: "my-tail" });
    expect(id).toBe("my-tail");
    expect(doc.getChildren("r")).toEqual(["my-tail"]);
    expect(doc.getBlock("my-tail")).toEqual({ type: "paragraph" });
    expectThrows(() => doc.insertBlock("paragraph", undefined, { id: "my-tail" }), InvalidOperationError);
    expectThrows(() => doc.insertBlock("paragraph", undefined, { id: "" }), InvalidOperationError);
    // The generated ids are unaffected (the explicit path is additive).
    expect(doc.insertBlock("paragraph")).not.toBe("my-tail");
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("converges a concurrent explicit-id insert to one block and one order slot", () => {
    // The deterministic tail paragraph: two peers standing the same
    // non-text tail insert the same id — the idempotent write keeps one
    // block and one order slot on both sides.
    const maker = newDoc();
    const p = maker.insertBlock("paragraph");
    maker.insertBlock("database", { tableId: "t1" }, { after: p });
    const start = maker.toJSON();
    const A = fromJSON(JSON.parse(JSON.stringify(start)));
    const B = fromJSON(JSON.parse(JSON.stringify(start)));
    const root = "r";
    const last = A.getChildren(root).slice(-1)[0]!;
    A.insertBlock("paragraph", undefined, { parent: root, after: last, id: "r-tail" });
    B.insertBlock("paragraph", undefined, { parent: root, after: last, id: "r-tail" });
    A.applyUpdate(B.encodeUpdate());
    B.applyUpdate(A.encodeUpdate());
    for (const [name, doc] of [
      ["A", A],
      ["B", B],
    ] as const) {
      const children = doc.getChildren(root);
      expect(
        children.filter((id) => id === "r-tail"),
        `${name}: one order slot`
      ).toEqual(["r-tail"]);
      expect(doc.getBlock("r-tail")).toEqual({ type: "paragraph" });
      expect(validateDoc(doc.toJSON()), `${name}: valid`).toEqual([]);
    }
    // The settled state re-loads (the read path stands on the converged
    // order).
    const reloaded = fromJSON(JSON.parse(JSON.stringify(A.toJSON())));
    expect(reloaded.getChildren(root)).toEqual(A.getChildren(root));
  });

  it("unknown type -> UnknownBlockTypeError", () => {
    const doc = newDoc();
    const error = expectThrows(() => doc.insertBlock("bogus" as BlockType), UnknownBlockTypeError);
    expect(error.message).toContain("bogus");
  });

  it("root -> InvalidOperationError", () => {
    expect(() => newDoc().insertBlock("root")).toThrow(InvalidOperationError);
  });

  it("attrs failing the registry rules -> InvalidAttrsError", () => {
    const doc = newDoc();
    expect(() => doc.insertBlock("heading", { level: 7 } as unknown as HeadingAttrs)).toThrow(InvalidAttrsError);
    expect(() => doc.insertBlock("heading", undefined as unknown as HeadingAttrs)).toThrow(InvalidAttrsError);
    expect(() => doc.insertBlock("table", { cols: 0 })).toThrow(InvalidAttrsError);
    expect(() => doc.insertBlock("divider", { bogus: 1 } as never)).toThrow(InvalidAttrsError);
    expect(() =>
      doc.insertBlock("database", {
        columns: [{ id: "c", name: "C", type: "select" }],
      })
    ).toThrow(InvalidAttrsError); // select requires the options array
    // The canvas set: the shape variant enum, the opacity range, the
    // freehand points tuple shape, and the connector refs (at least one field)
    // — inside a surface (the canvas types are not allowed at the page root).
    const surface = doc.insertBlock("surface");
    expect(() =>
      doc.insertBlock("shape", { variant: "hexagon" } as unknown as ShapeAttrs, { parent: surface })
    ).toThrow(InvalidAttrsError);
    expect(() => doc.insertBlock("shape", { variant: "rect", opacity: 2 }, { parent: surface })).toThrow(
      InvalidAttrsError
    );
    expect(() => doc.insertBlock("shape", { variant: "rect", strokeWidth: 0 }, { parent: surface })).toThrow(
      InvalidAttrsError
    );
    expect(() =>
      doc.insertBlock("shape", { variant: "rect", points: [[1, 2, 3]] } as unknown as ShapeAttrs, {
        parent: surface,
      })
    ).toThrow(InvalidAttrsError);
    expect(() =>
      doc.insertBlock(
        "connector",
        { start: {} as unknown as CanvasRef, end: { blockId: surface } },
        {
          parent: surface,
        }
      )
    ).toThrow(InvalidAttrsError); // an empty ref
    expect(() => doc.insertBlock("canvas-text", { fontSize: -1 }, { parent: surface })).toThrow(InvalidAttrsError);
  });

  it("unknown parent -> UnknownBlockError; detached `after` -> DetachedBlockError", () => {
    const doc = newDoc();
    expect(() => doc.insertBlock("paragraph", undefined, { parent: "nope" })).toThrow(UnknownBlockError);
    const table = doc.insertBlock("table", { cols: 1 });
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    const p = doc.insertBlock("paragraph");
    const error = expectThrows(
      () => doc.insertBlock("table-cell", undefined, { parent: row, after: p }),
      DetachedBlockError
    );
    expect(error.message).toContain(p);
    expect(error.message).toContain(row);
  });

  it("type not allowed under the parent -> InvalidChildError", () => {
    const doc = newDoc();
    const table = doc.insertBlock("table", { cols: 1 });
    expect(() => doc.insertBlock("paragraph", undefined, { parent: table })).toThrow(InvalidChildError);
    expect(() => doc.insertBlock("table-cell", undefined, { parent: "r" })).toThrow(InvalidChildError);
    // The canvas set: a shape at the page root, a nested surface, a frame
    // inside a frame, and a canvas type inside a table cell are all rejected.
    expect(() => doc.insertBlock("shape", { variant: "rect" })).toThrow(InvalidChildError);
    expect(() => doc.insertBlock("connector", { start: { blockId: "r" }, end: { blockId: "r" } })).toThrow(
      InvalidChildError
    );
    expect(() => doc.insertBlock("surface", undefined, { parent: doc.insertBlock("surface") })).toThrow(
      InvalidChildError
    );
    const frame = doc.insertBlock("frame", undefined, { parent: doc.insertBlock("surface") });
    expect(() => doc.insertBlock("frame", undefined, { parent: frame })).toThrow(InvalidChildError);
    const cell = doc.insertBlock("table-cell", undefined, {
      parent: doc.insertBlock("table-row", undefined, { parent: table }),
    });
    expect(() => doc.insertBlock("shape", { variant: "rect" }, { parent: cell })).toThrow(InvalidChildError);
    expect(() => doc.insertBlock("canvas-text", undefined, { parent: cell })).toThrow(InvalidChildError);
  });
});

describe("updateBlock", () => {
  it("sets and overwrites attrs, keeping the rest", () => {
    const doc = newDoc();
    const h = doc.insertBlock("heading", { level: 2 });
    doc.updateBlock(h, { level: 3 });
    expect(doc.getBlock(h)).toEqual({ type: "heading", attrs: { level: 3 } });

    const img = doc.insertBlock("image", { src: "a.png", width: 5, align: "left" });
    doc.updateBlock(img, { width: null });
    expect(doc.getBlock(img)).toEqual({ type: "image", attrs: { src: "a.png", width: null, align: "left" } });
    expect(doc.toJSON().blocks[img]).toEqual({ type: "image", attrs: { src: "a.png", width: null, align: "left" } });

    const li = doc.insertBlock("list-item", { list: "task", checked: true });
    doc.updateBlock(li, { checked: false });
    expect(doc.getBlock(li)).toEqual({ type: "list-item", attrs: { list: "task", checked: false } });
  });

  it("sets the code display attrs (the absent ones stay absent; the empty caption is the removed state)", () => {
    const doc = newDoc();
    const co = doc.insertBlock("code", { language: "ts" });
    expect(doc.getBlock(co)).toEqual({ type: "code", attrs: { language: "ts" } });
    doc.updateBlock(co, { collapsed: true, caption: "fig 1", lineNumbers: false, wrap: false, mermaidMode: "preview" });
    const attrs = {
      language: "ts",
      collapsed: true,
      caption: "fig 1",
      lineNumbers: false,
      wrap: false,
      mermaidMode: "preview",
    };
    expect(doc.getBlock(co)).toEqual({ type: "code", attrs });
    expect(doc.toJSON().blocks[co]).toEqual({ type: "code", attrs });
    doc.updateBlock(co, { caption: "" });
    expect(doc.toJSON().blocks[co]).toEqual({ type: "code", attrs: { ...attrs, caption: "" } });
  });

  it("sets the image view attrs (the caption idiom; the empty caption is the removed state)", () => {
    const doc = newDoc();
    const img = doc.insertBlock("image", { src: "a.png" });
    doc.updateBlock(img, { width: 240, align: "center", caption: "fig 1" });
    const attrs = { src: "a.png", width: 240, align: "center", caption: "fig 1" };
    expect(doc.getBlock(img)).toEqual({ type: "image", attrs });
    expect(doc.toJSON().blocks[img]).toEqual({ type: "image", attrs });
    doc.updateBlock(img, { caption: "" });
    expect(doc.toJSON().blocks[img]).toEqual({ type: "image", attrs: { ...attrs, caption: "" } });
    doc.undo();
    expect(doc.getBlock(img)).toEqual({ type: "image", attrs });
  });

  it("sets the text align on the text block types (an attr-less paragraph gains an attrs object)", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    expect(doc.getBlock(p)).toEqual({ type: "paragraph" });
    doc.updateBlock(p, { align: "center" });
    expect(doc.getBlock(p)).toEqual({ type: "paragraph", attrs: { align: "center" } });
    expect(doc.toJSON().blocks[p]).toEqual({ type: "paragraph", attrs: { align: "center" } });

    const co = doc.insertBlock("callout", { variant: "info" });
    doc.updateBlock(co, { align: "right" });
    expect(doc.getBlock(co)).toEqual({ type: "callout", attrs: { variant: "info", align: "right" } });

    // A value outside the enum is rejected (and the block keeps its old attrs).
    expect(() => doc.updateBlock(p, { align: "justify" } as unknown as BlockAttrsPatch)).toThrow(InvalidAttrsError);

    // The image view attrs' shapes (the width is positive, the align is the
    // v1 set, the caption is a string).
    const img = doc.insertBlock("image", { src: "a.png" });
    expect(() => doc.updateBlock(img, { width: 0 } as unknown as BlockAttrsPatch)).toThrow(InvalidAttrsError);
    expect(() => doc.updateBlock(img, { align: "up" } as unknown as BlockAttrsPatch)).toThrow(InvalidAttrsError);
    expect(() => doc.updateBlock(img, { caption: 42 } as unknown as BlockAttrsPatch)).toThrow(InvalidAttrsError);
    doc.updateBlock(img, { width: 320, align: "right", caption: "fig" });
    expect(validateDoc(doc.toJSON())).toEqual([]);
    expect(doc.getBlock(p)).toEqual({ type: "paragraph", attrs: { align: "center" } });
  });

  it("an empty patch is a no-op", () => {
    const doc = newDoc();
    const h = doc.insertBlock("heading", { level: 2 });
    doc.updateBlock(h, {});
    expect(doc.getBlock(h)).toEqual({ type: "heading", attrs: { level: 2 } });
  });

  it("unknown key, bad value, and attr-less type -> InvalidAttrsError", () => {
    const doc = newDoc();
    const h = doc.insertBlock("heading", { level: 2 });
    const error = expectThrows(() => doc.updateBlock(h, { level: 7 } as unknown as BlockAttrsPatch), InvalidAttrsError);
    expect(error.message).toContain("level");
    expect(() => doc.updateBlock(h, { bogus: 1 } as unknown as BlockAttrsPatch)).toThrow(InvalidAttrsError);
    const p = doc.insertBlock("paragraph");
    expect(() => doc.updateBlock(p, { src: "x" })).toThrow(InvalidAttrsError);
  });

  it("missing block -> UnknownBlockError", () => {
    expect(() => newDoc().updateBlock("nope", { level: 1 })).toThrow(UnknownBlockError);
  });
});

describe("callout color / icon (the preset + override)", () => {
  it("round-trips the color/icon overrides (incl. the explicit null stand)", () => {
    const doc = newDoc();
    const co = doc.insertBlock("callout", { variant: "warning", color: "#ff0000", icon: "lightbulb" });
    const attrs = { variant: "warning", color: "#ff0000", icon: "lightbulb" };
    expect(doc.getBlock(co)).toEqual({ type: "callout", attrs });
    expect(doc.toJSON().blocks[co]).toEqual({ type: "callout", attrs });
    // The JSON round-trip keeps the values (incl. an explicit null).
    const reloaded = fromJSON(doc.toJSON());
    expect(reloaded.getBlock(co)).toEqual({ type: "callout", attrs });
    // Clearing an override stands null (the preset), keeping the variant + the other override.
    doc.updateBlock(co, { color: null });
    expect(doc.getBlock(co)).toEqual({
      type: "callout",
      attrs: { variant: "warning", color: null, icon: "lightbulb" },
    });
    expect(doc.toJSON().blocks[co]).toEqual({
      type: "callout",
      attrs: { variant: "warning", color: null, icon: "lightbulb" },
    });
  });

  it("the preset switch (variant + the null overrides) is one transact, one undo step", () => {
    const doc = newDoc();
    const co = doc.insertBlock("callout", { variant: "info", color: "#ff0000", icon: "star" });
    // The preset switch: the new variant + the overrides reset to null in one
    // transact (the preset resets the individual overrides).
    doc.transact(() => doc.updateBlock(co, { variant: "danger", color: null, icon: null }));
    expect(doc.getBlock(co)).toEqual({ type: "callout", attrs: { variant: "danger", color: null, icon: null } });
    // One undo step restores the previous stand (the variant + the overrides).
    doc.undo();
    expect(doc.getBlock(co)).toEqual({ type: "callout", attrs: { variant: "info", color: "#ff0000", icon: "star" } });
  });

  it("the individual override keeps the variant (the preset identity), one undo each", () => {
    const doc = newDoc();
    const co = doc.insertBlock("callout", { variant: "info" });
    // An individual color override: the variant stands (the preset identity).
    doc.updateBlock(co, { color: "#00ff00" });
    expect(doc.getBlock(co)).toEqual({ type: "callout", attrs: { variant: "info", color: "#00ff00" } });
    // An individual icon override: the variant + color stand.
    doc.updateBlock(co, { icon: "heart" });
    expect(doc.getBlock(co)).toEqual({ type: "callout", attrs: { variant: "info", color: "#00ff00", icon: "heart" } });
    // One undo per individual change.
    doc.undo();
    expect(doc.getBlock(co)).toEqual({ type: "callout", attrs: { variant: "info", color: "#00ff00" } });
    doc.undo();
    expect(doc.getBlock(co)).toEqual({ type: "callout", attrs: { variant: "info" } });
  });
});

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

describe("setTitle", () => {
  it("replaces the title in meta and JSON", () => {
    const doc = newDoc();
    doc.setTitle("First");
    expect(doc.meta.title).toBe("First");
    expect(doc.toJSON().title).toBe("First");
    doc.setTitle("Second");
    expect(doc.meta.title).toBe("Second");
    doc.setTitle("");
    expect(doc.meta.title).toBe("");
    expect(doc.toJSON().title).toBe("");
  });
});

describe("setAvatar", () => {
  it("sets and clears the avatar in meta and JSON", () => {
    const doc = newDoc();
    expect(doc.meta.avatar).toBeUndefined();
    expect(doc.toJSON().avatar).toBeUndefined();
    doc.setAvatar("🦊");
    expect(doc.meta.avatar).toBe("🦊");
    expect(doc.toJSON().avatar).toBe("🦊");
    doc.setAvatar(null);
    expect(doc.meta.avatar).toBeUndefined();
    expect(doc.toJSON().avatar).toBeUndefined();
    // The empty string is the clear stand, like null.
    doc.setAvatar("x");
    doc.setAvatar("");
    expect(doc.meta.avatar).toBeUndefined();
    expect(doc.toJSON().avatar).toBeUndefined();
  });

  it("round-trips the avatar through JSON", () => {
    const doc = newDoc();
    doc.setAvatar("🦊");
    const json = doc.toJSON();
    expect(json.avatar).toBe("🦊");
    const restored = fromJSON(json);
    expect(restored.meta.avatar).toBe("🦊");
    expect(restored.toJSON().avatar).toBe("🦊");
    // The absent avatar stands off the JSON (no field).
    const bare = newDoc();
    expect("avatar" in bare.toJSON()).toBe(false);
  });

  it("one undo step per commit (the undo reverts the write, the redo reapplies)", () => {
    const doc = newDoc();
    doc.setAvatar("A");
    doc.undo();
    expect(doc.meta.avatar).toBeUndefined();
    doc.redo();
    expect(doc.meta.avatar).toBe("A");
    // The clear is its own step (the undo restores the value).
    doc.setAvatar(null);
    doc.undo();
    expect(doc.meta.avatar).toBe("A");
  });

  it("the no-op stand (the same value) writes nothing (no undo step, no wire update)", () => {
    const doc = newDoc();
    doc.setAvatar("A");
    const settled = doc.encode();
    doc.setAvatar("A"); // the no-op stand
    // The no-op stand emits no wire update (the doc's state is unchanged).
    expect(doc.encode()).toStrictEqual(settled);
    // No undo step was created by the no-op: one undo reverts the "A" write.
    doc.undo();
    expect(doc.meta.avatar).toBeUndefined();
  });

  it("reads stay plain snapshots after setAvatar", () => {
    const doc = newDoc();
    doc.setAvatar("🦊");
    const meta = doc.meta;
    expect(JSON.parse(JSON.stringify(meta))).toEqual(meta);
  });
});

describe("command guarantees", () => {
  it("same commands + injected id + counter generateId -> equal toJSON (determinism)", () => {
    const make = (): Doc => {
      let n = 0;
      return createDoc({ id: "d", createdAt: CREATED_AT, generateId: () => `b${n++}` });
    };
    const run = (doc: Doc): void => {
      const p = doc.insertBlock("paragraph");
      doc.insertText(p, 0, "hello world");
      const h = doc.insertBlock("heading", { level: 2 });
      doc.moveBlock(h, doc.meta.id, 0);
      doc.setMark(p, 0, 5, { type: "bold" });
      doc.updateBlock(h, { level: 3 });
      doc.deleteText(p, 6, 11);
      doc.setTitle("T");
    };
    const first = make();
    const second = make();
    run(first);
    run(second);
    expect(first.toJSON()).toEqual(second.toJSON());
  });

  it("reads stay plain snapshots after commands", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "ab", { bold: true });
    doc.insertText(p, 2, "cd");
    doc.setMark(p, 0, 4, { type: "color", value: "#112233" });
    const block = doc.getBlock(p);
    expect(block).not.toBeNull();
    expect(JSON.parse(JSON.stringify(block))).toEqual(block);
    expect(JSON.parse(JSON.stringify(doc.getRuns(p)))).toEqual(doc.getRuns(p));
    expect(JSON.parse(JSON.stringify(doc.toJSON()))).toEqual(doc.toJSON());
  });

  it("no-op commands emit zero updates", () => {
    const doc = newDoc();
    const h = doc.insertBlock("heading", { level: 2 });
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "abc");
    const before = doc.encode().byteLength;
    doc.updateBlock(h, {}); // empty patch
    doc.insertText(p, 1, ""); // empty text
    doc.deleteText(p, 1, 1); // from === to, in range
    doc.setMark(p, 1, 1, { type: "bold" }); // from === to, in range
    doc.unsetMark(p, 1, 1, "bold");
    expect(doc.encode().byteLength).toBe(before);
  });
});
