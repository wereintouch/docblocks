import type { BlockType } from "docblocks-core";

/** The canvas geometry's shared types (the box / ports / endpoint /
 *  connector-path shapes) and constants (the default sizes, the port
 *  normals, the orthogonal's stub / detour / tolerance). */

/** The canvas-only element types (they render ONLY inside a surface). */
const CANVAS_SUB_TYPES: readonly BlockType[] = ["shape", "connector", "canvas-text", "frame"];

/** The default size (px) of a canvas element without a geometry. */
const DEFAULT_CANVAS_ITEM_SIZE = 100;

/** The default size (px) of the page miniature when the root carries no geometry. */
const DEFAULT_PAGE_SIZE = { w: 720, h: 960 } as const;

/** The connector's box (the center-anchor geometry shape). */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The four edge ports of a box (the edge midpoints, the center-anchor space). */
type CanvasPort = "north" | "east" | "south" | "west";

interface Ports {
  north: { x: number; y: number };
  east: { x: number; y: number };
  south: { x: number; y: number };
  west: { x: number; y: number };
}

/** An endpoint resolved to a point + the outward normal the line leaves at. */
interface EndpointPoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** The port's outward normal (the curved line bows out from it). */
const PORT_NORMAL: Record<CanvasPort, { nx: number; ny: number }> = {
  north: { nx: 0, ny: -1 },
  east: { nx: 1, ny: 0 },
  south: { nx: 0, ny: 1 },
  west: { nx: -1, ny: 0 },
};

/** The connector's line shape (the absent variant renders straight). */
type ConnectorVariant = "straight" | "orthogonal" | "curved";

/** An edge anchor: the border point + the anchored edge's outward normal. */
interface EdgeAnchor {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** The connector's computed path (the surface coordinate space, the center origin). */
interface ConnectorPath {
  /** The SVG path data. */
  d: string;
  /** The line's end point (the arrowhead's tip, on the end box's edge). */
  end: { x: number; y: number };
  /** The line's midpoint (the label's seat). */
  mid: { x: number; y: number };
}

const ORTHO_STUB_PX = 12;
/** The orthogonal detour's offset beyond the endpoints' span (canvas px). */
const ORTHO_DETOUR_PX = 24;
/** The obstacle detour's clearance from the obstacle's edge (canvas px —
 * the parity with the stub's offset). */
const ORTHO_AVOID_MARGIN_PX = 12;
/** The route-avoidance's boundary tolerance (canvas px — a route 0.5px
 * off a figure's edge stands clear of it). */
const ROUTE_EPS = 0.5;

/** A point of the computed route (the orthogonal's bend space). */
interface RoutePoint {
  x: number;
  y: number;
}

export {
  CANVAS_SUB_TYPES,
  DEFAULT_CANVAS_ITEM_SIZE,
  DEFAULT_PAGE_SIZE,
  ORTHO_AVOID_MARGIN_PX,
  ORTHO_DETOUR_PX,
  ORTHO_STUB_PX,
  PORT_NORMAL,
  ROUTE_EPS,
};
export type { Box, CanvasPort, ConnectorPath, ConnectorVariant, EdgeAnchor, EndpointPoint, Ports, RoutePoint };
