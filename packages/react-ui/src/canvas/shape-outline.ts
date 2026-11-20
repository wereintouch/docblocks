/** The canvas shape's outline geometry: the rendered figure's path (the hit
 * zones' contour — a figure without a fill is hit on its outline, not on its
 * box) and the path's flattening into a polyline with the point-to-polyline
 * distance. The string-drawn variants stand the renderer's own builders
 * (`freehandPath`, `cylinderPaths`, `cloudPath`, `linePath` — the figure and
 * the hit zone stand one source); the element-drawn variants (`rect`,
 * `rounded`, `ellipse`, `diamond`) stand the path equivalent of the element
 * the renderer paints. The box-proportional constants (the corner radius,
 * the cylinder's caps, the cloud's silhouette) mirror the renderer's. */
import type { ShapeAttrs } from "docblocks-core";

/** The renderer's default stroke width (canvas px) — the outline's inset. */
const DEFAULT_SHAPE_STROKE_WIDTH = 2;

/** The corner radius's fraction of the smaller side (the `rounded` figure). */
const ROUNDED_RADIUS_RATIO = 0.15;

/** The freehand stroke's path (the shape's own `points`, block-local px). */
function freehandPath(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
}

/** The cylinder's body and its top-cap seam (the DB figure). */
function cylinderPaths(w: number, h: number, strokeWidth: number): { body: string; seam: string } {
  const inset = strokeWidth / 2;
  const halfW = Math.max(w - strokeWidth, 0) / 2;
  const capH = Math.min(w * 0.15, (h - strokeWidth) * 0.3);
  const topY = inset + capH;
  const botY = h - inset - capH;
  return {
    body: `M ${inset} ${topY} A ${halfW} ${capH} 0 0 1 ${w - inset} ${topY} L ${w - inset} ${botY} A ${halfW} ${capH} 0 0 1 ${inset} ${botY} Z`,
    seam: `M ${inset} ${topY} A ${halfW} ${capH} 0 0 0 ${w - inset} ${topY}`,
  };
}

/** The cloud's silhouette, mirrored over its vertical axis and scaled to the
 * box (the arc radii scale anisotropically). */
function cloudPath(w: number, h: number, strokeWidth: number): string {
  const inset = strokeWidth / 2;
  const boxW = Math.max(w - strokeWidth, 0);
  const boxH = Math.max(h - strokeWidth, 0);
  const px = (x: number) => inset + (x - 2) * (boxW / 19.5);
  const py = (y: number) => inset + (y - 3) * (boxH / 16);
  const rx7 = 7 * (boxW / 19.5);
  const ry7 = 7 * (boxH / 16);
  const rx45 = 4.5 * (boxW / 19.5);
  const ry45 = 4.5 * (boxH / 16);
  return `M ${px(6)} ${py(19)} H ${px(14.5)} A ${rx7} ${ry7} 0 1 0 ${px(7.79)} ${py(10)} H ${px(6)} A ${rx45} ${ry45} 0 1 0 ${px(6)} ${py(19)} Z`;
}

/** The legacy `line` figure: the box's diagonal. */
function linePath(w: number, h: number): string {
  return `M 0 0 L ${w} ${h}`;
}

/** The rect's (the rounded rect's) path over the figure's inset box. */
function rectPath(w: number, h: number, strokeWidth: number, radius: number): string {
  const inset = strokeWidth / 2;
  const right = Math.max(w - strokeWidth, 0) + inset;
  const bottom = Math.max(h - strokeWidth, 0) + inset;
  if (radius <= 0) return `M ${inset} ${inset} H ${right} V ${bottom} H ${inset} Z`;
  const r = Math.min(radius, (right - inset) / 2, (bottom - inset) / 2);
  return [
    `M ${inset + r} ${inset}`,
    `H ${right - r}`,
    `A ${r} ${r} 0 0 1 ${right} ${inset + r}`,
    `V ${bottom - r}`,
    `A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
    `H ${inset + r}`,
    `A ${r} ${r} 0 0 1 ${inset} ${bottom - r}`,
    `V ${inset + r}`,
    `A ${r} ${r} 0 0 1 ${inset + r} ${inset}`,
    "Z",
  ].join(" ");
}

/** The ellipse's path over the figure's inset box. */
function ellipsePath(w: number, h: number, strokeWidth: number): string {
  const cx = w / 2;
  const cy = h / 2;
  const rx = Math.max(w - strokeWidth, 0) / 2;
  const ry = Math.max(h - strokeWidth, 0) / 2;
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
}

/** The diamond's path over the figure's inset box. */
function diamondPath(w: number, h: number, strokeWidth: number): string {
  const inset = strokeWidth / 2;
  return `M ${w / 2} ${inset} L ${w - inset} ${h / 2} L ${w / 2} ${h - inset} L ${inset} ${h / 2} Z`;
}

/**
 * The shape's outline path over the given box (the resize preview's live box
 * included). `null` for a variant the registry does not know (the lenient
 * reader's stand — the hit zone keeps the box).
 */
function shapeOutlinePath(attrs: ShapeAttrs | undefined, box: { w: number; h: number }): string | null {
  const w = Math.max(box.w, 0);
  const h = Math.max(box.h, 0);
  const strokeWidth = attrs?.strokeWidth ?? DEFAULT_SHAPE_STROKE_WIDTH;
  if (attrs?.points !== undefined && attrs.points.length > 1) return freehandPath(attrs.points);
  // The stored variant is wire data: the legacy `line` stands outside the
  // registry's union, so the read stands the raw string.
  const variant: string | undefined = attrs?.variant;
  switch (variant) {
    case "rect":
      return rectPath(w, h, strokeWidth, 0);
    case "rounded":
      return rectPath(w, h, strokeWidth, Math.min(w, h) * ROUNDED_RADIUS_RATIO);
    case "ellipse":
      return ellipsePath(w, h, strokeWidth);
    case "diamond":
      return diamondPath(w, h, strokeWidth);
    case "cylinder":
      return cylinderPaths(w, h, strokeWidth).body;
    case "cloud":
      return cloudPath(w, h, strokeWidth);
    case "line":
      return linePath(w, h);
    default:
      return null;
  }
}

export { DEFAULT_SHAPE_STROKE_WIDTH, cloudPath, cylinderPaths, freehandPath, linePath, shapeOutlinePath };
