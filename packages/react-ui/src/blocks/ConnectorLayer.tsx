import { useStore } from "zustand";

import type { CSSProperties, ReactNode } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { useBlock } from "../hooks";
import { connectorPath, endpointBoxOf } from "./canvas-geometry";

/** The v1 connector stroke (the shape token; the label uses the text color). */
const STROKE = "var(--docblocks-canvas-shape-stroke, currentColor)";
/** The selected connector's stroke (the canvas accent; the page token fallback). */
const SELECTED_STROKE = "var(--docblocks-canvas-selected-stroke, var(--accent, #388bfd))";
const CONNECTOR_STROKE_WIDTH = 1;
/** The selected connector's stroke width (the emphasis over the default). */
const SELECTED_STROKE_WIDTH = 2;
/** The invisible hit path's width (a wide enough stroke to click the line). */
const HIT_STROKE_WIDTH = 12;
/** The arrowhead's length (canvas px, the marker's coordinate space). */
const ARROW_SIZE = 8;
const LABEL_FONT_SIZE = 12;

/**
 * The surface's connector overlay: one SVG anchored at the surface CENTER
 * (a 0x0 svg with overflow visible at left/top 50% — the equivalent of a
 * full-surface overlay with a center origin) for ALL the direct connector
 * children. The SVG itself is pointer-events none; the per-connector hit
 * path (the wide transparent stroke) is pointer-events stroke — the line
 * is click-selectable, the empty canvas around it is not.
 *
 * A connector renders a line between the START and the END block's EDGES
 * (the edge anchors: the center-to-center segment's exit from each box —
 * a moved block re-anchors the line automatically): the `variant`'s shape
 * (absent = straight; the stored `points` keep the polyline priority).
 * The arrowhead (the filled triangle marker) stands at the end point. A
 * ref that does not resolve within the surface's children (a docId ref,
 * an absent block) is SKIPPED (the lenient posture; the element's wrapper
 * carries data-missing). A label renders as an SVG text at the line's
 * midpoint. `interactive` (default true) toggles the hit path: the canvas
 * view is interactive (the line is click-selectable), the page view's
 * embedded surface stands the line inert (no selection handler there —
 * the wide band must not intercept the content's clicks).
 */
function ConnectorLayer({ id, interactive = true }: { id: BlockId; interactive?: boolean }) {
  const { store } = useEditorContext();
  const blocks = useStore(store, (state) => state.blocks);
  const selection = useStore(store, (state) => state.selection);
  const surface = useBlock(id);
  if (surface === undefined || surface.type !== "surface") return null;

  const childIds = surface.children ?? [];
  const selectedIds = selection.kind === "blocks" ? selection.ids : [];
  const segments: ReactNode[] = [];

  for (const childId of childIds) {
    const block = blocks[childId];
    if (block === undefined || block.type !== "connector") continue;

    const attrs = block.attrs;
    if (attrs === undefined) continue; // lenient data without attrs: no line

    const start = endpointBoxOf(attrs.start, childIds, blocks);
    const end = endpointBoxOf(attrs.end, childIds, blocks);
    if (start === null || end === null) continue; // skipped: the wrapper carries data-missing

    const selected = selectedIds.includes(childId);
    const stroke = selected ? SELECTED_STROKE : STROKE;
    const strokeWidth = selected ? SELECTED_STROKE_WIDTH : CONNECTOR_STROKE_WIDTH;
    const dash = attrs.strokeStyle === "dash" ? "8 4" : attrs.strokeStyle === "dot" ? "1 4" : undefined;
    // The marker follows the line's stroke (the selected line's accent
    // arrowhead stands the emphasis too).
    const markerId = `docblocks-conn-arrow-${id}${selected ? "-selected" : ""}`;

    // The stored points keep the polyline priority (the pre-variant
    // behavior: the freehand waypoints through the centers).
    const path =
      attrs.points !== undefined && attrs.points.length > 0
        ? {
            d: `M ${start.x} ${start.y} L ${attrs.points.map(([x, y]) => `${x} ${y}`).join(" L ")} L ${end.x} ${end.y}`,
            end: { x: end.x, y: end.y },
            mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
          }
        : connectorPath(start, end, attrs.variant ?? "straight");

    const label =
      attrs.label !== undefined ? (
        <text
          data-connector-label={childId}
          x={path.mid.x}
          y={path.mid.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={LABEL_FONT_SIZE}
          fill="currentColor"
        >
          {attrs.label}
        </text>
      ) : null;

    // The stroke goes through the STYLE (the CSS variable: a presentation
    // attribute cannot carry var()).
    const pathStyle: CSSProperties = { stroke: stroke };

    segments.push(
      <g key={childId}>
        <path
          data-connector-id={childId}
          data-selected={selected || undefined}
          d={path.d}
          markerEnd={`url(#${markerId})`}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={dash}
          strokeLinecap={attrs.strokeStyle === "dot" ? "round" : undefined}
          style={pathStyle}
        />
        {/* The hit path: the wide invisible stroke the line clicks on (the
            visible path's pointer events stay the svg root's none — only
            the hit path stands pointer-events stroke). The page view stands
            it inert (interactive: false — the line is not selectable
            there, the wide band must not intercept the content's clicks). */}
        {interactive && (
          <path
            data-connector-hit={childId}
            d={path.d}
            stroke="transparent"
            strokeWidth={HIT_STROKE_WIDTH}
            fill="none"
            pointerEvents="stroke"
            style={{ cursor: "pointer" }}
          />
        )}
        {label}
      </g>
    );
  }

  if (segments.length === 0) return null;
  // The SVG viewport stands 1x1 px at the surface center: Chromium does
  // not paint the contents of a zero-sized SVG (the overflow visible alone
  // does not help), so the viewport keeps one px (the origin is the
  // surface center — the canvasItemStyle parity, the connector math's
  // center-anchor space) and the content stands in the overflow.
  return (
    <svg
      data-slot="docblocks/connector-layer"
      data-block-id={id}
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: 1,
        height: 1,
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      <defs>
        {/* The arrowhead (the id is the surface's — one def per overlay;
            the marker's coordinate space is the canvas px, refX at the
            tip so the tip stands exactly at the line's end). */}
        <marker
          id={`docblocks-conn-arrow-${id}`}
          viewBox="0 0 8 8"
          refX={ARROW_SIZE}
          refY={ARROW_SIZE / 2}
          markerWidth={ARROW_SIZE}
          markerHeight={ARROW_SIZE}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 0 0 L 8 4 L 0 8 Z" style={{ fill: "var(--docblocks-canvas-shape-stroke, currentColor)" }} />
        </marker>
        {/* The selected line's arrowhead (the accent — the def stands
            unconditionally: the marker id is picked per line). */}
        <marker
          id={`docblocks-conn-arrow-${id}-selected`}
          viewBox="0 0 8 8"
          refX={ARROW_SIZE}
          refY={ARROW_SIZE / 2}
          markerWidth={ARROW_SIZE}
          markerHeight={ARROW_SIZE}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 0 0 L 8 4 L 0 8 Z" style={{ fill: SELECTED_STROKE }} />
        </marker>
      </defs>
      {segments}
    </svg>
  );
}

export { ConnectorLayer };
