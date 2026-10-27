// @vitest-environment jsdom
// The connector's path math (the edge anchors, the four edge ports, the
// endpoint resolution (port / legacy anchor / free point), the three
// variant shapes, the degenerate cases): the pure functions of
// canvas-geometry.
import { describe, expect, it } from "vitest";

import type { Block } from "docblocks-core";

import {
  connectorMidpoint,
  connectorPath,
  connectorPathPoints,
  edgeAnchor,
  edgePointOf,
  endpointPointOf,
  portOfNormal,
  portsOf,
} from "../src/blocks/canvas-geometry";

/** The scene boxes (the center-anchor geometry shape). */
const A = { x: -300, y: -100, w: 200, h: 100 };
const B = { x: 300, y: 100, w: 200, h: 100 };

/** The scene's blocks map (the two shapes' boxes). */
const BLOCKS: Record<string, Block> = {
  a: { type: "shape", geometry: A },
  b: { type: "shape", geometry: B },
} as unknown as Record<string, Block>;

describe("edgeAnchor", () => {
  it("exits the box at the edge the direction points at (the four sides)", () => {
    // East (the target right of the box): the border point at the box's
    // east edge, the normal out of the east side.
    expect(edgeAnchor(A, { x: 0, y: -100 })).toEqual({ x: -200, y: -100, nx: 1, ny: 0 });
    // West.
    expect(edgeAnchor(A, { x: -600, y: -100 })).toEqual({ x: -400, y: -100, nx: -1, ny: 0 });
    // South / north (the diagonal projections: the segment exits the
    // wider-constrained side first).
    const south = edgeAnchor(A, { x: -300, y: 0 });
    expect(south).toEqual({ x: -300, y: -50, nx: 0, ny: 1 });
    const north = edgeAnchor(A, { x: -300, y: -200 });
    expect(north).toEqual({ x: -300, y: -150, nx: 0, ny: -1 });
  });

  it("projects the diagonal onto the crossing edge (the segment's exit)", () => {
    // The direction (600, 200) from A's center: the east edge (the lambda
    // (100/600) < (50/200)) at y = -100 + 200 * (100/600) = -66.67.
    const anchor = edgeAnchor(A, { x: 300, y: 100 });
    expect(anchor.x).toBeCloseTo(-200);
    expect(anchor.y).toBeCloseTo(-100 + (100 / 600) * 200);
    expect(anchor.nx).toBe(1);
  });

  it("falls back to the east midpoint for the coincident centers (the zero vector)", () => {
    expect(edgeAnchor(A, { x: -300, y: -100 })).toEqual({ x: -200, y: -100, nx: 1, ny: 0 });
  });

  it("keeps the anchor on the border (the box's half-extents)", () => {
    // A 10x1 box: any direction exits through the horizontal edges
    // (the vertical half-extent 0.5 is crossed first for any dy).
    const flat = { x: 0, y: 0, w: 10, h: 1 };
    for (const toward of [
      { x: 5, y: 5 },
      { x: -5, y: 5 },
      { x: 5, y: -5 },
      { x: -5, y: -5 },
      { x: 20, y: 2 },
    ]) {
      const anchor = edgeAnchor(flat, toward);
      expect(Math.abs(anchor.y)).toBeCloseTo(0.5);
    }
  });
});

describe("portsOf", () => {
  it("the four edge midpoints (the center-anchor box)", () => {
    const ports = portsOf(A); // A = { x: -300, y: -100, w: 200, h: 100 }
    expect(ports.north).toEqual({ x: -300, y: -150 });
    expect(ports.east).toEqual({ x: -200, y: -100 });
    expect(ports.south).toEqual({ x: -300, y: -50 });
    expect(ports.west).toEqual({ x: -400, y: -100 });
  });
});

describe("edgePointOf", () => {
  // A = { x: -300, y: -100, w: 200, h: 100 }: the north / south edges
  // run left to right, the east / west edges top to bottom.
  it("the side's point at the fractional position (the portT's contract)", () => {
    // North (t = 0 left corner, 0.5 midpoint, 1 right corner).
    expect(edgePointOf(A, "north", 0)).toEqual({ x: -400, y: -150 });
    expect(edgePointOf(A, "north", 0.5)).toEqual({ x: -300, y: -150 });
    expect(edgePointOf(A, "north", 1)).toEqual({ x: -200, y: -150 });
    // East (top to bottom).
    expect(edgePointOf(A, "east", 0)).toEqual({ x: -200, y: -150 });
    expect(edgePointOf(A, "east", 0.25)).toEqual({ x: -200, y: -125 });
    expect(edgePointOf(A, "east", 1)).toEqual({ x: -200, y: -50 });
    // South / west.
    expect(edgePointOf(A, "south", 0.5)).toEqual({ x: -300, y: -50 });
    expect(edgePointOf(A, "west", 0.75)).toEqual({ x: -400, y: -75 });
  });

  it("clamps out-of-range t and stands the midpoint for the absent / non-finite t (the lenient read)", () => {
    expect(edgePointOf(A, "north", 2)).toEqual({ x: -200, y: -150 });
    expect(edgePointOf(A, "north", -1)).toEqual({ x: -400, y: -150 });
    expect(edgePointOf(A, "east", undefined)).toEqual({ x: -200, y: -100 });
    expect(edgePointOf(A, "south", NaN)).toEqual({ x: -300, y: -50 });
  });
});

