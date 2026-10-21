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
/** The zoom step (10%). */
const ZOOM_STEP = 0.1;

/**
 * The zoom stops: the 10% grid (0.3, 0.4, …, 4.0) + the 25% floor. The
 * step moves one stop at a time (the grid stands path-independent — the
 * float drift is dropped by the two-decimal round).
 */
const ZOOM_STOPS: number[] = (() => {
  const stops = [MIN_ZOOM];
  for (let stop = Math.ceil(MIN_ZOOM / ZOOM_STEP) * ZOOM_STEP; stop <= MAX_ZOOM + 1e-9; stop += ZOOM_STEP) {
    stops.push(Number(stop.toFixed(2)));
  }
  return stops;
})();

/** The zoom's stop index (the nearest stop; the float drift stands the epsilon). */
function zoomStopIndex(zoom: number): number {
  let index = 0;
  let delta = Infinity;
  ZOOM_STOPS.forEach((stop, stopIndex) => {
    const candidate = Math.abs(zoom - stop);
    if (candidate < delta) {
      delta = candidate;
      index = stopIndex;
    }
  });
  return index;
}
/** The move session's drag threshold (screen px): below it, the press is a click. */
const MOVE_THRESHOLD_PX = 3;

/** The placement tool ids (the dock's tool set; "hand" is a mode, not a tool). */
type CanvasTool =
  "rect" | "rounded" | "ellipse" | "diamond" | "cylinder" | "cloud" | "text" | "frame" | "connector" | "pen";

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
  rounded: { w: 160, h: 80 },
  ellipse: { w: 100, h: 80 },
  diamond: { w: 90, h: 90 },
  cylinder: { w: 100, h: 120 },
  cloud: { w: 130, h: 95 },
  text: { w: 200, h: 40 },
  frame: { w: 320, h: 240 },
  connector: { w: 0, h: 0 }, // the connector carries no own geometry
  pen: { w: 0, h: 0 }, // the pen's geometry is the stroke's bounding box
};

/** Clamps and snaps a zoom value to the nearest stop (the 25%–400% bounds). */
function clampZoom(zoom: number): number {
  return ZOOM_STOPS[zoomStopIndex(zoom)]!;
}

/** The zoom step (direction ±1): one stop, clamped at the stops' bounds. */
function stepZoom(zoom: number, direction: 1 | -1): number {
  const index = zoomStopIndex(zoom);
  const next = index + direction;
  if (next < 0 || next >= ZOOM_STOPS.length) return ZOOM_STOPS[index]!;
  return ZOOM_STOPS[next]!;
}

/** The screen point (center-relative) → the canvas point. */
function screenToCanvas(point: ScreenPoint, zoom: number, pan: ScreenPoint): CanvasPoint {
  return { x: (point.x - pan.x) / zoom, y: (point.y - pan.y) / zoom };
}

/** The canvas point → the screen point (center-relative). */
function canvasToScreen(point: CanvasPoint, zoom: number, pan: ScreenPoint): ScreenPoint {
  return { x: point.x * zoom + pan.x, y: point.y * zoom + pan.y };
}

/**
 * The screen delta → the canvas delta (the zoom divides; the pan is
 * constant during a session and cancels out). Below the threshold the
 * press was a click, not a drag (null).
 */
function screenDeltaToCanvas(dx: number, dy: number, zoom: number): CanvasPoint | null {
  if (Math.hypot(dx, dy) < MOVE_THRESHOLD_PX) return null;
  return { x: dx / zoom, y: dy / zoom };
}

/** The resize handle ids (the eight box handles + the rotate handle). */
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** The box floor of a resize (canvas px, per axis). */
const RESIZE_FLOOR_PX = 20;

/** A complete box (the center-anchor geometry shape). */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The resize math (center-anchor semantics, the Miro edge model): the
 * handle's edge(s) move by the delta, the opposite edge(s) stand, and
 * the center re-derives. Shift on a corner keeps the aspect (the
 * dominant axis decides the scale; the opposite corner stays anchored).
 * The size floors at RESIZE_FLOOR_PX per axis. No-op (a sub-floor / zero
 * delta) results in an equal-value box — the commit's no-op guard drops
 * it.
 */
function resizeBox(box: Box, handle: ResizeHandle, dx: number, dy: number, shift: boolean): Box {
  const left = box.x - box.w / 2;
  const top = box.y - box.h / 2;
  const right = box.x + box.w / 2;
  const bottom = box.y + box.h / 2;

  if (shift && handle.length === 2) {
    // The corner + shift: the aspect stands (the dominant axis decides
    // the scale), the opposite corner is the anchor, and the size floors
    // at the anchor (a past-anchor drag clamps at the floor — no flip).
    // The moving edge's new position gives the scale (the nw/sw handles
    // move the west edge — the width changes by −dx; the ne/se, the east
    // edge — by +dx; the n/s, the height analogously).
    const newWidth = handle.includes("w") ? right - (left + dx) : right + dx - left;
    const newHeight = handle.includes("n") ? bottom - (top + dy) : bottom + dy - top;
    const scaleX = newWidth / box.w;
    const scaleY = newHeight / box.h;
    const scale = Math.abs(scaleX) >= Math.abs(scaleY) ? scaleX : scaleY;
    const w = Math.max(RESIZE_FLOOR_PX, box.w * Math.abs(scale));
    const h = Math.max(RESIZE_FLOOR_PX, box.h * Math.abs(scale));
    const nLeft = handle === "nw" || handle === "sw" ? right - w : left;
    const nRight = handle === "ne" || handle === "se" ? left + w : right;
    const nTop = handle === "nw" || handle === "ne" ? bottom - h : top;
    const nBottom = handle === "sw" || handle === "se" ? top + h : bottom;
    return { x: (nLeft + nRight) / 2, y: (nTop + nBottom) / 2, w: nRight - nLeft, h: nBottom - nTop };
  }

  // The moving edge(s) move by the delta; each clamps at the floor
  // against the standing edge.
  let nLeft = left;
  let nTop = top;
  let nRight = right;
  let nBottom = bottom;
  if (handle.includes("w")) nLeft = Math.min(left + dx, right - RESIZE_FLOOR_PX);
  if (handle.includes("e")) nRight = Math.max(right + dx, left + RESIZE_FLOOR_PX);
  if (handle.includes("n")) nTop = Math.min(top + dy, bottom - RESIZE_FLOOR_PX);
  if (handle.includes("s")) nBottom = Math.max(bottom + dy, top + RESIZE_FLOOR_PX);

  return {
    x: (nLeft + nRight) / 2,
    y: (nTop + nBottom) / 2,
    w: nRight - nLeft,
    h: nBottom - nTop,
  };
}

/**
 * The rotate handle's angle (degrees, clockwise, 0° = up — the handle's
 * home position above the box center). `shift` snaps to the 15° grid.
 * The result normalizes to 0..359 (0 stands for no rotation).
 */
function rotateAngle(center: ScreenPoint, pointer: ScreenPoint, shift: boolean): number {
  const angle = (Math.atan2(pointer.x - center.x, center.y - pointer.y) * 180) / Math.PI;
  let normalized = ((angle % 360) + 360) % 360;
  if (shift) normalized = (Math.round(normalized / 15) * 15) % 360;
  return (Math.round(normalized * 100) / 100) % 360;
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
  MOVE_THRESHOLD_PX,
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
  screenDeltaToCanvas,
  screenToCanvas,
  stepZoom,
};
export type { Box, CanvasMode, CanvasPoint, CanvasTool, PenStroke, ResizeHandle, ScreenPoint, ScreenRect };
