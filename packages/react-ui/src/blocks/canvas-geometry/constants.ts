/** The canvas geometry's constants (the default sizes, the port normals,
 * the canvas-only element types, the orthogonal's stub / detour /
 * tolerance). */
import type { BlockType } from "docblocks-core";

import type { CanvasPort } from "./models";

/** The canvas-only element types (they render ONLY inside a surface). */
const CANVAS_SUB_TYPES: readonly BlockType[] = ["shape", "connector", "canvas-text", "frame", "group"];

/** The default size (px) of a canvas element without a geometry. */
const DEFAULT_CANVAS_ITEM_SIZE = 100;

/** The default size (px) of the page miniature when the root carries no geometry. */
const DEFAULT_PAGE_SIZE = { w: 720, h: 960 } as const;

/** The port's outward normal (the curved line bows out from it). */
const PORT_NORMAL: Record<CanvasPort, { nx: number; ny: number }> = {
  north: { nx: 0, ny: -1 },
  east: { nx: 1, ny: 0 },
  south: { nx: 0, ny: 1 },
  west: { nx: -1, ny: 0 },
};

const ORTHO_STUB_PX = 12;
/** The orthogonal detour's offset beyond the endpoints' span (canvas px). */
const ORTHO_DETOUR_PX = 24;
/** The obstacle detour's clearance from the obstacle's edge (canvas px —
 * the parity with the stub's offset). */
const ORTHO_AVOID_MARGIN_PX = 12;
/** The route-avoidance's boundary tolerance (canvas px — a route 0.5px
 * off a figure's edge stands clear of it). */
const ROUTE_EPS = 0.5;

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
