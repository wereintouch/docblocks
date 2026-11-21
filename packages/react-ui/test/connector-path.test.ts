// @vitest-environment jsdom
// The connector's path over the resolved points (the variant shapes'
// routing, the obstacles' avoidance, the curved's seat): the pure function
// of canvas-geometry.
import { describe, expect, it } from "vitest";

import { connectorPathPoints } from "../src/canvas/geometry";

describe("connectorPathPoints", () => {
  const A_POINT = { x: -200, y: -100, nx: 1, ny: 0 };
  const B_POINT = { x: 200, y: 100, nx: -1, ny: 0 };

  it("straight: the point-to-point segment", () => {
    const path = connectorPathPoints(A_POINT, B_POINT, "straight");
    expect(path.d).toBe("M -200 -100 L 200 100");
    expect(path.end).toEqual({ x: 200, y: 100 });
    expect(path.mid).toEqual({ x: 0, y: 0 });
  });

  it("orthogonal: the elbow through the dominant axis' midpoint (free points included)", () => {
    const horizontal = connectorPathPoints(
      { x: 0, y: -100, nx: 0, ny: 0 },
      { x: 400, y: 100, nx: 0, ny: 0 },
      "orthogonal"
    );
    expect(horizontal.d).toBe("M 0 -100 L 200 -100 L 200 100 L 400 100");
    const vertical = connectorPathPoints({ x: 0, y: -300, nx: 0, ny: 0 }, { x: 0, y: 300, nx: 0, ny: 0 }, "orthogonal");
    expect(vertical.d).toBe("M 0 -300 L 0 0 L 0 300");
  });

  it("orthogonal: the port endpoints stand the right-angle approach (the 12-px stub along the outward normal)", () => {
    // The side approach: the line arrives at the NORTH port along the
    // edge's line (the old shape ran along the edge and merged into it).
    // The fix: it runs parallel to the edge at the 12-px offset OUTSIDE
    // the block (y = 100 - 12 = 88, the port's outward side) and turns
    // into the port at a right angle.
    const side = connectorPathPoints({ x: 0, y: 100, nx: 0, ny: 0 }, { x: 200, y: 100, nx: 0, ny: -1 }, "orthogonal");
    expect(side.d).toBe("M 0 100 L 100 100 L 100 88 L 200 88 L 200 100");
    // Both anchored (the east / west ports): the stubs stand 12px OUTSIDE
    // the edges (the approach leaves / enters along the normal).
    const anchored = connectorPathPoints(
      { x: -200, y: -100, nx: 1, ny: 0 },
      { x: 200, y: 100, nx: -1, ny: 0 },
      "orthogonal"
    );
    expect(anchored.d).toBe("M -200 -100 L -188 -100 L 0 -100 L 0 100 L 188 100 L 200 100");
    expect(anchored.mid).toEqual({ x: 0, y: 0 });
  });

  it("orthogonal: the bend line runs around the obstacles (the first clear candidate; the fallback stands the default)", () => {
    // The V-DOMINANT case (the vertical span wins): the bend line's
    // candidates stand the Y coords — a box in the corridor stands the
    // route around it (the L at the start's own line is the first clear
    // candidate here).
    const vDom = connectorPathPoints({ x: 0, y: -100, nx: 0, ny: 0 }, { x: 50, y: 100, nx: 0, ny: 0 }, "orthogonal", [
      { x: 0, y: 0, w: 100, h: 100 },
    ]);
    expect(vDom.d).toBe("M 0 -100 L 50 -100 L 50 100");

    // The default elbow's vertical bend at x = 200 crosses the box
    // (200, 0, 100x100): the route reroutes over the box (the box's top
    // edge offset by the 12-px margin: y = -50 - 12 = -62) — the line
    // never crosses the figure when a clear route stands.
    const blocked = connectorPathPoints({ x: 0, y: 0, nx: 0, ny: 0 }, { x: 400, y: 0, nx: 0, ny: 0 }, "orthogonal", [
      { x: 200, y: 0, w: 100, h: 100 },
    ]);
    expect(blocked.d).toBe("M 0 0 L 0 -62 L 400 -62 L 400 0");

    // The box between the endpoints' own lines (the L-shape's clear
    // candidate stands first — the detour stands no longer):
    // the default elbow (x = 200) crosses the box, the other axis'
    // midpoint (y = 0) crosses it too, the L at b (x = 400) crosses the
    // box's right side... the L at a (x = 0) is clear.
    const sideBox = connectorPathPoints(
      { x: 0, y: -100, nx: 0, ny: 0 },
      { x: 400, y: 100, nx: 0, ny: 0 },
      "orthogonal",
      [{ x: 200, y: 0, w: 100, h: 100 }]
    );
    // H t = 400 (the L at b): the horizontal at y = -100 (clear of the
    // box's y -50..50), the vertical at x = 400 (clear of the box's
    // x 150..250), into b.
    expect(sideBox.d).toBe("M 0 -100 L 400 -100 L 400 100");

    // No clear candidate (the obstacles cover every route): the DEFAULT
    // elbow stands (the best effort — the crossing stands).
    const sealed = connectorPathPoints({ x: 0, y: 0, nx: 0, ny: 0 }, { x: 100, y: 100, nx: 0, ny: 0 }, "orthogonal", [
      { x: 0, y: 0, w: 400, h: 400 },
    ]);
    expect(sealed.d).toBe("M 0 0 L 50 0 L 50 100 L 100 100");
    // The V-dominant fallback stands its OWN axis' midpoint (the Y
    // midpoint — the cross-axis X midpoint stood the old defect's
    // far-off bend).
    const sealedV = connectorPathPoints({ x: 0, y: 0, nx: 0, ny: 0 }, { x: 50, y: 100, nx: 0, ny: 0 }, "orthogonal", [
      { x: 0, y: 0, w: 400, h: 400 },
    ]);
    expect(sealedV.d).toBe("M 0 0 L 0 50 L 50 50 L 50 100");

    // The SEALED corridor (the endpoint boxes nearly touch — no single
    // bend line runs clear): the U detour stands (the two-bend-line
    // candidate — up over box A's top, around its left side, down, and
    // into box B's west port at the 12-px parallel run).
    const sealedCorridor = connectorPathPoints(
      { x: -569.50390625, y: -157.51171875, nx: 1, ny: 0 },
      { x: -666.703125, y: -59.33984375, nx: -1, ny: 0 },
      "orthogonal",
      [
        { x: -669.50390625, y: -157.51171875, w: 200, h: 100 },
        { x: -566.703125, y: -59.33984375, w: 200, h: 100 },
      ]
    );
    expect(sealedCorridor.d).toBe(
      "M -569.50390625 -157.51171875 L -557.50390625 -157.51171875 L -557.50390625 -219.51171875 L -781.50390625 -219.51171875 L -781.50390625 -59.33984375 L -678.703125 -59.33984375 L -666.703125 -59.33984375"
    );
  });

  it("orthogonal: the UNRELATED obstacle's far edge does not beat the near detour (the shortest clear stands)", () => {
    // The scene: the start's east port to the end's
    // west port (the end's the start's upper-right, the corridor sealed
    // by the endpoints' own boxes); a THIRD shape stands far to the side
    // (overlapping nothing). The selection is the shortest clear route —
    // the side shape's far edge (the list's early obstacle detour) must
    // not pull the line across the canvas.
    const start = { x: 402.13346354166663, y: -247.91731770833334, w: 247.54296875, h: 138.12109375 };
    const end = { x: 357.486328125, y: -387.9981626272871, w: 174.67578125, h: 146.3557002545742 };
    const side = { x: -372.63671875, y: -610.10546875, w: 200, h: 100 };
    const a = { x: start.x + start.w / 2, y: start.y, nx: 1, ny: 0 };
    const b = { x: end.x - end.w / 2, y: end.y, nx: -1, ny: 0 };
    const withSide = connectorPathPoints(a, b, "orthogonal", [side, start, end]);
    const withoutSide = connectorPathPoints(a, b, "orthogonal", [start, end]);
    // The side shape stands no effect: the route stands byte-for-byte.
    expect(withSide.d).toBe(withoutSide.d);
    // The route detours the end's bottom (the start's bottom edge + the
    // 12-px margin) — NOT over the side shape's top edge.
    expect(withSide.d).toBe(
      "M 525.9049479166666 -247.91731770833334 L 537.9049479166666 -247.91731770833334 L 537.9049479166666 -166.85677083333334 L 258.1484375 -166.85677083333334 L 258.1484375 -387.9981626272871 L 270.1484375 -387.9981626272871"
    );
    // The clear scene stands the default elbow byte-for-byte (the pool's
    // first entry — the elbow is the shortest clear candidate).
    const clearElbow = connectorPathPoints(
      { x: 0, y: 0, nx: 0, ny: 0 },
      { x: 100, y: 60, nx: 0, ny: 0 },
      "orthogonal",
      [{ x: 0, y: 0, w: 100, h: 100 }]
    );
    expect(clearElbow.d).toBe("M 0 0 L 50 0 L 50 60 L 100 60");
  });

  it("orthogonal: the line inside a container routes around the members (the container's box stands no obstacle)", () => {
    // The scene: a container with members A (left), B (right), C (middle).
    // The connector A(east) -> B(west): the straight route at y = 0 crosses
    // C. The CONTAINER's box (which encloses the members) stands no
    // obstacle — the obstacles are the MEMBERS (the figures), so the clear
    // route (over C's top) stands, not the crossing fallback.
    const a = { x: -60, y: 0, nx: 1, ny: 0 }; // A's east edge
    const b = { x: 60, y: 0, nx: -1, ny: 0 }; // B's west edge
    const A = { x: -100, y: 0, w: 80, h: 80 };
    const B = { x: 100, y: 0, w: 80, h: 80 };
    const C = { x: 0, y: 0, w: 80, h: 80 };
    // The FIXED behavior: the obstacles are the members (NOT the container's
    // box). The route goes over C's top (C's top edge -40 offset by the
    // 12-px margin: y = -40 - 12 = -52), NOT the straight line (which
    // crosses C).
    const fixed = connectorPathPoints(a, b, "orthogonal", [A, B, C]);
    expect(fixed.d).toBe("M -60 0 L -48 0 L -48 -52 L 48 -52 L 48 0 L 60 0");
    // The BUG (the container's box as an obstacle): every inside route hits
    // the enclosing box -> the pool is empty -> the fallback elbow crosses C.
    const G = { x: 0, y: 0, w: 400, h: 300 };
    const bugged = connectorPathPoints(a, b, "orthogonal", [G, A, B, C]);
    expect(bugged.d).toBe("M -60 0 L -48 0 L 0 0 L 48 0 L 60 0");
  });

  it("orthogonal: the equal-length tie prefers the FEWER bends (the obstacle scene only)", () => {
    // a = (0, 0), b = (100, 60): the default elbow (t = 50, 2 bends) and the
    // L-shapes (t = 100 / t = 0, 1 bend) all stand the same length (160 — the
    // Manhattan span). A far obstacle keeps the scene's avoid flag (the
    // actual lengths stand), so the 1-bend L-shape wins over the 2-bend
    // elbow (the list order picks the earliest of the equal set — t = 100).
    const withObs = connectorPathPoints({ x: 0, y: 0, nx: 0, ny: 0 }, { x: 100, y: 60, nx: 0, ny: 0 }, "orthogonal", [
      { x: 500, y: 500, w: 100, h: 100 },
    ]);
    expect(withObs.d).toBe("M 0 0 L 100 0 L 100 60");
    // The obstacle-free scene (the equal lengths stand 0) keeps the list
    // order — the default elbow byte-for-byte (the bend tiebreaker stands off).
    const noObs = connectorPathPoints({ x: 0, y: 0, nx: 0, ny: 0 }, { x: 100, y: 60, nx: 0, ny: 0 }, "orthogonal");
    expect(noObs.d).toBe("M 0 0 L 50 0 L 50 60 L 100 60");
  });

  it("curved: the anchored normals bow out; the free point bows perpendicular to the segment", () => {
    // Both anchored (the east / west normals): the same bow as the box
    // form's curved (the endpoints equal the edge anchors).
    const anchored = connectorPathPoints(A_POINT, B_POINT, "curved");
    const dist = Math.hypot(400, 200);
    const reach = dist / 3;
    expect(anchored.d).toBe(`M -200 -100 C ${-200 + reach} -100, ${200 - reach} 100, 200 100`);

    // Both free (the zero normals): the perpendicular bow (the segment
    // direction rotated -90°: (0, -1); both control points on the same
    // side, offset from the endpoints by reach = dist / 3 = 100).
    const free = connectorPathPoints({ x: 0, y: 0, nx: 0, ny: 0 }, { x: 300, y: 0, nx: 0, ny: 0 }, "curved");
    expect(free.d).toBe("M 0 0 C 0 -100, 300 -100, 300 0");
  });

  it("curved: the seat stands on the curve's own midpoint (the bezier's t=0.5, not the endpoints' straight mid)", () => {
    // The chip-in-the-air case: start's south port, end's west port, curved.
    // The curve bows out — the endpoints' straight mid stands in the air
    // off the bow; the seat stands on the curve (the bezier's t = 0.5).
    const a = { x: 756.23, y: -46.39, nx: 0, ny: 1 };
    const b = { x: 1168.82, y: 47.54, nx: -1, ny: 0 };
    const path = connectorPathPoints(a, b, "curved");
    // The straight mid (the former buggy stand — in the air).
    const straight = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(path.mid).not.toEqual(straight);
    // The mid stands on the curve (the bezier's t = 0.5).
    const reach = Math.hypot(b.x - a.x, b.y - a.y) / 3;
    const c1 = { x: a.x + a.nx * reach, y: a.y + a.ny * reach };
    const c2 = { x: b.x + b.nx * reach, y: b.y + b.ny * reach };
    expect(path.mid).toEqual({
      x: 0.125 * a.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * b.x,
      y: 0.125 * a.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * b.y,
    });
  });
});
