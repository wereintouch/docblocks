// @vitest-environment jsdom
// The canvas placement commands (the dock's tools): each tool lands one
// block (plus its geometry) in one transact on the first surface
// (created when the document has none); the connector picks two siblings
// of the same surface; the pen stroke maps to the bbox geometry + the
// local points; the drag-to-size place's box (the shift's 1:1).
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";

import {
  DEFAULT_SHAPE_FILL,
  placeCanvasText,
  placeConnector,
  placeFrame,
  placePenStroke,
  placeShape,
} from "../src/canvas/insert";
import { placeDragBox } from "../src/canvas/viewport/utils";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

function newDoc(): TestDoc {
  return createDoc({ id: "placement-doc", createdAt: CREATED_AT });
}

afterEach(cleanup);

describe("placeShape", () => {
  it("creates the surface and the shape (geometry at the point) in one transact", () => {
    const doc = newDoc();
    const id = placeShape(doc, "ellipse", { x: 12, y: -8 }, { w: 100, h: 80 });
    const block = doc.getBlock(id);
    const shape = block?.type === "shape" ? block : null;
    expect(shape).not.toBeNull();
    expect(shape?.attrs).toEqual({ variant: "ellipse", fill: DEFAULT_SHAPE_FILL, zIndex: 1 });
    expect(shape?.geometry).toEqual({ x: 12, y: -8, w: 100, h: 80 });
    // The target: the (created) first surface — the only root child (a
    // fresh doc has no page blocks: the starter paragraph is the consumer's).
    const root = doc.getBlock(doc.meta.id);
    if (root === null || root.type !== "root") throw new Error("the root block is missing");
    expect(root.children).toHaveLength(1);
    expect(doc.getChildren(root.children[0]!)).toEqual([id]);
    // One undo step: the whole placement is a single transact.
    doc.undo();
    expect(doc.getBlock(id)).toBeNull();
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("reuses an existing surface", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const id = placeShape(doc, "diamond", { x: 0, y: 0 }, { w: 90, h: 90 });
    expect(doc.getChildren(surface)).toEqual([id]);
    expect(doc.getChildren(doc.meta.id)).toHaveLength(1); // no second surface
  });
});

describe("placeCanvasText", () => {
  it("lands the canvas-text with the default size at the point", () => {
    const doc = newDoc();
    const id = placeCanvasText(doc, { x: 20, y: 30 }, { w: 200, h: 40 });
    expect(doc.getBlock(id)?.type).toBe("canvas-text");
    expect(doc.getBlock(id)?.geometry).toEqual({ x: 20, y: 30, w: 200, h: 40 });
    doc.undo();
    expect(doc.getBlock(id)).toBeNull();
  });
});

describe("placeFrame", () => {
  it("lands the childless frame (one transact — the window's content stands on the surface)", () => {
    const doc = newDoc();
    const id = placeFrame(doc, { x: -40, y: 10 }, { w: 320, h: 240 });
    const frame = doc.getBlock(id);
    expect(frame?.type).toBe("frame");
    expect(frame?.geometry).toEqual({ x: -40, y: 10, w: 320, h: 240 });
    // The frame is childless (the starter-paragraph's stand is gone — the
    // window's content stands on the frame's own surface).
    expect(doc.getChildren(id)).toEqual([]);
    doc.undo();
    expect(doc.getBlock(id)).toBeNull();
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });
});

describe("placeConnector", () => {
  it("creates the connector between two siblings of the same surface", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    const id = placeConnector(doc, a, b);
    const raw = doc.getBlock(id);
    const connector = raw?.type === "connector" ? raw : null;
    expect(connector).not.toBeNull();
    expect(connector?.attrs).toEqual({ start: { blockId: a }, end: { blockId: b }, zIndex: 3 });
    expect(doc.getChildren(surface)).toEqual([a, b, id]);
    doc.undo();
    expect(doc.getBlock(id)).toBeNull();
  });

  it("rejects a cross-surface pair and creates nothing", () => {
    const doc = newDoc();
    const s1 = doc.insertBlock("surface");
    const s2 = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: s1 });
    const b = doc.insertBlock("shape", { variant: "rect" }, { parent: s2 });
    const before = doc.toJSON();
    expect(() => placeConnector(doc, a, b)).toThrow(/same surface/);
    expect(doc.toJSON()).toEqual(before);
  });
});

describe("placePenStroke", () => {
  it("lands the shape with the bbox geometry and the local points", () => {
    const doc = newDoc();
    const id = placePenStroke(doc, {
      geometry: { x: 10, y: 5, w: 24, h: 10 },
      points: [
        [0, 0],
        [12, 10],
        [24, 0],
      ],
    });
    const block = doc.getBlock(id);
    const shape = block?.type === "shape" ? block : null;
    expect(shape).not.toBeNull();
    expect(shape?.attrs).toEqual({
      variant: "rect",
      points: [
        [0, 0],
        [12, 10],
        [24, 0],
      ],
      zIndex: 1,
    });
    expect(shape?.geometry).toEqual({ x: 10, y: 5, w: 24, h: 10 });
    doc.undo();
    expect(doc.getBlock(id)).toBeNull();
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });
});

describe("placeDragBox (the drag-to-size place's box — the shift's 1:1)", () => {
  const START = { x: 0, y: 0 };

  it("the free drag (no shift) stands the drag's extent W×H", () => {
    expect(placeDragBox(START, { x: 120, y: 80 }, false)).toEqual({ x: 60, y: 40, w: 120, h: 80 });
    // The symmetric scene (the negative spans — the abs's stand).
    expect(placeDragBox(START, { x: -90, y: -40 }, false)).toEqual({ x: -45, y: -20, w: 90, h: 40 });
  });

  it("the shift stands the square (W = H) — the larger span wins (both drag directions)", () => {
    // dx > dy: the square's side is dx.
    expect(placeDragBox(START, { x: 120, y: 80 }, true)).toEqual({ x: 60, y: 40, w: 120, h: 120 });
    // dy > dx: the square's side is dy (the vertical drag's winner).
    expect(placeDragBox(START, { x: 40, y: 200 }, true)).toEqual({ x: 20, y: 100, w: 200, h: 200 });
    // The center is the drag's midpoint (the constraint stands the size, not the anchor).
    expect(placeDragBox(START, { x: -100, y: 60 }, true)).toEqual({ x: -50, y: 30, w: 100, h: 100 });
  });

  it("the live shift toggle over the same input (the constraint stands / drops)", () => {
    const drag = { x: 120, y: 80 };
    expect(placeDragBox(START, drag, false)).toEqual({ x: 60, y: 40, w: 120, h: 80 });
    expect(placeDragBox(START, drag, true)).toEqual({ x: 60, y: 40, w: 120, h: 120 });
    // The toggle back: the free box stands again (the same input).
    expect(placeDragBox(START, drag, false)).toEqual({ x: 60, y: 40, w: 120, h: 80 });
  });

  it("the 1 px floor stands over the degenerate drag (a zero extent commits a 1 px figure)", () => {
    expect(placeDragBox(START, { x: 0, y: 0 }, false)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(placeDragBox(START, { x: 0, y: 0 }, true)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    // A sub-px drag stands the 1 px floor (the w / h never stand 0).
    expect(placeDragBox(START, { x: 0.4, y: 0.2 }, false)).toEqual({ x: 0.2, y: 0.1, w: 1, h: 1 });
  });
});
