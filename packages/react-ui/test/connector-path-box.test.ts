// @vitest-environment jsdom
// The legacy box form's connector path (the variant shapes over the
// boxes, the degenerate's stands): the pure function of canvas-geometry.
import { describe, expect, it } from "vitest";

import { connectorPath } from "../src/canvas/geometry";

/** The scene boxes (the center-anchor geometry shape). */
const A = { x: -300, y: -100, w: 200, h: 100 };
const B = { x: 300, y: 100, w: 200, h: 100 };

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
