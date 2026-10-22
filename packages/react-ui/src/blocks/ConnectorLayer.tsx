import { useStore } from "zustand";

import type { CSSProperties, ReactNode } from "react";

import type { Block, BlockId } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import type { Box } from "../canvas/viewport";
import type { MovePreview } from "../canvas/viewport-state";
import { useBlock } from "../hooks";
import { Link } from "../shared/ui/icons";
import type { CanvasPort, EndpointPoint } from "./canvas-geometry";
import {
  PORT_NORMAL,
  connectorPath,
  connectorPathPoints,
  edgePointOf,
  effectiveGeometry,
  endpointBoxOf,
  endpointPointOf,
} from "./canvas-geometry";

/** The v1 connector stroke (the shape token; the label uses the text color). */
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
const ARROW_SIZE = 8;
const LABEL_FONT_SIZE = 12;
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

/**
 * The surface's connector overlay: one SVG anchored at the surface CENTER
 * (a 1x1 svg with overflow visible at left/top 50% — Chromium does not
 * paint a zero-sized SVG) for ALL the direct connector children. The SVG
 * itself is pointer-events none; the per-connector hit path (the wide
 * transparent stroke) is pointer-events stroke — the line is
 * click-selectable, the empty canvas around it is not.
 *
 * A connector renders a line between its two ENDPOINTS (the 2026-10-15
 * endpoint shape): a block ref with a PORT stands at the block's edge
 * midpoint, a block ref WITHOUT a port stands at the block's edge anchor
 * toward the other endpoint (the sticky legacy anchor — a moved block
 * re-anchors the line), and a FREE point (x / y in canvas px — the
 * world space the canvas view's surface children stand in)
 * stands as-is. The `variant`'s shape (absent = straight; the stored
 * `points` keep the polyline priority) draws between the points. The
 * arrowhead (the filled triangle marker) stands at the end point. An
 * endpoint that does not resolve within the surface's children (a docId
 * ref, an absent block) SKIPS the line (the lenient posture; the
 * element's wrapper carries data-missing). A label renders as an SVG
 * text at the line's midpoint.
 *
 * The handles: the TWO endpoint circles
 * render for the SELECTED connector and are DRAGGABLE — the pointerdown
 * starts the endpoint session (the viewport's `onConnectorEndpointDrag` —
 * the line re-draws live from the preview point, the release commits the
 * ref: a port-snap when released near a port, else the free point; a
 * release on the own source block detaches to the free point). `interactive`
 * (default true) toggles the hit path + handles: the canvas view is
 * interactive (the line is selectable, the endpoints draggable), the
 * page view's embedded surface stands the overlay inert (no selection /
 * dragging there — the bands must not intercept the content's clicks).
 */
