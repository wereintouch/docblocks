/** The mermaid viewport's pure view math: the scale / pan bounds, the
 *  view's canonical forms (the restore, the rounding, the pan's clamp
 *  over the scaled overflow, the point-fixed zoom). */
import { clamp } from "../shared/utils";

/** The zoom range (the min / max scale). */
const VIEWPORT_MIN_SCALE = 0.25;
const VIEWPORT_MAX_SCALE = 4;
/** The toolbar's multiplicative zoom step (per in / out press). */
const VIEWPORT_ZOOM_STEP = 1.2;
/** The wheel's continuous zoom factor (the exponential of the delta, the canvas pinch idiom). */
const VIEWPORT_WHEEL_ZOOM = 0.002;
/** The view's persist debounce (the gesture's bursts stand one doc write per rest). */
const VIEWPORT_PERSIST_DEBOUNCE_MS = 250;

interface ViewportView {
  scale: number;
  x: number;
  y: number;
}

/** The identity view: the diagram at its natural size, no pan. */
const VIEWPORT_IDENTITY: ViewportView = { scale: 1, x: 0, y: 0 };

/** The view over the block's persisted attrs (the null idiom's restore). */
function viewOfAttrs(
  zoom: number | null | undefined,
  panX: number | null | undefined,
  panY: number | null | undefined
): ViewportView {
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

/** The diagram's natural size (the transform's no-op's stand — the
 *  transform never affects the layout). The svg's box (the diagram's
 *  true extent) over the layer's box (the no-svg's stand — the error /
 *  the loading's states). */
function measureContent(layer: HTMLElement | null): { w: number; h: number } {
  if (layer === null) return { w: 0, h: 0 };
  const svg = layer.querySelector("svg");
  const w = svg !== null ? svg.clientWidth || layer.clientWidth : layer.clientWidth;
  const h = svg !== null ? svg.clientHeight || layer.clientHeight : layer.clientHeight;
  return { w, h };
}

/**
 * Clamp the pan against the scaled diagram's overflow over the wrapper:
 * the rendered diagram bigger than the wrapper bounds the pan (the
 * diagram's edge reaches the wrapper's edge at most), smaller centers it.
 */
function clampPan(
  scale: number,
  x: number,
  y: number,
  wrapW: number,
  wrapH: number,
  contentW: number,
  contentH: number
): { x: number; y: number } {
  if (wrapW <= 0 || wrapH <= 0) return { x, y };
  const cw = contentW > 0 ? contentW : wrapW;
  const ch = contentH > 0 ? contentH : wrapH;
  const rx = cw * scale;
  const ry = ch * scale;
  return {
    x: rx > wrapW ? clamp(x, wrapW - rx, 0) : (wrapW - rx) / 2,
    y: ry > wrapH ? clamp(y, wrapH - ry, 0) : (wrapH - ry) / 2,
  };
}

/** Zoom keeping the screen point `(cx, cy)` fixed: the content under it stands. */
function zoomAtPoint(view: ViewportView, cx: number, cy: number, nextScale: number): ViewportView {
  const factor = nextScale / view.scale;
  return { scale: nextScale, x: cx - (cx - view.x) * factor, y: cy - (cy - view.y) * factor };
}

export {
  VIEWPORT_IDENTITY,
  VIEWPORT_MAX_SCALE,
  VIEWPORT_MIN_SCALE,
  VIEWPORT_PERSIST_DEBOUNCE_MS,
  VIEWPORT_WHEEL_ZOOM,
  VIEWPORT_ZOOM_STEP,
  clampPan,
  measureContent,
  roundViewValue,
  viewOfAttrs,
  zoomAtPoint,
};
export type { ViewportView };
