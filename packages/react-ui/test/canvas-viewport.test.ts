// The canvas viewport's pure geometry: the screen ↔ canvas mapping under
// the zoom/pan transform, the marquee rectangle, and the pen stroke's
// bounding box. + the connector endpoints' CONTINUOUS edge snap (the
// side + the fractional position along it).
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  RESIZE_FLOOR_PX,
  TOOL_SIZES,
  ZOOM_STEP,
  canvasToScreen,
  clampZoom,
  marqueeRect,
  penStroke,
  rectsIntersect,
  resizeBox,
  screenToCanvas,
  stepZoom,
} from "../src/canvas/viewport";
import {
  connectorPressStand,
  connectorPreviewFrom,
  connectorPreviewPoint,
  snapAnySurfaceEdge,
  snapEdgePoint,
  snapEndpointEdge,
} from "../src/canvas/viewport/utils";

describe("resizeBox", () => {
  const box = { x: 100, y: 100, w: 200, h: 100 };

  it("moves the handle's edge(s), the opposite edge(s) stand, the center re-derives", () => {
    expect(resizeBox(box, "e", 30, 0, false)).toEqual({ x: 115, y: 100, w: 230, h: 100 });
    expect(resizeBox(box, "w", -40, 0, false)).toEqual({ x: 80, y: 100, w: 240, h: 100 });
    expect(resizeBox(box, "n", 0, -20, false)).toEqual({ x: 100, y: 90, w: 200, h: 120 });
    expect(resizeBox(box, "se", 10, 10, false)).toEqual({ x: 105, y: 105, w: 210, h: 110 });
  });

  it("floors the moving edge at the floor against the standing edge", () => {
    // The w edge dragged far right: the width floors (the e edge stands).
    expect(resizeBox(box, "w", 500, 0, false)).toEqual({ x: 190, y: 100, w: RESIZE_FLOOR_PX, h: 100 });
    // The n edge dragged far down: the s edge stands, the height floors.
    expect(resizeBox(box, "n", 0, 500, false)).toEqual({ x: 100, y: 140, w: 200, h: RESIZE_FLOOR_PX });
  });

  it("is a no-op (equal-value box) for a zero delta", () => {
    expect(resizeBox(box, "se", 0, 0, false)).toEqual(box);
  });

  it("keeps the aspect on a shift corner (the dominant axis decides)", () => {
    // Both axes at 1.5x.
    expect(resizeBox(box, "se", 100, 25, true)).toEqual({ x: 150, y: 125, w: 300, h: 150 });
    // The height axis dominates (2x over 1.25x): the width follows.
    expect(resizeBox(box, "se", 50, 100, true)).toEqual({ x: 200, y: 150, w: 400, h: 200 });
    // The opposite corner is the anchor (the nw drag grows around the se corner).
    expect(resizeBox(box, "nw", -100, -50, true)).toEqual({ x: 50, y: 75, w: 300, h: 150 });
  });

  it("floors the shift corner at the anchor (no flip-past)", () => {
    expect(resizeBox(box, "se", -198, -98, true)).toEqual({ x: 10, y: 60, w: RESIZE_FLOOR_PX, h: RESIZE_FLOOR_PX });
  });
});

describe("clampZoom", () => {
  it("keeps a zoom inside the 25%–400% bounds", () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(10)).toBe(MAX_ZOOM);
    expect(clampZoom(1)).toBe(1);
  });

  it("snaps to the nearest stop (the 10% grid + the 25% floor)", () => {
    expect(clampZoom(0.31)).toBe(0.3);
    expect(clampZoom(0.38)).toBe(0.4);
    expect(clampZoom(1.16)).toBe(1.2);
    expect(clampZoom(0.26)).toBe(0.25);
    expect(ZOOM_STEP).toBe(0.1);
  });
});

describe("stepZoom", () => {
  it("steps by one stop (the 10% step)", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1.1, -1)).toBe(1);
    expect(stepZoom(0.3, -1)).toBe(0.25);
    expect(stepZoom(0.25, 1)).toBe(0.3);
  });

  it("clamps at the bounds", () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });
});

