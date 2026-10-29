import { useStore } from "zustand";

import { type CSSProperties, type ReactNode, createContext, useContext } from "react";

import type { Block, BlockId, ConnectorBlock } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import type { Box } from "../canvas/viewport";
import type { MovePreview } from "../canvas/viewport";
import { useBlock } from "../hooks";
import { Link } from "../shared/ui/icons";
import { useBlockContext } from "./block-context";
import type { CanvasPort, EndpointPoint } from "./canvas-geometry";
import {
  PORT_NORMAL,
  connectorPath,
  connectorPathPoints,
  edgePointOf,
  effectiveGeometry,
  endpointBoxOf,
  endpointOf,
  endpointPointOf,
} from "./canvas-geometry";

/** The v1 connector stroke (the shape token). */
const CONNECTOR_STROKE = "var(--docblocks-canvas-shape-stroke, currentColor)";
/** The selected connector's stroke (the canvas selection's cyan — the
 *  token stands in both themes; the page `--accent` is a hover surface,
 *  not a line color). */
const CONNECTOR_SELECTED_STROKE = "var(--docblocks-canvas-selected-stroke)";
/** The connect badge's green (the endpoint drag's port snap indicator). */
const CONNECT_COLOR = "var(--docblocks-canvas-connect-color, #16a34a)";
/** The line's stroke width bounds (canvas px; the data stand is 1–4,
 * the absent stand is 1 — the registry spec's parity). */
const MIN_STROKE_WIDTH = 1;
const MAX_STROKE_WIDTH = 4;
const DEFAULT_STROKE_WIDTH = 1;
/** The selection's width emphasis over the line's own width. */
const SELECTED_WIDTH_BUMP = 1;
/** The invisible hit path's width (a wide enough stroke to click the line). */
const HIT_STROKE_WIDTH = 12;
/** The arrowhead's length (canvas px, the marker's coordinate space). */
const ARROW_SIZE = 11;
/** The circle endpoint's radius (canvas px, the marker's coordinate space). */
const CIRCLE_ENDPOINT_RADIUS = 4;
/** The connect badge's radius (canvas px, beside the snapped port). */
const SNAP_BADGE_RADIUS = 10;
/** The connect badge's offset from the snapped port along its outward
 * normal (canvas px — the badge stands outside the box, beside the port). */
const SNAP_BADGE_LIFT = 16;

/**
 * The arrowhead def's id over the surface's id and the fill value (the
 * per-value def: the token / the selection's accent keep their legacy
 * ids, the data color stands its own id — the non-id characters are
 * dropped: a hex's "#" would break the url(#...) fragment).
 */
function arrowDefId(surfaceId: BlockId, fill: string): string {
  const key =
    fill === CONNECTOR_STROKE
      ? ""
      : fill === CONNECTOR_SELECTED_STROKE
        ? "-selected"
        : `-c${fill.replace(/[^a-z0-9]/gi, "")}`;
  return `docblocks-conn-arrow-${surfaceId}${key}`;
}

/** The line's effective width: the 1–4 data attr's clamp stand (the
 * lenient render over the raw write) + the selection's bump. The label
 * chip's frame reads the same stand (the frame stands the line). */
function connectorStrokeWidthOf(attrs: { strokeWidth?: number }, selected: boolean): number {
  const baseWidth = Math.min(
    MAX_STROKE_WIDTH,
    Math.max(MIN_STROKE_WIDTH, Math.round(attrs.strokeWidth ?? DEFAULT_STROKE_WIDTH))
  );
  return selected ? baseWidth + SELECTED_WIDTH_BUMP : baseWidth;
}

/**
 * The per-surface volatile canvas session (the move / resize previews +
 * the connector's endpoint drag): the per-line render reads it through
 * the context (the lines follow the items mid-drag — the preview stands
 * the endpoint resolution). The page view's surface stands the inert
 * session (no session there). The context is the viewport's props, not
 * the doc: a preview change stands the re-render, a block change stands
 * the line's own block / blocks subscription.
 */
