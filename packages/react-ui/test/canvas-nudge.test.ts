// The canvas arrow-key nudge: the
// direction's delta over the named step constants (the Shift multiplier),
// the gate (the canvas's blocks selection over no in-flight gesture), and
// the commit (the move session's target contract — the connector stands
// the target out, the container stands the unit; one transact — one undo
// step, one wire update; the targetless selection stands no transact).
import { describe, expect, it } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";
import type { BlockId, Doc, Selection } from "docblocks-core";

import { NUDGE_KEYS, nudgeDelta, nudgeGate, nudgeSelection } from "../src/canvas/nudge";
import { NUDGE_SHIFT_MULTIPLIER, NUDGE_STEP_PX } from "../src/canvas/viewport/constants";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/**
 * The scene: the surface with two shapes (A at (-100, 0) / B at (100, 0)),
 * a geometry-less shape P (the default box's stand), a container G over A
 * + B (the own box), and a connector C A → B (the targetless stand).
 */
function scene(): { doc: Doc; surface: BlockId; a: BlockId; b: BlockId; p: BlockId; g: BlockId; c: BlockId } {
  const doc = createDoc({ id: "nudge-doc", createdAt: CREATED_AT });
  const surface = doc.insertBlock("surface");
  const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(a, { x: -100, y: 0, w: 50, h: 50 });
  const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
  doc.setGeometry(b, { x: 100, y: 0, w: 50, h: 50 });
  const p = doc.insertBlock("shape", { variant: "diamond" }, { parent: surface });
  const g = doc.insertBlock("group", { members: [a, b] }, { parent: surface });
  doc.setGeometry(g, { x: 0, y: 0, w: 300, h: 100 });
  const c = doc.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
  return { doc, surface, a, b, p, g, c };
}

const NO_FLAGS = {
  move: false,
  resize: false,
  pan: false,
  endpoint: false,
  marquee: false,
  pen: false,
  place: false,
  tool: false,
  pending: false,
};

const BLOCKS_SELECTION: Selection = { kind: "blocks", ids: ["a"], anchorId: "a" };

