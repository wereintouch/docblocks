// @vitest-environment jsdom
// The connector's path math (the edge anchors, the three variant shapes,
// the degenerate cases): the pure functions of canvas-geometry.
import { describe, expect, it } from "vitest";

import { connectorPath, edgeAnchor } from "../src/blocks/canvas-geometry";

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