describe("endpointPointOf", () => {
  const blocks = {
    s1: { type: "shape", attrs: { variant: "rect" }, geometry: { x: -300, y: -100, w: 200, h: 100 } },
  } as unknown as Parameters<typeof endpointPointOf>[2];
  const siblings = ["s1"] as const;

  it("a free point stands as-is (the zero normal)", () => {
    expect(endpointPointOf({ x: 120, y: -40 }, siblings, blocks, { x: 0, y: 0 })).toEqual({
      x: 120,
      y: -40,
      nx: 0,
      ny: 0,
    });
  });

  it("a free point with a port stands the FROZEN direction (the last anchor's side)", () => {
    expect(endpointPointOf({ x: 120, y: -40, port: "south" }, siblings, blocks, { x: 0, y: 0 })).toEqual({
      x: 120,
      y: -40,
      nx: 0,
      ny: 1,
    });
    expect(endpointPointOf({ x: 120, y: -40, port: "west" }, siblings, blocks, { x: 0, y: 0 })).toEqual({
      x: 120,
      y: -40,
      nx: -1,
      ny: 0,
    });
  });

  it("the unit normal maps to its port (the direction's frozen form; the zero vector stands none)", () => {
    expect(portOfNormal(1, 0)).toBe("east");
    expect(portOfNormal(-1, 0)).toBe("west");
    expect(portOfNormal(0, 1)).toBe("south");
    expect(portOfNormal(0, -1)).toBe("north");
    expect(portOfNormal(0, 0)).toBeNull();
  });

  it("a ref + port stands at that edge midpoint (the port's outward normal)", () => {
    expect(endpointPointOf({ blockId: "s1", port: "east" }, siblings, blocks, { x: 300, y: 100 })).toEqual({
      x: -200,
      y: -100,
      nx: 1,
      ny: 0,
    });
    expect(endpointPointOf({ blockId: "s1", port: "south" }, siblings, blocks, { x: 0, y: 200 })).toEqual({
      x: -300,
      y: -50,
      nx: 0,
      ny: 1,
    });
  });

  it("a ref + port + portT stands at the side's point at the fractional position (the continuous anchor)", () => {
    // The east edge (top to bottom): t = 0.25 stands 25% down from the
    // top corner (A = { x: -300, y: -100, w: 200, h: 100 } → (−200, −125));
    // the normal stays the port's (the position moves along the side,
    // not the direction).
    expect(endpointPointOf({ blockId: "s1", port: "east", portT: 0.25 }, siblings, blocks, { x: 300, y: 100 })).toEqual(
      {
        x: -200,
        y: -125,
        nx: 1,
        ny: 0,
      }
    );
    // The north edge at the corner (t = 1 — the corners stand).

    expect(endpointPointOf({ blockId: "s1", port: "north", portT: 1 }, siblings, blocks, { x: 0, y: 0 })).toEqual({
      x: -200,
      y: -150,
      nx: 0,
      ny: -1,
    });
  });

  it("a ref without a port keeps the sticky edge anchor (the legacy posture)", () => {
    // The same math as edgeAnchor toward the other end (the direction
    // (600, 200) exits A's east edge at y = -66.67).
    const point = endpointPointOf({ blockId: "s1" }, siblings, blocks, { x: 300, y: 100 });
    expect(point?.x).toBeCloseTo(-200);
    expect(point?.y).toBeCloseTo(-100 + (100 / 600) * 200);
    expect(point?.nx).toBe(1);
  });

  it("a docId ref or an absent block resolves to nothing (the lenient posture)", () => {
    expect(endpointPointOf({ docId: "master-1" }, siblings, blocks, { x: 0, y: 0 })).toBeNull();
    expect(endpointPointOf({ blockId: "nope" }, siblings, blocks, { x: 0, y: 0 })).toBeNull();
  });
});

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
    // The 777 scene: start's south port, end's west port, curved.
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