describe("nudgeDelta", () => {
  it("stands the direction's delta over the step constants", () => {
    expect(nudgeDelta("ArrowLeft", false)).toEqual({ dx: -NUDGE_STEP_PX, dy: 0 });
    expect(nudgeDelta("ArrowRight", false)).toEqual({ dx: NUDGE_STEP_PX, dy: 0 });
    expect(nudgeDelta("ArrowUp", false)).toEqual({ dx: 0, dy: -NUDGE_STEP_PX });
    expect(nudgeDelta("ArrowDown", false)).toEqual({ dx: 0, dy: NUDGE_STEP_PX });
  });

  it("stands the shift's multiplier (the 50 px stand)", () => {
    const step = NUDGE_STEP_PX * NUDGE_SHIFT_MULTIPLIER;
    expect(nudgeDelta("ArrowLeft", true)).toEqual({ dx: -step, dy: 0 });
    expect(nudgeDelta("ArrowRight", true)).toEqual({ dx: step, dy: 0 });
    expect(nudgeDelta("ArrowUp", true)).toEqual({ dx: 0, dy: -step });
    expect(nudgeDelta("ArrowDown", true)).toEqual({ dx: 0, dy: step });
  });

  it("stands null over the non-nudge keys", () => {
    expect(NUDGE_KEYS).toEqual(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
    expect(nudgeDelta("a", false)).toBeNull();
    expect(nudgeDelta("Escape", false)).toBeNull();
    expect(nudgeDelta("", true)).toBeNull();
  });
});

describe("nudgeGate", () => {
  it("stands the canvas's blocks selection over no gesture", () => {
    expect(nudgeGate(NO_FLAGS, BLOCKS_SELECTION)).toBe(true);
    expect(nudgeGate(NO_FLAGS, { kind: "blocks", ids: ["a", "b"], anchorId: "a" })).toBe(true);
  });

  it("stands no nudge over the absent / empty / non-blocks selection", () => {
    expect(nudgeGate(NO_FLAGS, null)).toBe(false);
    expect(nudgeGate(NO_FLAGS, { kind: "none" })).toBe(false);
    expect(nudgeGate(NO_FLAGS, { kind: "blocks", ids: [], anchorId: "a" })).toBe(false);
    expect(nudgeGate(NO_FLAGS, { kind: "text", from: { blockId: "a", offset: 0 }, to: null })).toBe(false);
  });

  it("yields to each in-flight gesture flag", () => {
    const flags = Object.keys(NO_FLAGS) as (keyof typeof NO_FLAGS)[];
    for (const flag of flags) {
      expect(nudgeGate({ ...NO_FLAGS, [flag]: true }, BLOCKS_SELECTION)).toBe(false);
    }
  });
});

describe("nudgeSelection", () => {
  it("nudges each selected shape by the delta (one transact — the undo reverts, the redo stands back)", () => {
    const { doc, a, b } = scene();
    const nudged = nudgeSelection(doc, [a, b], -NUDGE_STEP_PX, 0);
    expect(nudged).toEqual([a, b]);
    expect(doc.getBlock(a)?.geometry).toEqual({ x: -110, y: 0, w: 50, h: 50 });
    expect(doc.getBlock(b)?.geometry).toEqual({ x: 90, y: 0, w: 50, h: 50 });
    // The one transact: the undo reverts the whole nudge (both items),
    // the redo stands it back.
    doc.undo();
    expect(doc.getBlock(a)?.geometry).toEqual({ x: -100, y: 0, w: 50, h: 50 });
    expect(doc.getBlock(b)?.geometry).toEqual({ x: 100, y: 0, w: 50, h: 50 });
    doc.redo();
    expect(doc.getBlock(a)?.geometry).toEqual({ x: -110, y: 0, w: 50, h: 50 });
    expect(doc.getBlock(b)?.geometry).toEqual({ x: 90, y: 0, w: 50, h: 50 });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("stands the default box over the geometry-less item (the move's complete-patch contract)", () => {
    const { doc, p } = scene();
    const nudged = nudgeSelection(doc, [p], 0, -NUDGE_STEP_PX);
    expect(nudged).toEqual([p]);
    expect(doc.getBlock(p)?.geometry).toEqual({ x: 0, y: -10, w: 100, h: 100 });
  });

  it("stands the connectors out (never a target)", () => {
    const { doc, a, c } = scene();
    const nudged = nudgeSelection(doc, [a, c], NUDGE_STEP_PX, 0);
    expect(nudged).toEqual([a]);
    expect(doc.getBlock(c)).not.toBeNull(); // the connector stands
    expect(doc.getBlock(c)?.geometry).toBeUndefined(); // untouched
  });

  it("stands the container's unit (the group + the members ride the one delta, one undo step)", () => {
    const { doc, a, b, g } = scene();
    const nudged = nudgeSelection(doc, [g], -NUDGE_STEP_PX * NUDGE_SHIFT_MULTIPLIER, 0);
    // The unit: the container + its members (the absolute coordinates
    // shift the one delta).
    expect(nudged).toEqual([g, a, b]);
    expect(doc.getBlock(g)?.geometry).toEqual({ x: -50, y: 0, w: 300, h: 100 });
    expect(doc.getBlock(a)?.geometry).toEqual({ x: -150, y: 0, w: 50, h: 50 });
    expect(doc.getBlock(b)?.geometry).toEqual({ x: 50, y: 0, w: 50, h: 50 });
    // The one transact over the unit: the undo reverts all three.
    doc.undo();
    expect(doc.getBlock(g)?.geometry).toEqual({ x: 0, y: 0, w: 300, h: 100 });
    expect(doc.getBlock(a)?.geometry).toEqual({ x: -100, y: 0, w: 50, h: 50 });
    expect(doc.getBlock(b)?.geometry).toEqual({ x: 100, y: 0, w: 50, h: 50 });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("stands the no-op over the targetless selection (no transact — the feed stands)", () => {
    const { doc, c } = scene();
    let changes = 0;
    const off = doc.onChange(() => {
      changes += 1;
    });
    expect(nudgeSelection(doc, [c], NUDGE_STEP_PX, 0)).toBeNull();
    expect(changes).toBe(0);
    off();
  });

  it("dedupes the repeated ids (the delta stands once)", () => {
    const { doc, a } = scene();
    const nudged = nudgeSelection(doc, [a, a], NUDGE_STEP_PX, 0);
    expect(nudged).toEqual([a]);
    expect(doc.getBlock(a)?.geometry).toEqual({ x: -90, y: 0, w: 50, h: 50 });
  });
});
