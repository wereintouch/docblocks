/**
 * The canvas viewport geometry (pure): the screen ↔ canvas mapping under
 * the zoom/pan transform, the marquee rectangle, and the pen stroke
 * bounding box.
 *
 * The canvas content wrapper carries
 * `transform: translate(pan) scale(zoom)` with the transform origin at
 * the canvas container's CENTER, and every element stands at
 * (center + x, center + y) in the canvas space (the center-anchor
 * geometry model). The mapping is the single affine
 * `screen = zoom * canvas + pan` (screen in the container space,
 * center-relative), so `canvas = (screen - pan) / zoom`.
 */

/** The zoom bounds (25%–400%). */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
/** The zoom button step (25%). */
const ZOOM_STEP = 0.25;

/** The placement tool ids (the dock's tool set; "hand" is a mode, not a tool). */
type CanvasTool = "rect" | "ellipse" | "diamond" | "line" | "text" | "frame" | "connector" | "pen";

/** The pointer mode (the dock's hand toggle). */
type CanvasMode = "default" | "pan";

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

/** The default size of a placed tool block (the center anchor is the click point). */
const TOOL_SIZES: Record<CanvasTool, { w: number; h: number }> = {
  rect: { w: 160, h: 80 },
  ellipse: { w: 100, h: 80 },
  diamond: { w: 90, h: 90 },
  line: { w: 140, h: 60 },
  text: { w: 200, h: 40 },
  frame: { w: 320, h: 240 },
  connector: { w: 0, h: 0 }, // the connector carries no own geometry
  pen: { w: 0, h: 0 }, // the pen's geometry is the stroke's bounding box
};

/** Clamps and snaps a zoom value to the step grid (the 25%–400% bounds). */
function clampZoom(zoom: number): number {
  const snapped = Math.round(zoom / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, snapped));
}

/** The zoom step from a button (direction ±1), clamped to the bounds. */
function stepZoom(zoom: number, direction: 1 | -1): number {
  return clampZoom(zoom + direction * ZOOM_STEP);
}

/** The screen point (center-relative) → the canvas point. */
function screenToCanvas(point: ScreenPoint, zoom: number, pan: ScreenPoint): CanvasPoint {
  return { x: (point.x - pan.x) / zoom, y: (point.y - pan.y) / zoom };
}

/** The canvas point → the screen point (center-relative). */
function canvasToScreen(point: CanvasPoint, zoom: number, pan: ScreenPoint): ScreenPoint {
  return { x: point.x * zoom + pan.x, y: point.y * zoom + pan.y };
}

/** The marquee rectangle from the drag's two corners (normalized). */
function marqueeRect(start: ScreenPoint, end: ScreenPoint): ScreenRect {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/** The rect intersection (the zero-area edge: touching sides do not intersect). */
function rectsIntersect(a: ScreenRect, b: ScreenRect): boolean {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

/** The pen stroke's bbox geometry + the block-local points. */
interface PenStroke {
  geometry: { x: number; y: number; w: number; h: number };
  points: [number, number][];
}

/**
 * The pen stroke → the shape's geometry (the bbox, the center anchor) +
 * the block-local points (0..w, 0..h). Null when the stroke has no area
 * (a point or a zero-area line): the stroke is not created.
 */
function penStroke(points: CanvasPoint[]): PenStroke | null {
  if (points.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w === 0 && h === 0) return null;
  return {
    geometry: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: Math.max(w, 1), h: Math.max(h, 1) },
    points: points.map((point) => [point.x - minX, point.y - minY]),
  };
}

export {
  MAX_ZOOM,
  MIN_ZOOM,
  TOOL_SIZES,
  ZOOM_STEP,
  canvasToScreen,
  clampZoom,
  marqueeRect,
  penStroke,
  rectsIntersect,
  screenToCanvas,
  stepZoom,
};
export type { CanvasMode, CanvasPoint, CanvasTool, PenStroke, ScreenPoint, ScreenRect };
