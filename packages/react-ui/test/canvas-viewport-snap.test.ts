// The canvas viewport's connector endpoints' CONTINUOUS edge snap: the
// side + the fractional position along it, the all-surfaces' search, the
// press's stand, and the pending preview's stand points.
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import {
  connectorPressStand,
  connectorPreviewFrom,
  connectorPreviewPoint,
  snapAnySurfaceEdge,
  snapEdgePoint,
  snapEndpointEdge,
} from "../src/canvas/viewport/utils";

describe("the continuous edge snap", () => {
  const CREATED_AT = "2026-10-10T00:00:00.000Z";

  function scene() {
    const doc = createDoc({ id: "snap-doc", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(a, { x: -100, y: 0, w: 100, h: 60 });
    const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    doc.setGeometry(b, { x: 100, y: 0, w: 100, h: 60 });
    return { doc, surface, a, b };
  }

  it("stands the side + the fractional position at the point's projection (clamped to the side)", () => {
    const { doc, a } = scene();
    // A = (-100, 0, 100x60): the north edge at y = -30, x in [-150, -50].
    // The point 5px above the north edge at x = -125 → t = 0.25.
    expect(snapEdgePoint(doc, a, { x: -125, y: -35 })).toEqual({ blockId: a, port: "north", t: 0.25 });
    // Off the side's segment (past the west corner): the t clamps to 0
    // and the distance is to the corner's point.
    expect(snapEdgePoint(doc, a, { x: -160, y: -30 })).toEqual({ blockId: a, port: "north", t: 0 });
    // The nearest side wins (the point right of the east edge at the
    // south quarter: the east side stands 0px, the south's 22px does not).
    expect(snapEdgePoint(doc, a, { x: -45, y: 15 })).toEqual({ blockId: a, port: "east", t: 0.75 });
  });

  it("stands null outside the snap radius (the release in the air)", () => {
    const { doc, a } = scene();
    expect(snapEdgePoint(doc, a, { x: -100, y: 0 })).toBeNull(); // the box's center
    expect(snapEdgePoint(doc, a, { x: 400, y: 200 })).toBeNull();
  });

  it("the sibling search skips the connector and the group (the box-less / the derived-box stands)", () => {
    const { doc, surface, a } = scene();
    const connector = doc.insertBlock(
      "connector",
      { start: { blockId: a }, end: { x: 300, y: 200 } },
      { parent: surface }
    );
    const group = doc.insertBlock("group", { members: [a] }, { parent: surface });
    // A point 5px above a's north edge: the group's default 60x60 box at
    // the surface's center would stand a phantom edge at y = -30 over
    // x in [-30, 30] — the skip keeps the snap on a (not the group's box
    // at t = (0 - (-30)) / 60 = 0.5 over the same y).
    expect(snapEndpointEdge(doc, surface, { x: -100, y: -35 })).toEqual({ blockId: a, port: "north", t: 0.5 });
    // The connector's phantom box (the default size) never stands an edge:
    // a point over the connector's default box's edge stands the block a
    // if it stands nearest, or nothing when far from a / the group's box.
    expect(snapEndpointEdge(doc, surface, { x: 30, y: -35 })).toBeNull();
    expect(connector).toBeTruthy();
    expect(group).toBeTruthy();
  });

  it("the port's stick disk locks the anchor at the midpoint", () => {
    const { doc, a } = scene();
    // A = (-100, 0, 100x60): the north port at (-100, -30). The point
    // 8px along the edge from the port, 2px off it (distMid = ~8.2,
    // inside the 12px disk): the port locks the anchor at t = 0.5 (the
    // continuous projection would stand t = 0.42).
    expect(snapEdgePoint(doc, a, { x: -108, y: -32 })).toEqual({ blockId: a, port: "north", t: 0.5 });
    // Off the disk (the port's 12.8px): the continuous stand stands —
    // the side's projection at the point's position (t = 0.42, 10px
    // to the edge).
    expect(snapEdgePoint(doc, a, { x: -108, y: -20 })).toEqual({ blockId: a, port: "north", t: 0.42 });
    // The disk's override inside the side (the point 5px along the edge
    // from the port, 6px off it — distMid ~7.8, the disk's; the
    // continuous projection would stand t = 0.55 at 6px: the port's
    // anchor wins, the line locks to the dot).
    expect(snapEdgePoint(doc, a, { x: -95, y: -36 })).toEqual({ blockId: a, port: "north", t: 0.5 });
  });

  it("the sibling search's port disk stands over the siblings (the nearest port wins)", () => {
    const { doc, surface, a, b } = scene();
    // B = (100, 0, 100x60): the north port at (100, -30). The point
    // 4px along the edge from B's north port (distMid ~6.8, inside the
    // disk): the port locks the anchor at t = 0.5 (the continuous
    // projection would stand t = 0.54); A's sides stand far off.
    expect(snapEndpointEdge(doc, surface, { x: 104, y: -36 })).toEqual({ blockId: b, port: "north", t: 0.5 });
    // Off B's disk (the port's 12.65px), over B's north edge (4px to it):
    // the continuous stand stands (t = 0.62) — the stick is the disk's,
    // not the side's.
    expect(snapEndpointEdge(doc, surface, { x: 112, y: -34 })).toEqual({ blockId: b, port: "north", t: 0.62 });
    expect(a).toBeTruthy();
  });
});

describe("the all-surfaces edge snap (the hover / the preview end)", () => {
  const CREATED_AT = "2026-10-10T00:00:00.000Z";

  function twoSurfaces() {
    const doc = createDoc({ id: "any-snap-doc", createdAt: CREATED_AT });
    const s1 = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: s1 });
    doc.setGeometry(a, { x: -60, y: 0, w: 100, h: 60 });
    const s2 = doc.insertBlock("surface");
    const b = doc.insertBlock("shape", { variant: "rect" }, { parent: s2 });
    doc.setGeometry(b, { x: 60, y: 0, w: 100, h: 60 });
    return { doc, a, b };
  }

  it("the nearest edge over any surface wins", () => {
    const { doc, a, b } = twoSurfaces();
    // A's east edge at x = -10, B's west edge at x = 10 (the east / west
    // midpoints stand t = 0.5 over the 60px side). 7px from A's edge,
    // 13px from B's: A's sibling wins.
    expect(snapAnySurfaceEdge(doc, { x: -3, y: 0 })).toEqual({ blockId: a, port: "east", t: 0.5 });
    // 13px from A's edge, 7px from B's: B's sibling wins (the other
    // surface's stand).
    expect(snapAnySurfaceEdge(doc, { x: 3, y: 0 })).toEqual({ blockId: b, port: "west", t: 0.5 });
  });

  it("stands null outside every edge's radius", () => {
    const { doc } = twoSurfaces();
    expect(snapAnySurfaceEdge(doc, { x: 0, y: 200 })).toBeNull();
  });

  it("the port's stick disk locks the anchor (the all-surfaces' parity)", () => {
    const { doc, a } = twoSurfaces();
    // A's north port at (-60, -30): the point 4px off it (distMid ~5.7,
    // inside the disk) locks t = 0.5.
    expect(snapAnySurfaceEdge(doc, { x: -56, y: -34 })).toEqual({ blockId: a, port: "north", t: 0.5 });
  });
});

