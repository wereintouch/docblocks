/** The canvas connector's line content: the line's SVG over the resolved
 * geometry (./connector-line-geometry — the route's stand, the endpoints'
 * live preview) — the arrowheads (the per-end figures over the per-value
 * def), the connect badge (the endpoint drag's port snap — the green Link
 * over the snapped port) + the hit path's bbox read (the webkit's
 * hit-test's stand — the box's svg). `null` over the unresolvable
 * endpoint (the wrapper stands its data-missing).
 *
 * `interactive` toggles the hit path: the canvas view is interactive
 * (the line is selectable, the endpoints draggable), the page view's
 * embedded surface stands it inert (no selection / dragging there — the
 * bands must not intercept the content's clicks). The hit path's `d` is
 * returned alongside the content: the hit path renders in its own
 * bbox-sized svg — the webkit does not hit-test the overflow-visible
 * content over the 1x1 svg's box, so the line is not clickable from
 * there without the box.
 */
import type { CSSProperties, ReactNode } from "react";

import type { Block, BlockId, ConnectorBlock } from "docblocks-core";

import { Link } from "../shared/ui/icons";
import { SURFACE_BG } from "./canvas-view/constants";
import { CONNECT_COLOR, SNAP_BADGE_LIFT, SNAP_BADGE_RADIUS } from "./connector-constants";
import { connectorLineGeometryOf } from "./connector-line-geometry";
import { arrowDefId, connectorStrokeWidthOf, effectiveConnectorStrokeOf } from "./connector-utils";
import { minScreenStrokeOf } from "./canvas-stroke";
import type { CanvasSession } from "./viewport";

function connectorLineOf(
  surfaceId: BlockId,
  connectorId: BlockId,
  block: ConnectorBlock,
  childIds: readonly BlockId[],
  blocks: Record<BlockId, Block>,
  selected: boolean,
  interactive: boolean,
  session: CanvasSession,
  /** The document's dark theme's stand (the render-time's transform's
   * trigger — the data color's dark corridor over the light theme's
   * verbatim). */
  isDark: boolean
): { content: ReactNode; hitD: string | null } | null {
  const attrs = block.attrs;
  if (attrs === undefined) return null; // lenient data without attrs: no line

  const geometry = connectorLineGeometryOf(connectorId, block, childIds, blocks, session);
  if (geometry === null) return null;

  const { endpointDrag, endpointPreview } = session;
  const stroke = effectiveConnectorStrokeOf(block, selected, isDark);
  // The width stand (the 1–4 data attr; the lenient render clamps the
  // raw write) + the selection's bump (the 1x default stands the
  // former 1→2 emphasis; the label chip's frame reads the same stand).
  const strokeWidth = connectorStrokeWidthOf(attrs, selected);
  const dash = attrs.strokeStyle === "dash" ? "8 4" : attrs.strokeStyle === "dot" ? "1 4" : undefined;
  // The arrowheads (the independent start figure): each end stands its own
  // figure — the end
  // defaults to "arrow" (absent), the start stands no marker when
  // absent. The marker follows the line's stroke (the data color / the
  // selected line's accent stand the arrowhead too — the def is per
  // fill value, the shared surface defs). The circle def is symmetric
  // (it serves both sides); the arrow defs are oriented (the end's
  // non-inverted, the start's inverted).
  const arrowHead = attrs.arrowHead ?? "arrow";
  const endArrow = arrowHead === "arrow";
  const endCircle = arrowHead === "circle";
  const startArrow = attrs.arrowStart === "arrow";
  const startCircle = attrs.arrowStart === "circle";
  const endMarkerId = endCircle
    ? `${arrowDefId(surfaceId, stroke)}-ci`
    : endArrow
      ? arrowDefId(surfaceId, stroke)
      : null;
  const startMarkerId = startCircle
    ? `${arrowDefId(surfaceId, stroke)}-ci`
    : startArrow
      ? `${arrowDefId(surfaceId, stroke)}-s`
      : null;

  // The connect badge (the endpoint drag's port snap): the green Link
  // beside the SNAPPED PORT (the port point + the outward normal's
  // offset — the "the point is connected" indicator; it follows the port, not the line's midpoint).
  // A nested svg stands the icon at the badge's center (the icon
  // component's props spread onto its own svg element — the x / y stand
  // the nested viewport).
  const dragDraw =
    geometry.dragging && endpointDrag !== null
      ? endpointDrag.which === "start"
        ? geometry.startDraw
        : geometry.endDraw
      : null;
  const snapBadge =
    geometry.dragging && dragDraw !== null && endpointPreview !== null && endpointPreview.snap !== null ? (
      <g data-connector-snap-badge={connectorId} pointerEvents="none">
        <circle
          cx={dragDraw.x + dragDraw.nx * SNAP_BADGE_LIFT}
          cy={dragDraw.y + dragDraw.ny * SNAP_BADGE_LIFT}
          r={SNAP_BADGE_RADIUS}
          fill={SURFACE_BG}
          stroke={CONNECT_COLOR}
          strokeWidth={1.5}
        />
        <Link
          x={dragDraw.x + dragDraw.nx * SNAP_BADGE_LIFT - 7}
          y={dragDraw.y + dragDraw.ny * SNAP_BADGE_LIFT - 7}
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke={CONNECT_COLOR}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    ) : null;

  // The stroke goes through the STYLE (the CSS variable: a presentation
  // attribute cannot carry var()) + the min-screen stroke's stand (the
  // 1/zoom's compensation — the world's inverse-zoom's variable's read).
  const pathStyle: CSSProperties = {
    stroke: stroke,
    strokeWidth: minScreenStrokeOf(strokeWidth),
  };

  return {
    content: (
      <>
        <path
          data-connector-id={connectorId}
          data-selected={selected || undefined}
          d={geometry.path}
          markerEnd={endMarkerId !== null ? `url(#${endMarkerId})` : undefined}
          markerStart={startMarkerId !== null ? `url(#${startMarkerId})` : undefined}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={dash}
          strokeLinecap={attrs.strokeStyle === "dot" ? "round" : undefined}
          style={pathStyle}
        />
        {snapBadge}
      </>
    ),
    hitD: interactive ? geometry.path : null,
  };
}

/** The path's points' bounding box (the surface's center-anchor space):
 * the `d`'s numbers (the letters' strip, the plain's parse). The webkit
 * hit-tests only inside the svg's own box, so the line's hit path
 * needs a bbox-sized svg over the 1x1 draw layer (draw-only there). */
function hitBoxOf(d: string): { x: number; y: number; w: number; h: number } | null {
  const numbers = d
    .replace(/[A-Za-z]/g, " ")
    .split(/\s+/)
    .map(Number.parseFloat)
    .filter((value) => Number.isFinite(value));
  if (numbers.length < 4) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < numbers.length; i += 2) {
    const x = numbers[i] ?? 0;
    const y = numbers[i + 1] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export { connectorLineOf, hitBoxOf };
