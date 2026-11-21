/**
 * The embed's pan/zoom view (the persisted stand over the block's
 * `zoom` / `panX` / `panY` attrs): the view's model (the scale's range,
 * the zoom's step, the wheel's factor, the identity's restore), the pan's
 * clamp against the scaled embed's overflow, the point-fixed zoom, and the
 * wire's precision stand (the gesture's floating-point's residue must not
 * stand a non-identity's persist).
 */
import { clamp } from "../shared/utils";

/** The zoom range (the min / max scale). */
const EMBED_MIN_SCALE = 0.5;
const EMBED_MAX_SCALE = 4;
/** The toolbar's multiplicative zoom step (per in / out press). */
const EMBED_ZOOM_STEP = 1.2;
/** The wheel's continuous zoom factor (the exponential of the delta, the canvas pinch idiom). */
const EMBED_WHEEL_ZOOM = 0.002;
/** The view's persist debounce (the gesture's bursts stand one doc write per rest). */
const EMBED_PERSIST_DEBOUNCE_MS = 250;

interface EmbedView {
  scale: number;
  x: number;
  y: number;
}

/** The identity view: the iframe at its natural size, filling the wrapper. */
const EMBED_VIEW_IDENTITY: EmbedView = { scale: 1, x: 0, y: 0 };

/** The view over the block's persisted attrs (the null idiom's restore). */
function viewOfAttrs(
  zoom: number | null | undefined,
  panX: number | null | undefined,
  panY: number | null | undefined
): EmbedView {
  return { scale: zoom ?? 1, x: panX ?? 0, y: panY ?? 0 };
}

/**
 * The view's wire stand: the gesture's floating-point's residue must not
 * stand a non-identity's persist (the zoom-out/in's round-trip lands the
 * 0.9999…'s "identity"). The zoom's round to the label's 1%'s precision,
 * the pan's to the 0.1 px (the sub-pixel's residue stands the identity).
 */
function roundViewValue(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Clamp the pan against the scaled embed's overflow. The embed cannot be
 * dragged past the container: at `scale <= 1` it fits (or is smaller) and
 * stands centered with no pan; above 1 the pan is bounded by the overflow so
 * the iframe's edge reaches the wrapper's edge at most.
 */
function clampEmbedPan(scale: number, x: number, y: number, width: number, height: number): { x: number; y: number } {
  if (scale <= 1) {
    return { x: (width * (1 - scale)) / 2, y: (height * (1 - scale)) / 2 };
  }
  return {
    x: clamp(x, -width * (scale - 1), 0),
    y: clamp(y, -height * (scale - 1), 0),
  };
}

/** Zoom keeping the screen point `(cx, cy)` fixed: the content under it stands. */
function zoomAtPoint(view: EmbedView, cx: number, cy: number, nextScale: number): EmbedView {
  const factor = nextScale / view.scale;
  return { scale: nextScale, x: cx - (cx - view.x) * factor, y: cy - (cy - view.y) * factor };
}

export {
  EMBED_MAX_SCALE,
  EMBED_MIN_SCALE,
  EMBED_PERSIST_DEBOUNCE_MS,
  EMBED_VIEW_IDENTITY,
  EMBED_WHEEL_ZOOM,
  EMBED_ZOOM_STEP,
  clampEmbedPan,
  roundViewValue,
  viewOfAttrs,
  zoomAtPoint,
};
export type { EmbedView };
