/** The surface's arrowhead defs (the hidden 0x0 svg): the marker ids stand
 * per effective stroke value across the surface's connectors (the data
 * color follows the line's own stroke, the selected line's accent too).
 * The per-line SVGs (the interleaved paint order) reference the markers
 * by the url fragment — the defs stand once per surface, so a line under
 * a figure keeps its arrowheads. A connector whose endpoints do not
 * resolve (the lenient skip) stands no def (the line is not drawn). */
import { useStore } from "zustand";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { useBlock } from "../hooks";
import { endpointOf } from "./canvas-geometry";
import { ARROW_SIZE, CIRCLE_ENDPOINT_RADIUS } from "./connector-constants";
import { arrowDefId, connectorStrokeOf } from "./connector-utils";

function ConnectorArrowDefs({ id }: { id: BlockId }) {
  const { store } = useEditorContext();
  const blocks = useStore(store, (state) => state.blocks);
  const selection = useStore(store, (state) => state.selection);
  const surface = useBlock(id);
  if (surface === undefined || surface.type !== "surface") return null;
  const childIds = surface.children ?? [];
  const selectedIds = selection.kind === "blocks" ? selection.ids : [];
  const endFills = new Set<string>();
  const startFills = new Set<string>();
  const circleFills = new Set<string>();
  for (const childId of childIds) {
    const block = blocks[childId];
    if (block === undefined || block.type !== "connector" || block.attrs === undefined) continue;
    // The missing endpoint stands no line (the lenient skip) — the def
    // would stand unused.
    if (endpointOf(block.attrs.start, childIds, blocks) === null) continue;
    if (endpointOf(block.attrs.end, childIds, blocks) === null) continue;
    const stroke = connectorStrokeOf(block, selectedIds.includes(childId));
    if ((block.attrs.arrowHead ?? "arrow") === "arrow") endFills.add(stroke);
    if (block.attrs.arrowStart === "arrow") startFills.add(stroke);
    if (block.attrs.arrowHead === "circle" || block.attrs.arrowStart === "circle") circleFills.add(stroke);
  }
  if (endFills.size === 0 && startFills.size === 0 && circleFills.size === 0) return null;
  return (
    <svg
      data-slot="docblocks/connector-defs"
      data-block-id={id}
      aria-hidden="true"
      width={0}
      height={0}
      className="absolute"
    >
      <defs>
        {/* The marker's coordinate space is the canvas px; the fill follows
            the line's stroke (the per-value def). The end arrow stands its
            tip at the line's end (the refX at the tip), the start arrow
            stands its tip at the start point (the reversed geometry, the
            refX at the tip), the circle stands centered at the point
            (symmetric — the def serves both sides). */}
        {[...endFills].map((fill) => (
          <marker
            key={`end-${fill}`}
            id={arrowDefId(id, fill)}
            viewBox={`0 0 ${ARROW_SIZE} ${ARROW_SIZE}`}
            refX={ARROW_SIZE}
            refY={ARROW_SIZE / 2}
            markerWidth={ARROW_SIZE}
            markerHeight={ARROW_SIZE}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d={`M 0 0 L ${ARROW_SIZE} ${ARROW_SIZE / 2} L 0 ${ARROW_SIZE} Z`} style={{ fill }} />
          </marker>
        ))}
        {[...startFills].map((fill) => (
          <marker
            key={`start-${fill}`}
            id={`${arrowDefId(id, fill)}-s`}
            viewBox={`0 0 ${ARROW_SIZE} ${ARROW_SIZE}`}
            refX={0}
            refY={ARROW_SIZE / 2}
            markerWidth={ARROW_SIZE}
            markerHeight={ARROW_SIZE}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d={`M ${ARROW_SIZE} 0 L 0 ${ARROW_SIZE / 2} L ${ARROW_SIZE} ${ARROW_SIZE} Z`} style={{ fill }} />
          </marker>
        ))}
        {[...circleFills].map((fill) => (
          <marker
            key={`circle-${fill}`}
            id={`${arrowDefId(id, fill)}-ci`}
            viewBox={`0 0 ${ARROW_SIZE} ${ARROW_SIZE}`}
            refX={ARROW_SIZE / 2}
            refY={ARROW_SIZE / 2}
            markerWidth={ARROW_SIZE}
            markerHeight={ARROW_SIZE}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <circle cx={ARROW_SIZE / 2} cy={ARROW_SIZE / 2} r={CIRCLE_ENDPOINT_RADIUS} style={{ fill }} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

/**
 * One connector's line (the visible path + the hit path + the connect
 * badge), the data the per-line render stands. The line is between the

 * stands at the block's edge midpoint, a block ref WITHOUT a port stands
 * at the block's edge anchor toward the other endpoint (the sticky legacy
 * anchor — a moved block re-anchors the line), and a FREE point (x / y in
 * canvas px — the world space) stands as-is. The `variant`'s shape
 * (absent = straight; the stored `points` keep the polyline priority)
 * draws between the points. An endpoint that does not resolve within the
 * surface's children (a docId ref, an absent block) stands null — the
 * line is skipped (the lenient posture; the element's wrapper carries
 * data-missing).
 *
 * The handles: the selected connector's endpoint drag stands the live
 * re-draw — the preview replaces the dragged endpoint's point (the other
 * endpoint stands; the line's shape re-draws around it). The zero normal
 * on the preview: the free point bows out at render time. The live snap
 * (the drag's stick effect): within the snap radius the preview stands
 * at the EDGE ANCHOR (the side's point at the fractional position — the
 * continuous anchor of) — not the raw
 * cursor point. The snap stands the PORT's normal (the curve bows out
 * from it); the in-air preview stands the STOREd endpoint's direction
 * (the frozen normal — the line stands its direction while the endpoint
 * is in the air).
 *
 * `interactive` toggles the hit path: the canvas view is interactive
 * (the line is selectable, the endpoints draggable), the page view's
 * embedded surface stands it inert (no selection / dragging there — the
 * bands must not intercept the content's clicks).
 */

export { ConnectorArrowDefs };
