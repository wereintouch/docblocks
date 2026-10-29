/**
 * The canvas viewport's constants: the zoom bounds / step / the stop grid
 * (the 10% grid over the 25% floor), the pinch's exponential coefficient,
 * the move session's drag threshold, the placement tool's default sizes,
 * and the resize's per-axis floor.
 */
import type { CanvasTool } from "./models";

/** The zoom bounds (25%–400%). */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
/** The zoom step (10%). */
const ZOOM_STEP = 0.1;

/** The pinch (the ctrl/cmd wheel) zoom's coefficient : the wheel's delta
 * stands the exponential factor — the continuous zoom (the trackpad's
 * smooth stand), no step threshold. */
const PINCH_ZOOM_COEFF = 0.005;

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

/** The move session's drag threshold (screen px): below it, the press is a click. */
const MOVE_THRESHOLD_PX = 3;

/** The default size of a placed tool block (the center anchor is the click point). */
const TOOL_SIZES: Record<CanvasTool, { w: number; h: number }> = {
  rect: { w: 160, h: 80 },
  rounded: { w: 160, h: 80 },
  ellipse: { w: 100, h: 80 },
  diamond: { w: 90, h: 90 },
  cylinder: { w: 100, h: 120 },
  cloud: { w: 130, h: 95 },
  container: { w: 240, h: 160 },
  text: { w: 200, h: 40 },
  frame: { w: 320, h: 240 },
  connector: { w: 0, h: 0 }, // the connector carries no own geometry
  pen: { w: 0, h: 0 }, // the pen's geometry is the stroke's bounding box
};

/** The box floor of a resize (canvas px, per axis). */
const RESIZE_FLOOR_PX = 20;

export { MAX_ZOOM, MIN_ZOOM, MOVE_THRESHOLD_PX, PINCH_ZOOM_COEFF, RESIZE_FLOOR_PX, TOOL_SIZES, ZOOM_STOPS, ZOOM_STEP };
