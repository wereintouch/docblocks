// @vitest-environment node
// The canvas view's viewport culling (the off-viewport items' stand): the
// visible world rect's math and the cull set's computation (the visible
// ids over the surfaces' children, the keep set's members, the
// connector's endpoint's boxes' union).
import { describe, expect, it } from "vitest";

import type { Block, BlockId, CanvasRef } from "docblocks-core";

import { CULL_MARGIN_PX, computeCulling, visibleWorldRectOf } from "../src/canvas/canvas-view/culling";

function shape(id: BlockId, x: number, y: number, w = 100, h = 100): Block {
  return { type: "shape", attrs: { variant: "rect" }, geometry: { x, y, w, h } };
}

function connector(start: CanvasRef, end: CanvasRef): Block {
  return { type: "connector", attrs: { start, end } };
}

describe("visibleWorldRectOf", () => {
  it("maps the container's screen rect to the canvas rect (the zoom / pan's stand)", () => {
    // zoom 1, pan 0, the container's 1000x800: the visible canvas rect is
    // the center-relative -500..500 x -400..400 over the margin.
    expect(visibleWorldRectOf(1, { x: 0, y: 0 }, { width: 1000, height: 800 }, 100)).toEqual({
      left: -600,
      top: -500,
      width: 1200,
      height: 1000,
    });
  });

  it("divides by the zoom and shifts over the pan", () => {
    // zoom 2, pan (10, 0): the screen's left edge (-500) → the canvas's
    // (-500 - 10) / 2 = -255, the right edge's 500 → 245.
    expect(visibleWorldRectOf(2, { x: 10, y: 0 }, { width: 1000, height: 800 }, 0)).toEqual({
      left: -255,
      top: -200,
      width: 500,
      height: 400,
    });
  });

  it("stands null over the unknown container size (no cull)", () => {
    expect(visibleWorldRectOf(1, { x: 0, y: 0 }, { width: 0, height: 800 }, 100)).toBeNull();
  });
});

describe("computeCulling", () => {
  const visible = { left: -600, top: -500, width: 1200, height: 1000 }; // the margin's 100

  it("keeps the in-viewport items and drops the off-viewport ones", () => {
    const blocks: Record<BlockId, Block> = {
      inside: shape("inside", 0, 0),
      far: shape("far", 5000, 0),
      edge: shape("edge", 550, 0), // within the margin band (600 - 550 < 300)
    };
    const set = computeCulling(visible, [{ id: "s", children: ["inside", "far", "edge"] }], blocks, new Set());
    expect(set.has("inside")).toBe(true);
    expect(set.has("far")).toBe(false);
    expect(set.has("edge")).toBe(true);
  });

  it("keeps the keep set's members (the in-flight session's items) over any distance", () => {
    const blocks: Record<BlockId, Block> = { a: shape("a", 9999, 0) };
    const set = computeCulling(visible, [{ id: "s", children: ["a"] }], blocks, new Set(["a"]));
    expect(set.has("a")).toBe(true);
  });

  it("keeps the absent blocks (the lenient stand over the CRDT's race residue)", () => {
    const set = computeCulling(visible, [{ id: "s", children: ["ghost"] }], {}, new Set());
    expect(set.has("ghost")).toBe(true);
  });

  it("culls the connector whose both endpoints stand off-viewport (the boxes' union over the margin)", () => {
    const blocks: Record<BlockId, Block> = {
      a: shape("a", 5000, 0),
      b: shape("b", 5100, 0),
      line: connector({ blockId: "a" }, { blockId: "b" }),
    };
    const set = computeCulling(visible, [{ id: "s", children: ["a", "b", "line"] }], blocks, new Set());
    expect(set.has("line")).toBe(false);
  });

  it("keeps the connector with an endpoint in the viewport", () => {
    const blocks: Record<BlockId, Block> = {
      a: shape("a", 0, 0),
      b: shape("b", 5000, 0),
      line: connector({ blockId: "a" }, { blockId: "b" }),
    };
    const set = computeCulling(visible, [{ id: "s", children: ["a", "b", "line"] }], blocks, new Set());
    expect(set.has("line")).toBe(true);
  });

  it("keeps the connector with a free point (the zero box over the point)", () => {
    const blocks: Record<BlockId, Block> = {
      a: shape("a", 0, 0),
      line: connector({ blockId: "a" }, { x: 8000, y: 0 }),
    };
    const set = computeCulling(visible, [{ id: "s", children: ["a", "line"] }], blocks, new Set());
    expect(set.has("line")).toBe(true); // the endpoint's a stands in the viewport
  });

  it("keeps the unresolvable connector (no cull over the data's missing)", () => {
    const blocks: Record<BlockId, Block> = { line: connector({ blockId: "absent" }, { blockId: "absent2" }) };
    const set = computeCulling(visible, [{ id: "s", children: ["line"] }], blocks, new Set());
    expect(set.has("line")).toBe(true);
  });

  it("expands over the margin constant (the 300 canvas px stand)", () => {
    // the item's box's edge at 600 (the box's center 550 + 50): the
    // visible's edge at 600 — the box touches the edge, kept.
    const set = computeCulling(visible, [{ id: "s", children: ["near"] }], { near: shape("near", 550, 0) }, new Set());
    expect(CULL_MARGIN_PX).toBe(300);
    expect(set.has("near")).toBe(true);
    // the 400px gap stands beyond the margin's band (the box's left edge
    // at 950 over the visible's right edge at 600 + the 300 margin)
    const set2 = computeCulling(visible, [{ id: "s", children: ["far"] }], { far: shape("far", 1000, 0) }, new Set());
    expect(set2.has("far")).toBe(false);
  });
});