interface CanvasSession {
  movePreview: MovePreview | null;
  resizePreview: { id: BlockId; box: Box } | null;
  endpointDrag: { connectorId: BlockId; which: "start" | "end" } | null;
  endpointPreview: {
    point: { x: number; y: number };
    snap: { blockId: string; port: CanvasPort; t: number } | null;
  } | null;
}

const INERT_CANVAS_SESSION: CanvasSession = {
  movePreview: null,
  resizePreview: null,
  endpointDrag: null,
  endpointPreview: null,
};

const CanvasSessionContext = createContext<CanvasSession>(INERT_CANVAS_SESSION);

/** The connector's effective stroke: the selection's accent wins, the
 *  data color (a hex) next, the token otherwise (the "none" color stands
 *  the token — the line is still drawn, the paint is the theme's). */
function connectorStrokeOf(block: ConnectorBlock, selected: boolean): string {
  const attrs = block.attrs;
  if (selected) return CONNECTOR_SELECTED_STROKE;
  if (attrs === undefined || attrs.strokeColor === undefined || attrs.strokeColor === "none") {
    return CONNECTOR_STROKE;
  }
  return attrs.strokeColor;
}

/**
 * The surface's arrowhead defs (the hidden 0x0 svg): the marker ids stand
 * per effective stroke value across the surface's connectors (the data
 * color follows the line's own stroke, the selected line's accent too).
 * The per-line SVGs (the interleaved paint order) reference the markers
 * by the url fragment — the defs stand once per surface, so a line under
 * a figure keeps its arrowheads. A connector whose endpoints do not
 * resolve (the lenient skip) stands no def (the line is not drawn).
 */
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
      style={{ position: "absolute" }}
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
function connectorLineOf(
  surfaceId: BlockId,
  connectorId: BlockId,
  block: ConnectorBlock,
  childIds: readonly BlockId[],
  blocks: Record<BlockId, Block>,
  selected: boolean,
  interactive: boolean,
  session: CanvasSession
): ReactNode {
  const attrs = block.attrs;
  if (attrs === undefined) return null; // lenient data without attrs: no line

  const { movePreview, resizePreview, endpointDrag, endpointPreview } = session;
  // The live geometry: the in-flight move / resize previews stand the
  // endpoint resolution (the lines follow the items mid-drag — the
  // release commit stands the same geometry in the doc; the line and
  // the item stand from one number).
  const previewBlocks = (() => {
    if (movePreview === null && resizePreview === null) return blocks;
    const next: Record<string, Block> = { ...blocks };
    for (const childId of childIds) {
      const item = next[childId];
      if (item === undefined || item.type === "connector") continue;
      if (resizePreview !== null && resizePreview.id === childId) {
        next[childId] = { ...item, geometry: { ...item.geometry, ...resizePreview.box } };
      } else if (movePreview !== null && movePreview.ids.includes(childId)) {
        const g = effectiveGeometry(item);
        next[childId] = {
          ...item,
          geometry: { x: g.x + movePreview.dx, y: g.y + movePreview.dy, w: g.w, h: g.h },
        };
      }
    }
    return next;
  })();
  // The route's AVOIDANCE obstacles: the
  // surface's non-connector, non-container siblings' boxes — the
  // endpoint's own box stands too (a route over it is a crossing). The
  // CONTAINER (the group) stands no obstacle: its box is a FRAME (the
  // line routes through it to reach the members, avoiding the members'
  // boxes — the figures), not a figure (the enclosing box would reject
  // every inside route). The orthogonal's bend line runs the first clear
  // candidate around them.
  const obstacleBoxes: Box[] = [];
  for (const childId of childIds) {
    const item = previewBlocks[childId];
    if (item === undefined || item.type === "connector" || item.type === "group") continue;
    obstacleBoxes.push(effectiveGeometry(item));
  }

  // The two-pass resolution (the endpoint shape).
  const startBox = endpointBoxOf(attrs.start, childIds, previewBlocks);
  const endBox = endpointBoxOf(attrs.end, childIds, previewBlocks);
  const startFree =
    attrs.start.x !== undefined && attrs.start.y !== undefined ? { x: attrs.start.x, y: attrs.start.y } : null;
  const endFree = attrs.end.x !== undefined && attrs.end.y !== undefined ? { x: attrs.end.x, y: attrs.end.y } : null;
  const startToward = endBox !== null ? { x: endBox.x, y: endBox.y } : (endFree ?? { x: 0, y: 0 });
  const endToward = startBox !== null ? { x: startBox.x, y: startBox.y } : (startFree ?? { x: 0, y: 0 });
  // The resolution stands the stored attrs (the previewed blocks): a
  // free point with a port stands the frozen direction (the normal),
  // a block ref the port / the legacy anchor.
  const startPoint = endpointPointOf(attrs.start, childIds, previewBlocks, startToward);
  const endPoint = endpointPointOf(attrs.end, childIds, previewBlocks, endToward);
  if (startPoint === null || endPoint === null) return null; // skipped: the wrapper carries data-missing

  const draggingThis = interactive && endpointDrag !== null && endpointDrag.connectorId === connectorId;
  const snapPoint = (which: "start" | "end"): EndpointPoint | null => {
    if (!draggingThis || endpointDrag === null || endpointDrag.which !== which || endpointPreview === null) {
      return null;
    }
    const snap = endpointPreview.snap;
    const point = { x: endpointPreview.point.x, y: endpointPreview.point.y };
    if (snap === null) {
      // The frozen direction: the stored endpoint's resolved normal
      // (startPoint / endPoint stand the stored attrs — the drag stands
      // no doc write).
      const stored = which === "start" ? startPoint : endPoint;
      return { ...point, nx: stored.nx, ny: stored.ny };
    }
    const sibling = previewBlocks[snap.blockId];
    if (sibling === undefined) return { ...point, nx: 0, ny: 0 };
    const p = edgePointOf(effectiveGeometry(sibling), snap.port, snap.t);
    const normal = PORT_NORMAL[snap.port];
    return { x: p.x, y: p.y, nx: normal.nx, ny: normal.ny };
  };
  const startDraw: EndpointPoint =
    draggingThis && endpointDrag !== null && endpointDrag.which === "start"
      ? (snapPoint("start") ?? startPoint)
      : startPoint;
  const endDraw: EndpointPoint =
    draggingThis && endpointDrag !== null && endpointDrag.which === "end" ? (snapPoint("end") ?? endPoint) : endPoint;

  const stroke = connectorStrokeOf(block, selected);
  // The width stand (the 1–4 data attr; the lenient render clamps the
  // raw write) + the selection's bump (the 1x default stands the
  // former 1→2 emphasis; the label chip's frame reads the same stand).
  const strokeWidth = connectorStrokeWidthOf(attrs, selected);
  const dash = attrs.strokeStyle === "dash" ? "8 4" : attrs.strokeStyle === "dot" ? "1 4" : undefined;
  // The arrowheads (the independent
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

  // The stored points keep the polyline priority (the pre-variant
  // behavior: the freehand waypoints through the centers). The
  // polyline's endpoints stand as the legacy centers for plain refs
  // (the look preserved); a port / free endpoint stands at its own
  // point.
  // A legacy line (both endpoints plain refs — no port / free point)
  // keeps the box-based path (the mid-edge elbow; the legacy look is
  // preserved byte-for-byte); a line with a port or a free endpoint
  // draws through the resolved points. A line whose endpoint is in a
  // drag draws through the points too (the live re-draw — the box path
  // would stand the line off the preview point).
  const legacy =
    startBox !== null &&
    endBox !== null &&
    startFree === null &&
    endFree === null &&
    attrs.start.port === undefined &&
    attrs.end.port === undefined &&
    !draggingThis;
  const polyPoint = (
    ref: { x?: number; y?: number; port?: string },
    resolved: EndpointPoint,
    box: { x: number; y: number } | null,
    key: "start" | "end"
  ) => {
    const dragged = draggingThis && endpointDrag !== null && endpointDrag.which === key;
    return ref.x !== undefined && ref.y !== undefined
      ? { x: ref.x, y: ref.y }
      : ref.port !== undefined || box === null || dragged
        ? { x: resolved.x, y: resolved.y }
        : { x: box.x, y: box.y };
  };
  const startPoly = polyPoint(attrs.start, startDraw, startBox, "start");
  const endPoly = polyPoint(attrs.end, endDraw, endBox, "end");
  const path =
    attrs.points !== undefined && attrs.points.length > 0
      ? `M ${startPoly.x} ${startPoly.y} L ${attrs.points.map(([x, y]) => `${x} ${y}`).join(" L ")} L ${endPoly.x} ${endPoly.y}`
      : legacy
        ? connectorPath(startBox, endBox, attrs.variant ?? "straight").d
        : connectorPathPoints(startDraw, endDraw, attrs.variant ?? "straight", obstacleBoxes).d;

  // The connect badge (the endpoint drag's port snap): the green Link
  // beside the SNAPPED PORT (the port point + the outward normal's
  // offset — the "the point is connected" indicator; it follows the port, not the line's midpoint).
  // A nested svg stands the icon at the badge's center (the icon
  // component's props spread onto its own svg element — the x / y stand
  // the nested viewport).
  const dragDraw =
    draggingThis && endpointDrag !== null ? (endpointDrag.which === "start" ? startDraw : endDraw) : null;
  const snapBadge =
    draggingThis && dragDraw !== null && endpointPreview !== null && endpointPreview.snap !== null ? (
      <g data-connector-snap-badge={connectorId} pointerEvents="none">
        <circle
          cx={dragDraw.x + dragDraw.nx * SNAP_BADGE_LIFT}
          cy={dragDraw.y + dragDraw.ny * SNAP_BADGE_LIFT}
          r={SNAP_BADGE_RADIUS}
          fill="var(--docblocks-canvas-surface-background, var(--card, #ffffff))"
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
  // attribute cannot carry var()).
  const pathStyle: CSSProperties = { stroke: stroke };

  return (
    <>
      <path
        data-connector-id={connectorId}
        data-selected={selected || undefined}
        d={path}
        markerEnd={endMarkerId !== null ? `url(#${endMarkerId})` : undefined}
        markerStart={startMarkerId !== null ? `url(#${startMarkerId})` : undefined}
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
          data-connector-hit={connectorId}
          d={path}
          stroke="transparent"
          strokeWidth={HIT_STROKE_WIDTH}
          fill="none"
          pointerEvents="stroke"
          style={{ cursor: "pointer" }}
        />
      )}
      {snapBadge}
    </>
  );
}

