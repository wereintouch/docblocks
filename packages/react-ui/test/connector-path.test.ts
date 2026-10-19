// @vitest-environment jsdom
// The connector's path math (the edge anchors, the four edge ports, the
// endpoint resolution (port / legacy anchor / free point), the three
// variant shapes, the degenerate cases): the pure functions of
// canvas-geometry.
import { describe, expect, it } from "vitest";

import {
  connectorPath,
  connectorPathPoints,
  edgeAnchor,
  endpointPointOf,
  portOfNormal,
  portsOf,
} from "../src/blocks/canvas-geometry";

/** The scene boxes (the center-anchor geometry shape). */
const A = { x: -300, y: -100, w: 200, h: 100 };
const B = { x: 300, y: 100, w: 200, h: 100 };

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
