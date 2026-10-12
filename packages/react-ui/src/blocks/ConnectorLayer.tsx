import { useStore } from "zustand";

import type { ReactNode } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { useBlock } from "../hooks";
import { endpointOf } from "./canvas-geometry";

/** The v1 connector stroke (the shape token; the label uses the text color). */
const STROKE = "var(--docblocks-canvas-shape-stroke, currentColor)";
const CONNECTOR_STROKE_WIDTH = 1;
const LABEL_FONT_SIZE = 12;

/**
 * The surface's connector overlay: one SVG anchored at the surface CENTER
 * (a 0x0 svg with overflow visible at left/top 50% — the equivalent of a
 * full-surface overlay with a center origin) for ALL the direct connector
 * children, pointer-events none (the lines are not interactive in v1).
 *
 * A connector renders a line from the START block's geometry center to
 * the END block's geometry center (the endpoints in the surface
 * coordinate space). v1 points behavior: absent -> a 2-point line;
 * present -> a single polyline through the waypoints (surface-local
 * coordinates) from the start center to the end center. A ref that does
 * not resolve within the surface's children (a docId ref, an absent
 * block) is SKIPPED (the lenient posture; the element's wrapper carries
 * data-missing). A label renders as an SVG text at the midpoint of the
 * two centers.
 */
function ConnectorLayer({ id }: { id: BlockId }) {
  const { store } = useEditorContext();
  const blocks = useStore(store, (state) => state.blocks);
  const surface = useBlock(id);
  if (surface === undefined || surface.type !== "surface") return null;

  const childIds = surface.children ?? [];
  const segments: ReactNode[] = [];

  for (const childId of childIds) {
    const block = blocks[childId];
    if (block === undefined || block.type !== "connector") continue;

    const attrs = block.attrs;
    if (attrs === undefined) continue; // lenient data without attrs: no line

    const start = endpointOf(attrs.start, childIds, blocks);
    const end = endpointOf(attrs.end, childIds, blocks);
    if (start === null || end === null) continue; // skipped: the wrapper carries data-missing

    const dash = attrs.strokeStyle === "dash" ? "8 4" : attrs.strokeStyle === "dot" ? "1 4" : undefined;
    const common = {
      stroke: STROKE,
      strokeWidth: CONNECTOR_STROKE_WIDTH,
      fill: "none",
      strokeDasharray: dash,
      strokeLinecap: attrs.strokeStyle === "dot" ? ("round" as const) : undefined,
    };
    const label =
      attrs.label !== undefined ? (
        <text
          data-connector-label={childId}
          x={(start.x + end.x) / 2}
          y={(start.y + end.y) / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={LABEL_FONT_SIZE}
          fill="currentColor"
        >
          {attrs.label}
        </text>
      ) : null;

    if (attrs.points !== undefined && attrs.points.length > 0) {
      const points = [start, ...attrs.points.map(([x, y]) => ({ x, y })), end].map((p) => `${p.x},${p.y}`).join(" ");
      segments.push(
        <g key={childId}>
          <polyline data-connector-id={childId} points={points} {...common} />
          {label}
        </g>
      );
    } else {
      segments.push(
        <g key={childId}>
          <line data-connector-id={childId} x1={start.x} y1={start.y} x2={end.x} y2={end.y} {...common} />
          {label}
        </g>
      );
    }
  }

  if (segments.length === 0) return null;
  return (
    <svg
      data-slot="docblocks/connector-layer"
      data-block-id={id}
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: 0,
        height: 0,
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      {segments}
    </svg>
  );
}

export { ConnectorLayer };
