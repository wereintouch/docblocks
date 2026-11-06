/** The canvas geometry's shared types (the box / ports / endpoint /
 * connector-path shapes). The constants stand in `constants.ts`.
 */
import type { Block } from "docblocks-core";

/** The shape block's view (the schema's `shape` member of the block union). */
type ShapeBlockView = Extract<Block, { type: "shape" }>;

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

/** The orthogonal detour's offset beyond the endpoints' span (canvas px). */
/** The obstacle detour's clearance from the obstacle's edge (canvas px —
 * the parity with the stub's offset). */
/** The route-avoidance's boundary tolerance (canvas px — a route 0.5px
 * off a figure's edge stands clear of it). */

/** A point of the computed route (the orthogonal's bend space). */
interface RoutePoint {
  x: number;
  y: number;
}

export type {
  Box,
  CanvasPort,
  ConnectorPath,
  ConnectorVariant,
  EdgeAnchor,
  EndpointPoint,
  Ports,
  RoutePoint,
  ShapeBlockView,
};
