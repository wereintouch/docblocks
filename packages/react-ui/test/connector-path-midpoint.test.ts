// @vitest-environment jsdom
// The connector's midpoint's seat (the committed's stand + the in-flight
// previews' live stand — the label chip's parity): the pure function of
// canvas-geometry.
import { describe, expect, it } from "vitest";

import type { Block } from "docblocks-core";

import { connectorMidpoint } from "../src/canvas/geometry";

/** The scene boxes (the center-anchor geometry shape). */
const A = { x: -300, y: -100, w: 200, h: 100 };
const B = { x: 300, y: 100, w: 200, h: 100 };

/** The scene's blocks map (the two shapes' boxes). */
const BLOCKS: Record<string, Block> = {
  a: { type: "shape", geometry: A },
  b: { type: "shape", geometry: B },
} as unknown as Record<string, Block>;

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

  it("the curved port-pair's seat stands on the curve (the chip was in the air)", () => {
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