describe("connectorPath", () => {
  it("straight: the edge-to-edge segment between the anchored edges", () => {
    const path = connectorPath(A, B, "straight");
    // A exits the east edge (the direction (600, 200)), B enters the west
    // edge (the direction (-600, -200)).
    expect(path.d).toBe(`M -200 ${-100 + (100 / 600) * 200} L 200 ${100 - (100 / 600) * 200}`);
    expect(path.end).toEqual({ x: 200, y: 100 - (100 / 600) * 200 });
    // The mid stands at the segment's midpoint (the label's seat).
    expect(path.mid.x).toBeCloseTo((-200 + 200) / 2);
  });

  it("orthogonal: the right-angled elbow through the dominant axis' mid-edges", () => {
    // The horizontal dominant (|dx| = 600 > |dy| = 200): out of A's east
    // mid-edge (-200, -100), the vertical bend at the mid x ((-200 + 200)/2
    // = 0), into B's west mid-edge (200, 100).
    const path = connectorPath(A, B, "orthogonal");
    expect(path.d).toBe("M -200 -100 L 0 -100 L 0 100 L 200 100");
    expect(path.end).toEqual({ x: 200, y: 100 });
    expect(path.mid).toEqual({ x: 0, y: 0 });

    // The vertical dominant (|dy| > |dx|): a stacked pair — out of the
    // top box's south mid-edge, the horizontal bend at the mid y, into
    // the bottom box's north mid-edge.
    const top = { x: 0, y: -300, w: 100, h: 100 };
    const bottom = { x: 0, y: 300, w: 100, h: 100 };
    const vertical = connectorPath(top, bottom, "orthogonal");
    expect(vertical.d).toBe("M 0 -250 L 0 0 L 0 0 L 0 250");
  });

  it("orthogonal: the coincident centers stand as the straight segment (degenerate)", () => {
    const same = connectorPath(A, A, "orthogonal");
    // The degenerate elbow (the centers coincide): both anchors take the
    // east-midpoint fallback — a zero-length segment at the east edge.
    expect(same.d).toBe("M -200 -100 L -200 -100");
  });

  it("curved: the cubic bezier bowing out along the anchored edges' normals", () => {
    const path = connectorPath(A, B, "curved");
    // The span's third: the control points at A + normalA * reach and
    // B + normalB * reach (the east and the west normals).
    const dist = Math.hypot(400, 200 - (100 / 600) * 400); // the span's dy: the full 200 minus the two edge offsets (133.33)
    const reach = dist / 3;
    const yA = -100 + (100 / 600) * 200;
    const yB = 100 - (100 / 600) * 200;
    expect(path.d).toBe(`M -200 ${yA} C ${-200 + reach} ${yA}, ${200 - reach} ${yB}, 200 ${yB}`);
    // The end stands at the end edge (the arrowhead's tip seat).
    expect(path.end).toEqual({ x: 200, y: yB });
  });

  it("curved: the seat stands on the curve's own midpoint (the bezier's t=0.5, not the endpoints' straight mid)", () => {
    // The legacy box form (the plain-ref pair): the curve bows out along
    // the anchored edges' normals — the endpoints' straight mid stands in
    // the air off the bow; the seat stands on the curve (the bezier's
    // t = 0.5).
    const path = connectorPath(A, B, "curved");
    const dist = Math.hypot(400, 200 - (100 / 600) * 400);
    const reach = dist / 3;
    const yA = -100 + (100 / 600) * 200;
    const yB = 100 - (100 / 600) * 200;
    const a = { x: -200, y: yA };
    const c1 = { x: -200 + reach, y: yA };
    const c2 = { x: 200 - reach, y: yB };
    const b = { x: 200, y: yB };
    expect(path.mid).toEqual({
      x: 0.125 * a.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * b.x,
      y: 0.125 * a.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * b.y,
    });
    // The straight mid (the former buggy stand) stands off the curve.
    expect(path.mid).not.toEqual({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  });

  it("the variant switch keeps the same endpoints (only the shape changes)", () => {
    const straight = connectorPath(A, B, "straight");
    const orthogonal = connectorPath(A, B, "orthogonal");
    const curved = connectorPath(A, B, "curved");
    // The end point is the end box's edge for all the variants (the
    // orthogonal stands at the mid-edge; the straight/curved at the
    // projected anchor — the arrowhead always stands at B's west edge).
    expect(orthogonal.end.x).toBe(200); // B's west edge x
    expect(straight.end.x).toBeCloseTo(orthogonal.end.x);
    expect(curved.end.x).toBeCloseTo(orthogonal.end.x);
  });
});

describe("connectorMidpoint", () => {
  const IDS = ["a", "b"];
  const CONN = "c1";
  // The connector's entry (the id-based signature — the block's own shape
  // carries no id; the map key stands the identity).
  const withConn = (attrs: Record<string, unknown>): Record<string, Block> => ({
    ...BLOCKS,
    [CONN]: { type: "connector", attrs } as unknown as Block,
  });

  it("the legacy plain-ref pair stands the box path's midpoint (the overlay's parity)", () => {
    expect(connectorMidpoint(CONN, IDS, withConn({ start: { blockId: "a" }, end: { blockId: "b" } }))).toEqual({
      x: 0,
      y: 0,
    });
    // The orthogonal's legacy stand (the bend's midpoint — the same seat
    // for this scene's geometry).
    expect(
      connectorMidpoint(CONN, IDS, withConn({ start: { blockId: "a" }, end: { blockId: "b" }, variant: "orthogonal" }))
    ).toEqual({ x: 0, y: 0 });
  });

  it("the port / the free endpoint stands the resolved points' midpoint (not the box's)", () => {
    // The ports: A's east port (-200, -100), B's west port (200, 100) —
    // the mid (0, 0) (the port stand is the edge's midpoint, not the box
    // center's projected anchor — the non-legacy path).
    expect(
      connectorMidpoint(
        CONN,
        IDS,
        withConn({ start: { blockId: "a", port: "east" }, end: { blockId: "b", port: "west" } })
      )
    ).toEqual({ x: 0, y: 0 });
    // The free points stand as-is (the world's space).
    expect(connectorMidpoint(CONN, IDS, withConn({ start: { x: -50, y: 0 }, end: { x: 50, y: 40 } }))).toEqual({
      x: 0,
      y: 20,
    });
    // A free point with the FROZEN direction (the port on the free ref)
    // stands the same seat (the direction is the line's, not the seat's).
    expect(
      connectorMidpoint(CONN, IDS, withConn({ start: { x: -50, y: 0, port: "north" }, end: { x: 50, y: 40 } }))
    ).toEqual({ x: 0, y: 20 });
  });

  it("the orthogonal port-pair's seat stands on the polyline's longest run (not the endpoints' straight mid)", () => {
    // A's south port (the bottom) -> B's west port (the left), B below and
    // right — the label-in-the-air scene. The orthogonal's
    // vertical-dominant elbow: the seat stands on the polyline's longest
    // run (the vertical run's mid), not the endpoints' straight mid (the
    // former stand — the chip floating off the line).
    const blocks = {
      a: { type: "shape", geometry: { x: 0, y: 0, w: 100, h: 100 } },
      b: { type: "shape", geometry: { x: 100, y: 200, w: 100, h: 100 } },
      c1: {
        type: "connector",
        attrs: { start: { blockId: "a", port: "south" }, end: { blockId: "b", port: "west" }, variant: "orthogonal" },
      },
    } as unknown as Record<string, Block>;
    const mid = connectorMidpoint(CONN, ["a", "b"], blocks);
    // The endpoints' straight mid (the former buggy stand — in the air).
    expect(mid).not.toEqual({ x: 25, y: 125 });
    // The seat stands on the polyline (the longest run's mid — (0, 131)).
    expect(mid).toEqual({ x: 0, y: 131 });
  });

  it("the curved port-pair's seat stands on the curve (the 777 scene — the chip was in the air)", () => {
    // start's south port, end's west port, curved: the curve bows out, so
    // the endpoints' straight mid (the former stand) stood in the air off
    // the bow. The seat stands on the curve (the bezier's t = 0.5).
    const blocks = {
      a: { type: "shape", geometry: { x: 756.23, y: -225.46, w: 333.29, h: 358.15 } },
      b: { type: "shape", geometry: { x: 1253.39, y: 47.54, w: 169.14, h: 169.14 } },
      c1: {
        type: "connector",
        attrs: { start: { blockId: "a", port: "south" }, end: { blockId: "b", port: "west" }, variant: "curved" },
      },
    } as unknown as Record<string, Block>;
    const mid = connectorMidpoint(CONN, ["a", "b"], blocks);
    // The resolved endpoints: a's south port (x, y + h/2), b's west port
    // (x - w/2, y).
    const a = { x: 756.23, y: -225.46 + 358.15 / 2 };
    const b = { x: 1253.39 - 169.14 / 2, y: 47.54 };
    const reach = Math.hypot(b.x - a.x, b.y - a.y) / 3;
    const c1 = { x: a.x + 0 * reach, y: a.y + 1 * reach }; // the south normal (0, 1)
    const c2 = { x: b.x + -1 * reach, y: b.y + 0 * reach }; // the west normal (-1, 0)
    expect(mid).toEqual({
      x: 0.125 * a.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * b.x,
      y: 0.125 * a.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * b.y,
    });
    // The straight mid (the former air) stands off the curve.
    expect(mid).not.toEqual({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  });

  it("the stored points' polyline stands the endpoints' midpoint (the points stand the route, not the seat)", () => {
    expect(
      connectorMidpoint(
        CONN,
        IDS,
        withConn({
          start: { x: -50, y: 0 },
          end: { x: 50, y: 40 },
          points: [
            [0, 10],
            [0, 30],
          ],
        })
      )
    ).toEqual({ x: 0, y: 20 });
  });

  it("the unresolved endpoint stands null (the lenient posture — the line stands nothing)", () => {
    // The blockId outside the surface's children: the ref resolves to
    // nothing (the cross-surface / the absent block).
    expect(connectorMidpoint(CONN, IDS, withConn({ start: { blockId: "a" }, end: { blockId: "c" } }))).toBeNull();
    // The docId ref (the cross-doc's v1 stand): the null.
    expect(connectorMidpoint(CONN, IDS, withConn({ start: { docId: "other" }, end: { blockId: "a" } }))).toBeNull();
  });
});

describe("connectorMidpoint over the in-flight previews (the label chip's live stand)", () => {
  const IDS = ["a", "b"];
  const CONN = "c1";
  const INERT = {
    movePreview: null,
    resizePreview: null,
    endpointDrag: null,
    endpointPreview: null,
  };
  const withConn = (attrs: Record<string, unknown>): Record<string, Block> => ({
    ...BLOCKS,
    [CONN]: { type: "connector", attrs } as unknown as Block,
  });

  it("the move preview stands the previewed block's seat (the same input as the line's re-draw)", () => {
    // Committed (no preview): the symmetric scene's mid (0, 0).
    expect(connectorMidpoint(CONN, IDS, withConn({ start: { blockId: "a" }, end: { blockId: "b" } }))).toEqual({
      x: 0,
      y: 0,
    });
    // A moved 100px east: the anchors re-stand on the previewed box — the
    // seat stands the delta (the line and the seat stand from one number).
    expect(
      connectorMidpoint(CONN, IDS, withConn({ start: { blockId: "a" }, end: { blockId: "b" } }), {
        ...INERT,
        movePreview: { ids: ["a"], dx: 100, dy: 0 },
      })
    ).toEqual({ x: 50, y: 0 });
  });

  it("the endpoint drag's live point (the no-snap stand) stands the seat (the re-draw's parity)", () => {
    const blocks = withConn({ start: { x: -50, y: 0 }, end: { x: 50, y: 40 } });
    // Committed: the two free points' mid.
    expect(connectorMidpoint(CONN, IDS, blocks)).toEqual({ x: 0, y: 20 });
    // The end dragged to (50, 140): the seat stands the live point's mid.
    expect(
      connectorMidpoint(CONN, IDS, blocks, {
        ...INERT,
        endpointDrag: { connectorId: CONN, which: "end" },
        endpointPreview: { point: { x: 50, y: 140 }, snap: null },
      })
    ).toEqual({ x: 0, y: 70 });
  });

  it("the endpoint drag's snap stands the edge anchor's seat (the stick effect's parity)", () => {
    const blocks = withConn({ start: { blockId: "a", port: "east" }, end: { x: 50, y: 40 } });
    // The end snaps to A's east port at t=0.5: the seat stands the snapped
    // edge point (not the raw cursor point) — the stick's continuous anchor.
    expect(
      connectorMidpoint(CONN, IDS, blocks, {
        ...INERT,
        endpointDrag: { connectorId: CONN, which: "end" },
        endpointPreview: { point: { x: 999, y: 999 }, snap: { blockId: "a", port: "east", t: 0.5 } },
      })
    ).toEqual({ x: -200, y: -100 });
  });

  it("the drag over another connector's endpoint stands no re-draw (the identity guard)", () => {
    const blocks = withConn({ start: { x: -50, y: 0 }, end: { x: 50, y: 40 } });
    // The drag targets another connector: the seat stands the committed
    // geometry (the preview does not leak across lines).
    expect(
      connectorMidpoint(CONN, IDS, blocks, {
        ...INERT,
        endpointDrag: { connectorId: "c2", which: "end" },
        endpointPreview: { point: { x: 50, y: 140 }, snap: null },
      })
    ).toEqual({ x: 0, y: 20 });
  });
});
