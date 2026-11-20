/** The canvas viewport's geometry types: the space points, the container-space
 *  rectangle, the resize handle ids, and the pen stroke's shape. */

/** A point in the container space, center-relative (px). */
interface ScreenPoint {
  x: number;
  y: number;
}

/** A point in the canvas space (the center-anchor coordinates, px). */
interface CanvasPoint {
  x: number;
  y: number;
}

/** A rectangle in the container space, center-relative (px). */
interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The resize handle ids (the eight box handles). */
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** The pen stroke's bbox geometry + the block-local points. */
interface PenStroke {
  geometry: { x: number; y: number; w: number; h: number };
  points: [number, number][];
}

export type { CanvasPoint, PenStroke, ResizeHandle, ScreenPoint, ScreenRect };
