// The container's resize's per-edge union clamp (2026-10-22): each edge
// shrinks up to the members' union box (no inward pass), grows unlimited; a
// member already outside the edge stands no forced grow (the degenerate
// case). The shape's resize (the absent union) keeps the plain 20px floor.
import { describe, expect, it } from "vitest";

import { type Box, clampResizeBoxToUnion, resizeBox, unionBox } from "../src/canvas/viewport";

const left = (b: Box) => b.x - b.w / 2;
const right = (b: Box) => b.x + b.w / 2;
const top = (b: Box) => b.y - b.h / 2;
const bottom = (b: Box) => b.y + b.h / 2;

// A container box (left=-100, top=-100, right=100, bottom=100) and a members'
// union strictly inside it (unionLeft=-50, unionTop=-40, unionRight=50,
// unionBottom=40).
const CONTAINER: Box = { x: 0, y: 0, w: 200, h: 200 };
const UNION: Box = { x: 0, y: 0, w: 100, h: 80 };

describe("the container resize's per-edge union clamp", () => {
  it("the edge handles shrink up to the union edge and stop", () => {
    // w (left edge): shrink (dx>0) past the union's left edge (-50).
    expect(left(resizeBox(CONTAINER, "w", 60, 0, false, UNION))).toBeCloseTo(-50);
    // e (right edge): shrink (dx<0) past the union's right edge (50).
    expect(right(resizeBox(CONTAINER, "e", -60, 0, false, UNION))).toBeCloseTo(50);
    // n (top edge): shrink (dy>0) past the union's top edge (-40).
    expect(top(resizeBox(CONTAINER, "n", 0, 60, false, UNION))).toBeCloseTo(-40);
    // s (bottom edge): shrink (dy<0) past the union's bottom edge (40).
    expect(bottom(resizeBox(CONTAINER, "s", 0, -60, false, UNION))).toBeCloseTo(40);
  });

  it("the corner handles clamp each moving edge at the union edge", () => {
    // nw (left + top edges): shrink both.
    const nw = resizeBox(CONTAINER, "nw", 60, 60, false, UNION);
    expect(left(nw)).toBeCloseTo(-50);
    expect(top(nw)).toBeCloseTo(-40);
    // se (right + bottom edges): shrink both.
    const se = resizeBox(CONTAINER, "se", -60, -60, false, UNION);
    expect(right(se)).toBeCloseTo(50);
    expect(bottom(se)).toBeCloseTo(40);
  });

  it("growing is unlimited (the union clamp does not bind the outward edges)", () => {
    expect(left(resizeBox(CONTAINER, "w", -50, 0, false, UNION))).toBeCloseTo(-150);
    expect(right(resizeBox(CONTAINER, "e", 50, 0, false, UNION))).toBeCloseTo(150);
    expect(top(resizeBox(CONTAINER, "n", 0, -50, false, UNION))).toBeCloseTo(-150);
    expect(bottom(resizeBox(CONTAINER, "s", 0, 50, false, UNION))).toBeCloseTo(150);
  });

  it("a member already outside the edge stands no forced grow (the degenerate case)", () => {
    // The member protrudes 30px past the container's left edge (unionLeft
    // = -130 < the container's left = -100).
    const protrude: Box = { x: -80, y: 0, w: 100, h: 80 };
    // The w handle's shrink (dx>0) is blocked at the current edge (no inward
    // pass); the grow (dx<0) is free (no union bind, no forced grow).
    expect(left(resizeBox(CONTAINER, "w", 60, 0, false, protrude))).toBeCloseTo(-100);
    expect(left(resizeBox(CONTAINER, "w", -50, 0, false, protrude))).toBeCloseTo(-150);
    // The exact-edge boundary: a member's edge exactly at the container's
    // edge (unionLeft === the container's left) — the shrink is fully
    // blocked (the edge stands; a release is a zero-byte no-op), the grow
    // is free.
    const atEdge: Box = { x: -80, y: 0, w: 40, h: 40 };
    expect(left(resizeBox(CONTAINER, "w", 60, 0, false, atEdge))).toBeCloseTo(-100);
    expect(left(resizeBox(CONTAINER, "w", -50, 0, false, atEdge))).toBeCloseTo(-150);
  });

  it("the shape's resize (the absent union) keeps the plain 20px floor", () => {
    // No memberUnion: the left edge floors at the 20px width (right - 20).
    const box = resizeBox(CONTAINER, "w", 200, 0, false);
    expect(left(box)).toBeCloseTo(right(CONTAINER) - 20);
  });

  it("the shift corner's resize clamps so the box still covers the union", () => {
    // A shrink (toward the nw anchor) that would pass inside the union is
    // clamped per-edge; the box covers the union (the hard constraint wins
    // over the aspect).
    const clamped = resizeBox(CONTAINER, "se", -150, -150, true, UNION);
    expect(left(clamped) <= -50).toBe(true);
    expect(right(clamped) >= 50).toBe(true);
    expect(top(clamped) <= -40).toBe(true);
    expect(bottom(clamped) >= 40).toBe(true);
  });

  it("the clamped box is the resize's result (the height stands for a w-handle drag)", () => {
    // The w-handle's clamp returns a sane box: the width clamps to the union
    // (the left edge at -50), the height stands (200) — one number the
    // preview and the release commit both read (the session's box).
    const box = resizeBox(CONTAINER, "w", 60, 0, false, UNION);
    expect(box.w).toBeGreaterThan(0);
    expect(left(box)).toBeCloseTo(-50); // the clamped left edge
    expect(box.h).toBe(200); // only the width changes (the height stands)
  });
});

describe("the members' union box (the clamp's input)", () => {
  it("covers all the boxes and stands null for the empty set", () => {
    expect(unionBox([])).toBeNull();
    const union = unionBox([
      { x: 0, y: 0, w: 40, h: 40 },
      { x: 100, y: 50, w: 60, h: 20 },
    ]);
    expect(union).toEqual({ x: 55, y: 20, w: 150, h: 80 });
  });

  it("the union shrinks as a member leaves (the floor updates live)", () => {
    const withTwo = unionBox([
      { x: 0, y: 0, w: 40, h: 40 },
      { x: 100, y: 50, w: 60, h: 20 },
    ]);
    const afterLeave = unionBox([{ x: 0, y: 0, w: 40, h: 40 }]);
    expect(withTwo !== null && afterLeave !== null && afterLeave.w < withTwo.w).toBe(true);
  });

  it("clampResizeBoxToUnion is a no-op when the box already covers the union", () => {
    // A resize result that already covers the union is unchanged (the clamp
    // only pulls an edge that passed inside the union back outward).
    const original = CONTAINER;
    const box = { x: 0, y: 0, w: 120, h: 120 }; // covers the union (wider/taller)
    const clamped = clampResizeBoxToUnion(original, box, UNION);
    expect(clamped).toEqual(box);
  });
});