describe("the press's stand over the pressed block", () => {
  const CREATED_AT = "2026-10-10T00:00:00.000Z";

  function pressScene() {
    const doc = createDoc({ id: "press-stand-doc", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(a, { x: -100, y: 0, w: 100, h: 60 });
    return { doc, a };
  }

  it("stands the port ref over the port's stick disk (the legacy port stand)", () => {
    const { doc, a } = pressScene();
    // A's north port at (-100, -30): the point 3px above it stands the
    // port ref (the line stands from the port on the commit).
    expect(connectorPressStand(doc, a, { x: -100, y: -33 })).toEqual({ blockId: a, port: "north" });
  });

  it("stands the free point at the snapped edge point over the continuous edge", () => {
    const { doc, a } = pressScene();
    // The point 5px above the north edge at x = -130 (t = 0.2, 30px from
    // the port): the FREE stand stands the edge's point — not the cursor
    // — with the frozen direction (the snapped side).
    expect(connectorPressStand(doc, a, { x: -130, y: -35 })).toEqual({
      free: { x: -130, y: -30 },
      freePort: "north",
    });
  });

  it("stands the plain block ref over the interior (the auto anchor stands)", () => {
    const { doc, a } = pressScene();
    expect(connectorPressStand(doc, a, { x: -100, y: 0 })).toEqual({ blockId: a });
  });
});

describe("the pending preview's stand points", () => {
  const box = { x: -100, y: 0, w: 100, h: 60 };

  it("the port stand stands the port's point (not the auto anchor)", () => {
    expect(connectorPreviewFrom(box, "north", { x: 0, y: 0 })).toEqual({ x: -100, y: -30 });
    // The plain block ref stands the edge anchor toward the cursor (the
    // east edge's midpoint — the cursor's straight east of the center).
    expect(connectorPreviewFrom(box, null, { x: 0, y: 0 })).toEqual({ x: -50, y: 0, nx: 1, ny: 0 });
    // The missing block stands the origin (the render's fallback).
    expect(connectorPreviewFrom(null, "north", { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("the end stands the snapped edge point over the snap, the cursor otherwise", () => {
    // The stick: the raw cursor 5px off the edge stands the edge's point.
    expect(connectorPreviewPoint({ x: -130, y: -35 }, { blockId: "a", port: "north", t: 0.2 }, box)).toEqual({
      x: -130,
      y: -30,
    });
    expect(connectorPreviewPoint({ x: 5, y: 7 }, null, box)).toEqual({ x: 5, y: 7 });
    // The missing snap block (the lenient read): the cursor stands.
    expect(connectorPreviewPoint({ x: 5, y: 7 }, { blockId: "gone", port: "north", t: 0.5 }, null)).toEqual({
      x: 5,
      y: 7,
    });
  });
});
