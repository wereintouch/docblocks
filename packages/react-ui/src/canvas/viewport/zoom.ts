/**
 * The canvas viewport's zoom math: the stop grid's nearest-stop index, the
 * clamped zoom (snap to the nearest stop), the one-stop step (clamped at
 * the bounds), and the pinch's continuous zoom (the exponential of the
 * wheel's delta, clamped at the 25%–400% bounds).
 */
import { MAX_ZOOM, MIN_ZOOM, PINCH_ZOOM_COEFF, ZOOM_STOPS } from "./constants";

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

/**
 * The pinch's continuous zoom (the trackpad's smooth stand): the zoom
 * scales by the exponential of the wheel's delta (the small delta stands
 * the proportional step — the pinch reacts without the threshold's lag)
 * and clamps at the 25%–400% bounds (a delta past the bound stands the
 * no-op, like the step's bound).
 */
function pinchZoom(zoom: number, deltaY: number): number {
  const next = zoom * Math.exp(-deltaY * PINCH_ZOOM_COEFF);
  return Number(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)).toFixed(4));
}

export { clampZoom, pinchZoom, stepZoom };
