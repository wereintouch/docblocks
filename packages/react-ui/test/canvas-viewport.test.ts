// The canvas viewport's pure geometry: the screen ↔ canvas mapping under
// the zoom/pan transform, the marquee rectangle, and the pen stroke's
// bounding box.
import { describe, expect, it } from "vitest";

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
  rotateAngle,
  screenToCanvas,
  stepZoom,
} from "../src/canvas/viewport";

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

describe("rotateAngle", () => {
  const center = { x: 0, y: 0 };

  it("reads the pointer angle clockwise from up (0..359)", () => {
    expect(rotateAngle(center, { x: 0, y: -100 }, false)).toBe(0);
    expect(rotateAngle(center, { x: 100, y: 0 }, false)).toBe(90);
    expect(rotateAngle(center, { x: 0, y: 100 }, false)).toBe(180);
    expect(rotateAngle(center, { x: -100, y: 0 }, false)).toBe(270);
  });

  it("snaps to the 15 degree grid on shift", () => {
    expect(rotateAngle(center, { x: 34.2, y: -93.97 }, true)).toBe(15);
    expect(rotateAngle(center, { x: 17.1, y: -98.48 }, true)).toBe(15);
    expect(rotateAngle(center, { x: 50, y: -86.6 }, true)).toBe(30);
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
