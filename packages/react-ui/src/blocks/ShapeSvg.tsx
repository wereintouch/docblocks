import type { ReactElement } from "react";

import type { Block, BlockId } from "docblocks-core";

import { DEFAULT_CANVAS_ITEM_SIZE } from "./canvas-geometry";

/** The shape block as seen by the renderer (the geometry-carrying union member). */
type ShapeBlockView = Extract<Block, { type: "shape" }>;

/** The v1 shape defaults (the theme token + sane numbers; the block attrs override). */
const DEFAULT_STROKE = "var(--docblocks-canvas-shape-stroke, currentColor)";
const DEFAULT_STROKE_WIDTH = 2;

/** The strokeStyle dash patterns (dot = a dense dash with a round cap). */
const DASH_PATTERN: Record<"dash" | "dot", string> = {
  dash: "8 4",
  dot: "1 4",
};

/**
 * A canvas shape: one SVG (viewBox 0 0 w h, filling the positioned
 * wrapper). v1 render decisions: `rounded` is the rect with the corner
 * radius (a fixed fraction of the smaller box side); `points`
 * (freehand) are block-local px within the w/h box and win over the
 * variant figure when present (a stroke path, no fill); the stroke is
 * inset by strokeWidth/2 so it stays inside the box. An unknown variant
 * (the lenient reader — the legacy `line`) renders its kept figure, the
 * element stays.
 */
function ShapeSvg({ id, block }: { id: BlockId; block: ShapeBlockView }) {
  const attrs = block.attrs;
  const w = block.geometry?.w ?? DEFAULT_CANVAS_ITEM_SIZE;
  const h = block.geometry?.h ?? DEFAULT_CANVAS_ITEM_SIZE;
  const strokeWidth = attrs?.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  const strokeStyle = attrs?.strokeStyle;
  const dash = strokeStyle === "dash" || strokeStyle === "dot" ? DASH_PATTERN[strokeStyle] : undefined;
  const inset = strokeWidth / 2;
  const halfW = Math.max(w - strokeWidth, 0) / 2;
  const halfH = Math.max(h - strokeWidth, 0) / 2;

  let figure: ReactElement | null = null;
  if (attrs?.points !== undefined && attrs.points.length > 0) {
    const d = attrs.points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
    figure = <path d={d} fill="none" />;
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
  } else if (attrs?.variant === "line") {
    figure = <line x1={0} y1={0} x2={w} y2={h} />;
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
        stroke={attrs?.stroke ?? DEFAULT_STROKE}
        strokeWidth={strokeWidth}
        fill={attrs?.fill ?? "none"}
        strokeDasharray={dash}
        strokeLinecap={strokeStyle === "dot" ? "round" : undefined}
      >
        {figure}
      </g>
    </svg>
  );
}

export { ShapeSvg };
