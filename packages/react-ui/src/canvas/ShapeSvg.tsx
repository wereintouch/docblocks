import type { ReactElement } from "react";

import type { BlockId } from "docblocks-core";

import { useDarkTheme } from "../shared/dark-theme";
import { effectiveColorOf } from "./canvas-color";
import { minScreenStrokeOf } from "./canvas-stroke";
import type { ShapeBlockView } from "./geometry";
import { DEFAULT_CANVAS_ITEM_SIZE } from "./geometry";
import { DEFAULT_SHAPE_STROKE_WIDTH, cloudPath, cylinderPaths, freehandPath, linePath } from "./shape-outline";

/** The shape block as seen by the renderer (the geometry-carrying union member). */
/** The v1 shape defaults (the theme token + sane numbers; the block attrs override). */
const DEFAULT_STROKE = "var(--docblocks-canvas-shape-stroke, currentColor)";

/** The strokeStyle dash patterns (dot = a dense dash with a round cap). */
const DASH_PATTERN: Record<"dash" | "dot", string> = {
  dash: "8 4",
  dot: "1 4",
};

/**
 * A canvas shape: one SVG (viewBox 0 0 w h, filling the positioned
 * wrapper). v1 render decisions: `rounded` is the rect with the corner
 * radius (a fixed fraction of the smaller box side); `cylinder` is the
 * body with the elliptical end caps (the DB figure, the box-proportional
 * cap); `cloud` is the scaled outline (the box-proportional stand); `points`
 * (freehand) are block-local px within the w/h box and win over the
 * variant figure when present (a stroke path, no fill); the stroke is
 * inset by strokeWidth/2 so it stays inside the box. An unknown variant
 * (the lenient reader — the legacy `line`) renders its kept figure, the
 * element stays.
 */
function ShapeSvg({ id, block, box }: { id: BlockId; block: ShapeBlockView; box?: { w: number; h: number } }) {
  const attrs = block.attrs;
  // The figure's data colors' themes' stand (the render-time's transform
  // — the data stands the source hex): the dark theme's light fixed
  // fill / stroke stand the dark corridor's value (the `#dae8fc`'s
  // muted dark blue's stand), the light theme / the dark's values / the
  // non-hex stand verbatim (the fidelity's / the adaptive's stands).
  const isDark = useDarkTheme();
  const fill = effectiveColorOf(attrs?.fill, isDark) ?? "none";
  const stroke = effectiveColorOf(attrs?.stroke ?? DEFAULT_STROKE, isDark);
  // The effective box (the resize preview's live box when in flight; the
  // committed geometry otherwise): the viewBox and the figure stand from it,
  // so the shape redraws box-proportional in real time — no letterbox
  // freeze on the enlarge, and the preview stands the commit's numbers
  // (one number, no jump on the release).
  const w = box?.w ?? block.geometry?.w ?? DEFAULT_CANVAS_ITEM_SIZE;
  const h = box?.h ?? block.geometry?.h ?? DEFAULT_CANVAS_ITEM_SIZE;
  const strokeWidth = attrs?.strokeWidth ?? DEFAULT_SHAPE_STROKE_WIDTH;
  const strokeStyle = attrs?.strokeStyle;
  const dash = strokeStyle === "dash" || strokeStyle === "dot" ? DASH_PATTERN[strokeStyle] : undefined;
  const inset = strokeWidth / 2;
  const halfW = Math.max(w - strokeWidth, 0) / 2;
  const halfH = Math.max(h - strokeWidth, 0) / 2;

  let figure: ReactElement | null = null;
  if (attrs?.points !== undefined && attrs.points.length > 0) {
    figure = <path d={freehandPath(attrs.points)} fill="none" />;
  } else if (attrs?.variant === "rect") {
    figure = <rect x={inset} y={inset} width={halfW * 2} height={halfH * 2} />;
  } else if (attrs?.variant === "rounded") {
    // The corner radius: a fixed fraction of the smaller box side (the
    // box-proportional stand — no own attr, the v1 limit).
    figure = <rect x={inset} y={inset} width={halfW * 2} height={halfH * 2} rx={Math.min(w, h) * 0.15} />;
  } else if (attrs?.variant === "ellipse") {
    figure = <ellipse cx={w / 2} cy={h / 2} rx={halfW} ry={halfH} />;
  } else if (attrs?.variant === "diamond") {
    figure = <polygon points={`${w / 2},${inset} ${w - inset},${h / 2} ${w / 2},${h - inset} ${inset},${h / 2}`} />;
  } else if (attrs?.variant === "cylinder") {
    // The DB figure: the body with the elliptical end caps (the cap's
    // half-height is the box-proportional stand — no own attr, the v1
    // limit). The top cap's front arc stands the seam (the figure's
    // tell; the stroke only — the fill stands the body path).
    const paths = cylinderPaths(w, h, strokeWidth);
    figure = (
      <>
        <path d={paths.body} />
        <path d={paths.seam} fill="none" />
      </>
    );
  } else if (attrs?.variant === "cloud") {
    // The cloud's silhouette: the outline builder's box-proportional path
    // (the hit zone's contour stands the same source).
    figure = <path d={cloudPath(w, h, strokeWidth)} />;
  } else if (attrs?.variant === "line") {
    // The legacy `line` figure: the box's diagonal (the outline builder's
    // source — the hit zone's contour stands it).
    figure = <path d={linePath(w, h)} />;
  }

  return (
    <svg
      data-slot="docblocks/shape"
      data-block-id={id}
      data-variant={attrs?.variant}
      viewBox={`0 0 ${w} ${h}`}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        overflow: "visible",
        opacity: attrs?.opacity ?? 1,
      }}
    >
      <g
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={fill}
        strokeDasharray={dash}
        strokeLinecap={strokeStyle === "dot" ? "round" : undefined}
        // The min-screen stroke's stand (the 1/zoom's compensation — the
        // world's inverse-zoom's variable's read; the attribute stands the
        // data's width, the style's `max()` compensates the render; the
        // figure's geometry's math stands the data's width).
        style={{ strokeWidth: minScreenStrokeOf(strokeWidth) }}
      >
        {figure}
      </g>
    </svg>
  );
}

export { ShapeSvg };
