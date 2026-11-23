// @vitest-environment jsdom
// The connector's edge anchors + the endpoint's resolution (the four edge
// ports, the port's frozen direction, the sticky edge anchor, the lenient
// reads): the pure functions of canvas-geometry.
import { describe, expect, it } from "vitest";

import { edgeAnchor, edgePointOf, endpointPointOf, portOfNormal, portsOf } from "../src/canvas/geometry";

/** The scene's box (the center-anchor geometry shape). */
const A = { x: -300, y: -100, w: 200, h: 100 };

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

  it("a port outside the known set (a future minor's data) stands the lenient fallback, no crash", () => {
    const unknownPort = "topright" as unknown as Parameters<typeof endpointPointOf>[0]["port"];
    // A free point: the unknown port stands absent (the zero normal).
    expect(endpointPointOf({ x: 120, y: -40, port: unknownPort }, siblings, blocks, { x: 0, y: 0 })).toEqual({
      x: 120,
      y: -40,
      nx: 0,
      ny: 0,
    });
    // A block ref: the unknown port stands the sticky edge anchor toward
    // the other end (the line stays visible — the same math as the
    // portless ref).
    const point = endpointPointOf({ blockId: "s1", port: unknownPort }, siblings, blocks, { x: 300, y: 100 });
    expect(point?.x).toBeCloseTo(-200);
    expect(point?.y).toBeCloseTo(-100 + (100 / 600) * 200);
    expect(point?.nx).toBe(1);
  });
});
