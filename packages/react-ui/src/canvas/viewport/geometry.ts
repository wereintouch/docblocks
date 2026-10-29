/**
 * The canvas viewport's geometry math (pure): the screen ↔ canvas mapping
 * under the zoom/pan transform (the center-anchor affine — the canvas
 * content wrapper carries `transform: translate(pan) scale(zoom)` with the
 * origin at the container's center, so `screen = zoom * canvas + pan`), the
 * marquee rectangle, the rect intersection, the resize's center-anchor math
 * (the Miro edge model), and the pen stroke's bounding box.
 */
import { MOVE_THRESHOLD_PX, RESIZE_FLOOR_PX } from "./constants";
import type { Box, CanvasPoint, PenStroke, ResizeHandle, ScreenPoint, ScreenRect } from "./models";

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

/**
 * The resize math (center-anchor semantics, the Miro edge model): the
 * handle's edge(s) move by the delta, the opposite edge(s) stand, and the
 * center re-derives. Shift on a corner keeps the aspect (the dominant axis
 * decides the scale; the opposite corner stays anchored). The size floors
 * at RESIZE_FLOOR_PX per axis. A container's resize additionally clamps
 * each edge at the members' union box (the absent `memberUnion` — the
 * shape's resize — keeps the plain floor-only box). No-op (a sub-floor /
 * zero delta) results in an equal-value box — the commit's no-op guard
 * drops it.
 */
function resizeBox(box: Box, handle: ResizeHandle, dx: number, dy: number, shift: boolean, memberUnion?: Box): Box {
  const left = box.x - box.w / 2;
  const top = box.y - box.h / 2;
  const right = box.x + box.w / 2;
  const bottom = box.y + box.h / 2;

  let result: Box;
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
    result = { x: (nLeft + nRight) / 2, y: (nTop + nBottom) / 2, w: nRight - nLeft, h: nBottom - nTop };
  } else {
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
    result = {
      x: (nLeft + nRight) / 2,
      y: (nTop + nBottom) / 2,
      w: nRight - nLeft,
      h: nBottom - nTop,
    };
  }

  // The container's members' union stand (the absent union keeps the box).
  return memberUnion === undefined ? result : clampResizeBoxToUnion(box, result, memberUnion);
}

/** The union of the boxes (the bounding box that covers all; null for an
 * empty set — the resize keeps the plain floor). */
function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x - box.w / 2);
    minY = Math.min(minY, box.y - box.h / 2);
    maxX = Math.max(maxX, box.x + box.w / 2);
    maxY = Math.max(maxY, box.y + box.h / 2);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}

/**
 * The container's resize's per-edge union clamp: each edge stops at the
 * members' union box — the shrink goes up to a figure (the edge does not
 * pass inside the members' bounding shell), the grow is unlimited. A member
 * already outside the edge (the degenerate mid-state) does not pull the box
 * into a grow: the edge's bound is the member's edge and the current edge
 * (max/min), so the edge neither passes inside further nor is forced
 * outward. The clamp only ever enlarges (or holds) the box against the
 * resize's own result, so the per-axis floor stands never violated by it;
 * the shift-aspect yields to the clamp when a bound binds (the box may break
 * the aspect to stay over the members).
 */
function clampResizeBoxToUnion(original: Box, box: Box, union: Box): Box {
  const oLeft = original.x - original.w / 2;
  const oRight = original.x + original.w / 2;
  const oTop = original.y - original.h / 2;
  const oBottom = original.y + original.h / 2;
  const uLeft = union.x - union.w / 2;
  const uRight = union.x + union.w / 2;
  const uTop = union.y - union.h / 2;
  const uBottom = union.y + union.h / 2;

  let nLeft = box.x - box.w / 2;
  let nRight = box.x + box.w / 2;
  let nTop = box.y - box.h / 2;
  let nBottom = box.y + box.h / 2;
  nLeft = Math.min(nLeft, Math.max(uLeft, oLeft));
  nRight = Math.max(nRight, Math.min(uRight, oRight));
  nTop = Math.min(nTop, Math.max(uTop, oTop));
  nBottom = Math.max(nBottom, Math.min(uBottom, oBottom));

  return { x: (nLeft + nRight) / 2, y: (nTop + nBottom) / 2, w: nRight - nLeft, h: nBottom - nTop };
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
  canvasToScreen,
  clampResizeBoxToUnion,
  marqueeRect,
  penStroke,
  rectsIntersect,
  resizeBox,
  unionBox,
  screenDeltaToCanvas,
  screenToCanvas,
};
