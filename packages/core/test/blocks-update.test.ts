import { describe, expect, it } from "vitest";

import { DocBlocksError, InvalidAttrsError, UnknownBlockError, createDoc, fromJSON } from "../src/core";
import type { Doc } from "../src/core";
import type { BlockAttrsPatch } from "../src/schema";
import { BLOCK_REGISTRY, PAGE_BLOCK_TYPES, validateDoc } from "../src/schema";

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

describe("the frame registry shape (the viewport window)", () => {
  it("the frame is childless (no nested page, no sequence) and carries the context attrs", () => {
    const spec = BLOCK_REGISTRY.frame;
    expect(spec.content).toBe(false);
    expect(spec.children).toBe(false);
    expect(spec.childrenTypes).toBeUndefined();
    expect(spec.legacyChildrenTypes).toBeUndefined();
    expect(spec.sequence, "the frame is not a page sequence (the window is childless)").toBeFalsy();
    expect(spec.attrs?.title).toEqual({ kind: "string" });
    expect(spec.attrs?.frameId).toEqual({ kind: "string", nonEmpty: true });
    // The canvas-text's text style attrs (the shape's text parity).
    expect(BLOCK_REGISTRY["canvas-text"].attrs?.textColor).toEqual({ kind: "string", hexColor: true });
    expect(BLOCK_REGISTRY["canvas-text"].attrs?.textStyle).toEqual({
      kind: "enum",
      values: ["regular", "semibold", "light", "light-italic", "italic", "semibold-italic"],
    });
  });

  it("the type lists: the frame in the page set (the root's children set), once in the surface element set", () => {
    expect(PAGE_BLOCK_TYPES).toContain("frame");
    // The root's children set is the page set: the page-frame block stands
    // in the page flow.
    expect([...(BLOCK_REGISTRY.root.childrenTypes ?? [])]).toEqual([...PAGE_BLOCK_TYPES]);
    // The surface element set: the page set (minus the surface) + the
    // canvas-only types — the frame stands exactly once (with the page set;
    // the former FRAME_ELEMENT_TYPES is gone — the frame carries no
    // children).
    const surfaceSet = [...(BLOCK_REGISTRY.surface.childrenTypes ?? [])];
    expect(surfaceSet.filter((type) => type === "frame")).toEqual(["frame"]);
    expect(surfaceSet).not.toContain("surface");
    expect(surfaceSet).toEqual([
      ...PAGE_BLOCK_TYPES.filter((type) => type !== "surface"),
      "shape",
      "connector",
      "canvas-text",
      "group",
    ]);
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

  it("rejects a non-finite numeric attr (the mutation path, like the import path)", () => {
    const doc = newDoc();
    const img = doc.insertBlock("image", { src: "a.png" });
    // Infinity / -Infinity / NaN are not representable in JSON and would hand
    // an infinite size to the renderer; the command stands a typed error.
    expect(() => doc.updateBlock(img, { width: Infinity })).toThrow(InvalidAttrsError);
    expect(() => doc.updateBlock(img, { width: -Infinity })).toThrow(InvalidAttrsError);
    expect(() => doc.updateBlock(img, { width: NaN })).toThrow(InvalidAttrsError);
    expect(() => doc.updateBlock(img, { width: Infinity })).toThrow(/finite number/);
    // The rejected patch is a no-op: the block keeps its prior attrs.
    expect(doc.getBlock(img)).toEqual({ type: "image", attrs: { src: "a.png" } });
    // The array-item path (the table's columnWidths) is gated the same way.
    const table = doc.insertBlock("table", { cols: 1 });
    expect(() => doc.updateBlock(table, { columnWidths: [Infinity] })).toThrow(InvalidAttrsError);
    // insertBlock validates the same way (a non-finite width is rejected).
    expect(() => doc.insertBlock("image", { src: "b.png", width: Infinity })).toThrow(InvalidAttrsError);
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

  it("stores only the file id in a file block", () => {
    const doc = newDoc();
    const file = doc.insertBlock("file", { fileId: "file-1" });
    expect(doc.getBlock(file)).toEqual({ type: "file", attrs: { fileId: "file-1" } });
    expect(doc.toJSON().blocks[file]).toEqual({ type: "file", attrs: { fileId: "file-1" } });

    doc.updateBlock(file, { fileId: "file-2" });
    expect(doc.getBlock(file)).toEqual({ type: "file", attrs: { fileId: "file-2" } });
    doc.undo();
    expect(doc.getBlock(file)).toEqual({ type: "file", attrs: { fileId: "file-1" } });
    expect(() => doc.updateBlock(file, { fileId: "" })).toThrow(InvalidAttrsError);
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

  it("the table's positional columnWidths stand identity-keyed (prior widths survive, the read derivation stands)", () => {
    const doc = newDoc();
    const table = doc.insertBlock("table", { cols: 3 });
    const widths = (): number[] => {
      const block = doc.getBlock(table)!;
      return block.type === "table" ? (block.attrs?.columnWidths ?? []) : [];
    };
    // Two explicit widths (the identity-keyed storage), the middle column at the default.
    doc.setTableColumnWidth(table, 0, 150);
    doc.setTableColumnWidth(table, 2, 250);
    expect(widths()).toEqual([150, 100, 250]);
    // The positional patch maps onto the column ids: the read derivation sees
    // the new values (a positional Y.Array storage would stand all defaults).
    doc.updateBlock(table, { columnWidths: [120, 180, 220] });
    expect(widths()).toEqual([120, 180, 220]);
    // The storage stays identity-keyed: the per-column command still rides its
    // column id over the whole set.
    doc.setTableColumnWidth(table, 1, 300);
    expect(widths()).toEqual([120, 300, 220]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
    const reloaded = fromJSON(doc.toJSON());
    expect(reloaded.getBlock(table)!).toMatchObject({ type: "table", attrs: { columnWidths: [120, 300, 220] } });
    // A width count off from the column set is rejected (the strict
    // validator's one-width-per-column rule, kept live by the command).
    expect(() => doc.updateBlock(table, { columnWidths: [100, 100] })).toThrow(InvalidAttrsError);
    expect(widths()).toEqual([120, 300, 220]);
  });
});