describe("screenToCanvas / canvasToScreen", () => {
  it("is the identity at zoom 1, pan 0", () => {
    const point = { x: 40, y: -60 };
    expect(screenToCanvas(point, 1, { x: 0, y: 0 })).toEqual(point);
    expect(canvasToScreen(point, 1, { x: 0, y: 0 })).toEqual(point);
  });

  it("applies screen = zoom * canvas + pan", () => {
    const zoom = 2;
    const pan = { x: 10, y: 20 };
    const canvas = { x: 15, y: 20 };
    expect(canvasToScreen(canvas, zoom, pan)).toEqual({ x: 40, y: 60 });
    expect(screenToCanvas({ x: 40, y: 60 }, zoom, pan)).toEqual(canvas);
  });

  it("round-trips at fractional zoom and a negative pan", () => {
    const zoom = 0.5;
    const pan = { x: -12.5, y: 30 };
    const canvas = { x: -80, y: 12.5 };
    expect(screenToCanvas(canvasToScreen(canvas, zoom, pan), zoom, pan)).toEqual(canvas);
  });
});

describe("marqueeRect", () => {
  it("normalizes the two corners into the rectangle", () => {
    expect(marqueeRect({ x: 0, y: 0 }, { x: 30, y: 20 })).toEqual({ left: 0, top: 0, width: 30, height: 20 });
    expect(marqueeRect({ x: 30, y: 20 }, { x: 0, y: 0 })).toEqual({ left: 0, top: 0, width: 30, height: 20 });
    expect(marqueeRect({ x: -10, y: 5 }, { x: 5, y: -5 })).toEqual({ left: -10, top: -5, width: 15, height: 10 });
  });

  it("is the zero-area rect for a click (no drag)", () => {
    expect(marqueeRect({ x: 7, y: 3 }, { x: 7, y: 3 })).toEqual({ left: 7, top: 3, width: 0, height: 0 });
  });
});

describe("rectsIntersect", () => {
  const a = { left: 0, top: 0, width: 10, height: 10 };
  it("intersects on an overlap", () => {
    expect(rectsIntersect(a, { left: 5, top: 5, width: 10, height: 10 })).toBe(true);
    expect(rectsIntersect(a, { left: -5, top: -5, width: 6, height: 6 })).toBe(true);
    expect(rectsIntersect(a, { left: -20, top: -20, width: 40, height: 40 })).toBe(true);
  });

  it("does not intersect on a touch or apart", () => {
    expect(rectsIntersect(a, { left: 10, top: 0, width: 10, height: 10 })).toBe(false);
    expect(rectsIntersect(a, { left: 11, top: 0, width: 10, height: 10 })).toBe(false);
    expect(rectsIntersect(a, { left: 0, top: 10, width: 10, height: 10 })).toBe(false);
  });
});

describe("penStroke", () => {
  it("maps the stroke to the bbox geometry (center anchor) and local points", () => {
    const stroke = penStroke([
      { x: 10, y: 20 },
      { x: 30, y: 10 },
      { x: 30, y: 40 },
      { x: 10, y: 20 },
    ]);
    expect(stroke).toEqual({
      geometry: { x: 20, y: 25, w: 20, h: 30 },
      points: [
        [0, 10],
        [20, 0],
        [20, 30],
        [0, 10],
      ],
    });
  });

  it("is null for a degenerate stroke (one point or a point stroke)", () => {
    expect(penStroke([])).toBe(null);
    expect(penStroke([{ x: 5, y: 5 }])).toBe(null);
    expect(
      penStroke([
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ])
    ).toBe(null);
  });

  it("keeps the degenerate axis at 1px (a straight line has one zero axis)", () => {
    const vertical = penStroke([
      { x: 0, y: 0 },
      { x: 0, y: 40 },
    ]);
    expect(vertical).toEqual({
      geometry: { x: 0, y: 20, w: 1, h: 40 },
      points: [
        [0, 0],
        [0, 40],
      ],
    });
  });
});

describe("TOOL_SIZES", () => {
  it("has a positive default size for every placement tool", () => {
    for (const [tool, size] of Object.entries(TOOL_SIZES)) {
      if (tool === "connector" || tool === "pen") {
        // The pen's and the connector's geometry come from the stroke / the endpoints.
        expect(size).toEqual({ w: 0, h: 0 });
      } else {
        expect(size.w, tool).toBeGreaterThan(0);
        expect(size.h, tool).toBeGreaterThan(0);
      }
    }
  });
});

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