function ConnectorLayer({
  id,
  interactive = true,
  endpointDrag,
  endpointPreview,
  movePreview,
  resizePreview,
  labelEditing,
}: {
  id: BlockId;
  interactive?: boolean;
  endpointDrag: { connectorId: BlockId; which: "start" | "end" } | null;
  endpointPreview: {
    point: { x: number; y: number };
    snap: { blockId: string; port: CanvasPort; t: number } | null;
  } | null;
  /** The in-flight move preview (the lines follow the items mid-drag). */
  movePreview: MovePreview | null;
  /** The in-flight resize preview (the lines follow the resized item). */
  resizePreview: { id: BlockId; box: Box } | null;
  /** The connector in the label's inline edit (the double-click's
   *  session): the SVG's label text stands off while the edit's input
   *  stands the draft (the commit re-stands it). */
  labelEditing?: BlockId | null;
}) {
  const { store } = useEditorContext();
  const blocks = useStore(store, (state) => state.blocks);
  const selection = useStore(store, (state) => state.selection);
  const surface = useBlock(id);
  if (surface === undefined || surface.type !== "surface") return null;

  const childIds = surface.children ?? [];
  const selectedIds = selection.kind === "blocks" ? selection.ids : [];
  // The live geometry: the in-flight move / resize previews stand the
  // endpoint resolution (the lines follow the items mid-drag — the release
  // commit stands the same geometry in the doc; the line and the item
  // stand from one number). The rotation preview stands off (the anchor
  // stands the unrotated box — the v1 limit).
  const previewBlocks = (() => {
    if (movePreview === null && resizePreview === null) return blocks;
    const next: Record<string, Block> = { ...blocks };
    for (const childId of childIds) {
      const block = next[childId];
      if (block === undefined || block.type === "connector") continue;
      if (resizePreview !== null && resizePreview.id === childId) {
        next[childId] = { ...block, geometry: { ...block.geometry, ...resizePreview.box } };
      } else if (movePreview !== null && movePreview.ids.includes(childId)) {
        const g = effectiveGeometry(block);
        next[childId] = {
          ...block,
          geometry: {
            x: g.x + movePreview.dx,
            y: g.y + movePreview.dy,
            w: g.w,
            h: g.h,
            ...(block.geometry?.rotation !== undefined ? { rotation: block.geometry.rotation } : {}),
          },
        };
      }
    }
    return next;
  })();
  // The route's AVOIDANCE obstacles: the
  // surface's non-connector siblings' boxes — the endpoint's own box
  // stands too (a route over it is a crossing). The orthogonal's bend
  // line runs the first clear candidate around them.
  const obstacleBoxes: Box[] = [];
  for (const childId of childIds) {
    const block = previewBlocks[childId];
    if (block === undefined || block.type === "connector") continue;
    obstacleBoxes.push(effectiveGeometry(block));
  }
  const segments: ReactNode[] = [];
  // The arrowhead defs' fill set (collected in the loop; the def stands
  // per effective stroke value — the data color follows the line's own
  // stroke, the selected line's accent too).
  const arrowFills = new Set<string>();
  const arrowStartFills = new Set<string>();
  const circleFills = new Set<string>();

  for (const childId of childIds) {
    const block = blocks[childId];
    if (block === undefined || block.type !== "connector") continue;

    const attrs = block.attrs;
    if (attrs === undefined) continue; // lenient data without attrs: no line

    // The two-pass resolution (the 2026-10-15 endpoint shape): a free
    // { x, y } point stands as-is; a block ref with a PORT stands at the
    // block's edge midpoint; a block ref WITHOUT a port stands at the
    // block's edge anchor toward the OTHER endpoint's stand (the box's
    // center — the legacy sticky anchor: a moved block re-anchors the
    // line). The line draws when both endpoints stand (a docId ref or an
    // absent block skips — the wrapper carries data-missing).
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
    if (startPoint === null || endPoint === null) continue; // skipped: the wrapper carries data-missing

    const selected = selectedIds.includes(childId);
    const draggingThis = interactive && endpointDrag !== null && endpointDrag.connectorId === childId;
    // The preview replaces the dragged endpoint's point (the other
    // endpoint stands; the line's shape re-draws around it). The zero
    // normal on the preview: the free point bows out at render time.
    // The live snap (the drag's stick effect): within the snap radius the
    // preview stands at the EDGE ANCHOR (the side's point at the
    // fractional position — the continuous anchor of) — not the raw cursor point. The snap stands the PORT's
    // normal (the curve bows out from it); the in-air preview stands the
    // STOREd endpoint's direction (the frozen normal — the line stands
    // its direction while the endpoint is in the air).
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

    const stroke = selected
      ? CONNECTOR_SELECTED_STROKE
      : attrs.strokeColor === undefined || attrs.strokeColor === "none"
        ? CONNECTOR_STROKE
        : attrs.strokeColor;
    // The width stand (the 1–4 data attr; the lenient render clamps the
    // raw write) + the selection's bump (the 1x default stands the
    // former 1→2 emphasis).
    const baseWidth = Math.min(
      MAX_STROKE_WIDTH,
      Math.max(MIN_STROKE_WIDTH, Math.round(attrs.strokeWidth ?? DEFAULT_STROKE_WIDTH))
    );
    const strokeWidth = selected ? baseWidth + SELECTED_WIDTH_BUMP : baseWidth;
    const dash = attrs.strokeStyle === "dash" ? "8 4" : attrs.strokeStyle === "dot" ? "1 4" : undefined;
    // The arrowheads (the independent
    // start figure 2026-10-22): each end stands its own figure — the end
    // defaults to "arrow" (absent), the start stands no marker when
    // absent. The marker follows the line's stroke (the data color / the
    // selected line's accent stand the arrowhead too — the def is per
    // fill value, collected below). The circle def is symmetric (it serves
    // both sides); the arrow defs are oriented (the end's non-inverted,
    // the start's inverted).
    const arrowHead = attrs.arrowHead ?? "arrow";
    const endArrow = arrowHead === "arrow";
    const endCircle = arrowHead === "circle";
    const startArrow = attrs.arrowStart === "arrow";
    const startCircle = attrs.arrowStart === "circle";
    if (endArrow) arrowFills.add(stroke);
    if (startArrow) arrowStartFills.add(stroke);
    if (endCircle || startCircle) circleFills.add(stroke);
    const endMarkerId = endCircle ? `${arrowDefId(id, stroke)}-ci` : endArrow ? arrowDefId(id, stroke) : null;
    const startMarkerId = startCircle
      ? `${arrowDefId(id, stroke)}-ci`
      : startArrow
        ? `${arrowDefId(id, stroke)}-s`
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
        ? {
            d: `M ${startPoly.x} ${startPoly.y} L ${attrs.points.map(([x, y]) => `${x} ${y}`).join(" L ")} L ${endPoly.x} ${endPoly.y}`,
            end: { x: endPoly.x, y: endPoly.y },
            mid: { x: (startPoly.x + endPoly.x) / 2, y: (startPoly.y + endPoly.y) / 2 },
          }
        : legacy
          ? connectorPath(startBox, endBox, attrs.variant ?? "straight")
          : connectorPathPoints(startDraw, endDraw, attrs.variant ?? "straight", obstacleBoxes);

    // The label (the midpoint's text; the empty string is the removed
    // state — the attr stands, the text stands nothing). The inline edit
    // stands the label off (the edit's input stands the draft at the
    // same seat).
    const label =
      attrs.label !== undefined && attrs.label !== "" && childId !== labelEditing ? (
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
        <g data-connector-snap-badge={childId} pointerEvents="none">
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

    segments.push(
      <g key={childId}>
        <path
          data-connector-id={childId}
          data-selected={selected || undefined}
          d={path.d}
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
        {snapBadge}
      </g>
    );
  }

  if (segments.length === 0) return null;
  // The SVG viewport stands 1x1 px at the surface center (the origin is
  // the surface center — the canvasItemStyle parity, the connector math's
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
      {/* The arrowhead defs (the marker's coordinate space is the canvas
          px; the fill follows the line's stroke — the per-value def: the
          data color / the token / the selection's accent). The end arrow
          stands its tip at the line's end (the refX at the tip), the
          start arrow stands its tip at the start point (the reversed
          geometry, the refX at the tip), the circle stands centered at
          the point (symmetric — the def serves both sides). */}
      <defs>
        {[...arrowFills].map((fill) => (
          <marker
            key={`end-${fill}`}
            id={arrowDefId(id, fill)}
            viewBox="0 0 8 8"
            refX={ARROW_SIZE}
            refY={ARROW_SIZE / 2}
            markerWidth={ARROW_SIZE}
            markerHeight={ARROW_SIZE}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 0 L 8 4 L 0 8 Z" style={{ fill }} />
          </marker>
        ))}
        {[...arrowStartFills].map((fill) => (
          <marker
            key={`start-${fill}`}
            id={`${arrowDefId(id, fill)}-s`}
            viewBox="0 0 8 8"
            refX={0}
            refY={ARROW_SIZE / 2}
            markerWidth={ARROW_SIZE}
            markerHeight={ARROW_SIZE}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 8 0 L 0 4 L 8 8 Z" style={{ fill }} />
          </marker>
        ))}
        {[...circleFills].map((fill) => (
          <marker
            key={`circle-${fill}`}
            id={`${arrowDefId(id, fill)}-ci`}
            viewBox="0 0 8 8"
            refX={ARROW_SIZE / 2}
            refY={ARROW_SIZE / 2}
            markerWidth={ARROW_SIZE}
            markerHeight={ARROW_SIZE}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <circle cx={ARROW_SIZE / 2} cy={ARROW_SIZE / 2} r={2.5} style={{ fill }} />
          </marker>
        ))}
      </defs>
      {segments}
    </svg>
  );
}

export { CONNECTOR_SELECTED_STROKE, CONNECTOR_STROKE, ConnectorLayer };
