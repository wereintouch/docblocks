import { describe, expect, it } from "vitest";

import {
  DetachedBlockError,
  DocBlocksError,
  InvalidAttrsError,
  InvalidChildError,
  InvalidOperationError,
  UnknownBlockError,
  UnknownBlockTypeError,
  createDoc,
  fromJSON,
} from "../src/core";
import type { Doc } from "../src/core";
import type { CanvasRef, HeadingAttrs, ShapeAttrs } from "../src/schema";
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
    const file = doc.insertBlock("file", { fileId: "file-1" });
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

    expect(doc.getChildren("r")).toEqual([
      p,
      h,
      li,
      q,
      c,
      code,
      table,
      image,
      file,
      embed,
      sync,
      database,
      divider,
      surface,
    ]);
    expect(doc.getChildren(table)).toEqual([row]);
    expect(doc.getChildren(row)).toEqual([c1, c2]);
    expect(doc.getChildren(surface)).toEqual([shape, connector, frame, canvasText]);
    expect(doc.getBlock(h)).toEqual({ type: "heading", attrs: { level: 1 } });
    expect(doc.getBlock(li)).toEqual({ type: "list-item", attrs: { list: "bullet" } });
    expect(doc.getBlock(q)).toEqual({ type: "quote", attrs: { align: "center" } });
    expect(doc.getBlock(image)).toEqual({ type: "image", attrs: { src: "blobs/x.png" } });
    expect(doc.getBlock(file)).toEqual({ type: "file", attrs: { fileId: "file-1" } });
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
    expect(doc.getBlock(frame)).toEqual({ type: "frame", attrs: { zIndex: 3 } });
    expect(doc.getBlock(canvasText)).toEqual({ type: "canvas-text", attrs: { zIndex: 4 } });
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
    const error = expectThrows(() => (doc.insertBlock as (type: string) => string)("bogus"), UnknownBlockTypeError);
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
    // The canvas set: a shape at the page root, a nested surface, an insert
    // into a frame (the window is childless), and a canvas type inside a
    // table cell are all rejected.
    expect(() => doc.insertBlock("shape", { variant: "rect" })).toThrow(InvalidChildError);
    expect(() => doc.insertBlock("connector", { start: { blockId: "r" }, end: { blockId: "r" } })).toThrow(
      InvalidChildError
    );
    expect(() => doc.insertBlock("surface", undefined, { parent: doc.insertBlock("surface") })).toThrow(
      InvalidChildError
    );
    const frame = doc.insertBlock("frame", undefined, { parent: doc.insertBlock("surface") });
    expect(() => doc.insertBlock("paragraph", undefined, { parent: frame })).toThrow(InvalidChildError);
    expect(() => doc.insertBlock("frame", undefined, { parent: frame })).toThrow(InvalidChildError);
    const cell = doc.insertBlock("table-cell", undefined, {
      parent: doc.insertBlock("table-row", undefined, { parent: table }),
    });
    expect(() => doc.insertBlock("shape", { variant: "rect" }, { parent: cell })).toThrow(InvalidChildError);
    expect(() => doc.insertBlock("canvas-text", undefined, { parent: cell })).toThrow(InvalidChildError);
  });
});
