import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { InvalidChildError } from "../src/core";
import { validateDoc } from "../src/schema";
import { newDoc } from "./canvas.helpers";

describe("structure (commands)", () => {
  it("the surface holds the canvas element set; moveBlock within the children is the z-order change", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const shape = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const text = doc.insertBlock("canvas-text", undefined, { parent: surface });
    const frame = doc.insertBlock("frame", undefined, { parent: surface });

    expect(doc.getChildren(surface)).toEqual([shape, text, frame]);
    // The z-order: move the first element to the back (the pre-move index
    // semantics, like any other parent: toIndex === toLength appends).
    doc.moveBlock(shape, surface, 3);
    expect(doc.getChildren(surface)).toEqual([text, frame, shape]);
    doc.moveBlock(frame, surface, 0);
    expect(doc.getChildren(surface)).toEqual([frame, text, shape]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("removeBlock cascades the canvas subtree; the frame removal is a plain removal (no children to cascade)", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const frame = doc.insertBlock("frame", { title: "Frame" }, { parent: surface });
    const shape = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });

    // The frame is a viewport window: its removal is a plain single-block
    // removal (no nested page to cascade).
    doc.removeBlock(frame);
    expect(doc.getBlock(frame)).toBeNull();
    expect(doc.getChildren(surface)).toEqual([shape]);

    // The surface removal cascades the canvas elements.
    doc.removeBlock(surface);
    expect(doc.getBlock(surface)).toBeNull();
    expect(doc.getBlock(shape)).toBeNull();
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("canvas-text is a text block: runs live in its content", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const text = doc.insertBlock("canvas-text", undefined, { parent: surface });
    doc.insertText(text, 0, "hello canvas");
    doc.setMark(text, 0, 5, { type: "bold" });

    expect(doc.getText(text)).toBe("hello canvas");
    const block = doc.getBlock(text);
    expect(block).not.toBeNull();
    expect(block?.type).toBe("canvas-text");
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("the frame is a viewport window: the context attrs, the geometry, no children, the zIndex's parity", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const frame = doc.insertBlock("frame", { title: "Camera" }, { parent: surface });
    doc.setGeometry(frame, { x: -80, y: -40, w: 320, h: 240 });

    // The canvas frame: the title label + the geometry + the z-order's
    // index (the first-class's parity over the canvas elements — the
    // paint position's mirror); no children (the window content is the
    // surface's own).
    expect(doc.getChildren(frame)).toEqual([]);
    expect(doc.getBlock(frame)).toEqual({
      type: "frame",
      attrs: { title: "Camera", zIndex: 1 },
      geometry: { x: -80, y: -40, w: 320, h: 240 },
    });

    // The page-frame block: a root child with the frameId reference to the
    // canvas frame (no title in the page context).
    const pageFrame = doc.insertBlock("frame", { frameId: frame });
    expect(doc.getChildren("r")).toContain(pageFrame);
    expect(doc.getBlock(pageFrame)).toEqual({ type: "frame", attrs: { frameId: frame } });

    // The attrs are editable per context (updateBlock).
    doc.updateBlock(frame, { title: "Camera 2" });
    doc.updateBlock(pageFrame, { frameId: frame });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("inserting into a frame is rejected (the frame carries no children)", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const frame = doc.insertBlock("frame", { title: "Camera" }, { parent: surface });

    expect(() => doc.insertBlock("paragraph", undefined, { parent: frame })).toThrow(InvalidChildError);
    expect(doc.getChildren(frame)).toEqual([]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });
});

describe("group (the flat marker)", () => {
  it("the registry shape: the group is a surface element with the required members array", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });

    const group = doc.insertBlock("group", { members: [a, b] }, { parent: surface });
    expect(doc.getBlock(group)).toEqual({ type: "group", attrs: { members: [a, b], zIndex: 3 } });
    expect(doc.getChildren(surface)).toEqual([a, b, group]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("the members are weak refs: the membership edits stand the updateBlock patch (one transact)", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const c = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const group = doc.insertBlock("group", { members: [a] }, { parent: surface });

    doc.updateBlock(group, { members: [a, b, c] });
    expect(doc.getBlock(group)).toMatchObject({ attrs: { members: [a, b, c] } });
    // The dissolve at the data level: the group entry goes, the members stand.
    doc.removeBlock(group);
    expect(doc.getBlock(group)).toBeNull();
    for (const id of [a, b, c]) expect(doc.getBlock(id)).not.toBeNull();
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("the strict validator: the members shape and the title attr (the container)", () => {
    // A malformed members (raw write — the wire's newer-minor / corrupt data):
    const source = newDoc();
    const surface = source.insertBlock("surface");
    const a = source.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const group = source.insertBlock("group", { members: [a] }, { parent: surface });
    source.raw.transact(() => {
      const block = source.raw.getMap("blocks").get(group) as Y.Map<unknown>;
      (block.get("attrs") as Y.Map<unknown>).set("members", "a"); // not an array
    });
    const badShape = validateDoc(source.toJSON());
    expect(badShape.some((entry) => entry.path === `blocks.${group}.attrs.members`)).toBe(true);

    // The title attr (a string; the empty-string convention) + the group's
    // own geometry stand clean.
    const source2 = newDoc();
    const surface2 = source2.insertBlock("surface");
    const a2 = source2.insertBlock("shape", { variant: "rect" }, { parent: surface2 });
    const group2 = source2.insertBlock("group", { members: [a2], title: "container" }, { parent: surface2 });
    source2.setGeometry(group2, { x: 0, y: 0, w: 100, h: 50 });
    expect(validateDoc(source2.toJSON())).toEqual([]);
    // A non-string title is rejected.
    source2.raw.transact(() => {
      const block = source2.raw.getMap("blocks").get(group2) as Y.Map<unknown>;
      (block.get("attrs") as Y.Map<unknown>).set("title", 42); // not a string
    });
    const badTitle = validateDoc(source2.toJSON());
    expect(badTitle.some((entry) => entry.path === `blocks.${group2}.attrs.title`)).toBe(true);
  });

  it("the group is canvas-only: not a page child, not a cell child", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    expect(() => doc.insertBlock("group", { members: [a] })).toThrow(InvalidChildError); // the root's page set
    const table = doc.insertBlock("table", { cols: 2 });
    const row = doc.getChildren(table)[0]!;
    const cell = doc.getChildren(row)[0]!;
    expect(() => doc.insertBlock("group", { members: [a] }, { parent: cell })).toThrow(InvalidChildError);
  });

  it("the lenient read keeps a dangling member (the weak ref posture)", () => {
    const source = newDoc();
    const surface = source.insertBlock("surface");
    const a = source.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const ghost = source.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const group = source.insertBlock("group", { members: [a, ghost] }, { parent: surface });
    source.removeBlock(ghost); // the member vanishes (the race / the dissolve of another group)

    const target = newDoc();
    target.applyUpdate(source.encode());
    // The entry stands with the dangling id (the data is not rewritten);
    // the tree reads are unaffected (the group has no children of its own).
    expect(target.getBlock(group)).toMatchObject({ type: "group", attrs: { members: [a, ghost] } });
    expect(target.getChildren(surface)).toContain(group);
  });
});