/**
 * One connector's line, the surface's Z-ORDER stand (the explicit zIndex):
 * explicit zIndex): the line stands at the connector's position in the
 * surface's children (the paint order) — a connector can stand over or
 * under a figure, not only over every figure (the former single overlay
 * painted every line on top). The SVG is the surface's center-anchor
 * space (the 1x1 overflow-visible at the wrapper's center — the
 * CanvasItem's wrapper stands at the surface's origin), the shared
 * arrowhead defs (the surface's hidden defs svg) stand the markers.
 *
 * The SVG itself is pointer-events none; the per-line hit path (the wide
 * transparent stroke) is pointer-events stroke — the line is
 * click-selectable, the empty canvas around it is not.
 */
function ConnectorLine({ id, interactive = true }: { id: BlockId; interactive?: boolean }) {
  const { store } = useEditorContext();
  const blocks = useStore(store, (state) => state.blocks);
  const selected = useStore(store, (state) => state.selection.kind === "blocks" && state.selection.ids.includes(id));
  const context = useBlockContext();
  const session = useContext(CanvasSessionContext);
  const block = blocks[id];
  if (block === undefined || block.type !== "connector") return null;
  const content = connectorLineOf(
    context.parentId,
    id,
    block,
    context.siblings,
    blocks,
    selected,
    interactive,
    session
  );
  if (content === null) return null;
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
      {content}
    </svg>
  );
}

export {
  CanvasSessionContext,
  CONNECT_COLOR,
  CONNECTOR_SELECTED_STROKE,
  CONNECTOR_STROKE,
  ConnectorArrowDefs,
  ConnectorLine,
  INERT_CANVAS_SESSION,
  SNAP_BADGE_LIFT,
  SNAP_BADGE_RADIUS,
  connectorStrokeWidthOf,
};
export type { CanvasSession };
