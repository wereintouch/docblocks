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
  connectorPath,
  connectorPathPoints,
  effectiveGeometry,
  endpointBoxOf,
  endpointPointOf,
  portsOf,
} from "./canvas-geometry";

/** The v1 connector stroke (the shape token; the label uses the text color). */
const STROKE = "var(--docblocks-canvas-shape-stroke, currentColor)";
/** The selected connector's stroke (the canvas selection's cyan — the
 *  token stands in both themes; the page `--accent` is a hover surface,
 *  not a line color). */
const SELECTED_STROKE = "var(--docblocks-canvas-selected-stroke)";
/** The connect badge's green (the endpoint drag's port snap indicator). */
const CONNECT_COLOR = "var(--docblocks-canvas-connect-color, #16a34a)";
const CONNECTOR_STROKE_WIDTH = 1;
/** The selected connector's stroke width (the emphasis over the default). */
const SELECTED_STROKE_WIDTH = 2;
/** The invisible hit path's width (a wide enough stroke to click the line). */
const HIT_STROKE_WIDTH = 12;
/** The arrowhead's length (canvas px, the marker's coordinate space). */
const ARROW_SIZE = 8;
const LABEL_FONT_SIZE = 12;
/** The endpoint handle's radius (canvas px, zoom-scaled). */
const HANDLE_RADIUS = 4;
/** The endpoint handle's hit area (the wider invisible circle). */
const HANDLE_HIT_RADIUS = 8;
/** The connect badge's radius (canvas px, above the line's midpoint). */
const SNAP_BADGE_RADIUS = 10;
/** The connect badge's lift over the line's midpoint (canvas px). */
const SNAP_BADGE_LIFT = 16;

/** The selected line's endpoint handle data (the draw point + the key). */
interface EndpointHandle {
  key: "start" | "end";
  point: EndpointPoint;
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
  onEndpointDrag,
  movePreview,
  resizePreview,
}: {
  id: BlockId;
  interactive?: boolean;
  endpointDrag: { connectorId: BlockId; which: "start" | "end" } | null;
  endpointPreview: { point: { x: number; y: number }; snap: { blockId: string; port: CanvasPort } | null } | null;
  onEndpointDrag: (
    connectorId: BlockId,
    which: "start" | "end",
    pointerId: number,
    clientX: number,
    clientY: number
  ) => void;
  /** The in-flight move preview (the lines follow the items mid-drag). */
  movePreview: MovePreview | null;
  /** The in-flight resize preview (the lines follow the resized item). */
  resizePreview: { id: BlockId; box: Box } | null;
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
  const segments: ReactNode[] = [];

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
    const startPoint =
      startFree !== null
        ? { x: startFree.x, y: startFree.y, nx: 0, ny: 0 }
        : endpointPointOf(attrs.start, childIds, previewBlocks, startToward);
    const endPoint =
      endFree !== null
        ? { x: endFree.x, y: endFree.y, nx: 0, ny: 0 }
        : endpointPointOf(attrs.end, childIds, previewBlocks, endToward);
    if (startPoint === null || endPoint === null) continue; // skipped: the wrapper carries data-missing

    const selected = selectedIds.includes(childId);
    const draggingThis = interactive && endpointDrag !== null && endpointDrag.connectorId === childId;
    // The preview replaces the dragged endpoint's point (the other
    // endpoint stands; the line's shape re-draws around it). The zero
    // normal on the preview: the free point bows out at render time.
    // The live snap (the drag's stick effect): within the snap radius the
    // preview stands at the PORT (the line's end sticks to it) — not the
    // raw cursor point.
    const snapPoint = (which: "start" | "end"): { x: number; y: number } | null => {
      if (!draggingThis || endpointDrag === null || endpointDrag.which !== which || endpointPreview === null) {
        return null;
      }
      const snap = endpointPreview.snap;
      if (snap === null) return endpointPreview.point;
      const sibling = previewBlocks[snap.blockId];
      if (sibling === undefined) return endpointPreview.point;
      const p = portsOf(effectiveGeometry(sibling))[snap.port];
      return { x: p.x, y: p.y };
    };
    const startDraw: EndpointPoint =
      draggingThis && endpointDrag !== null && endpointDrag.which === "start"
        ? {
            x: snapPoint("start")?.x ?? startPoint.x,
            y: snapPoint("start")?.y ?? startPoint.y,
            nx: 0,
            ny: 0,
          }
        : startPoint;
    const endDraw: EndpointPoint =
      draggingThis && endpointDrag !== null && endpointDrag.which === "end"
        ? {
            x: snapPoint("end")?.x ?? endPoint.x,
            y: snapPoint("end")?.y ?? endPoint.y,
            nx: 0,
            ny: 0,
          }
        : endPoint;

    const stroke = selected ? SELECTED_STROKE : STROKE;
    const strokeWidth = selected ? SELECTED_STROKE_WIDTH : CONNECTOR_STROKE_WIDTH;
    const dash = attrs.strokeStyle === "dash" ? "8 4" : attrs.strokeStyle === "dot" ? "1 4" : undefined;
    // The marker follows the line's stroke (the selected line's accent
    // arrowhead stands the emphasis too).
    const markerId = `docblocks-conn-arrow-${id}${selected ? "-selected" : ""}`;

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
          : connectorPathPoints(startDraw, endDraw, attrs.variant ?? "straight");

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

    // The connect badge (the endpoint drag's port snap): the green Link
    // over the line's midpoint (the lift keeps it off the stroke) — the
    // "the point is connected" indicator.
    // A nested svg stands the icon at the badge's center (the icon
    // component's props spread onto its own svg element — the x / y stand
    // the nested viewport).
    const snapBadge =
      draggingThis && endpointPreview !== null && endpointPreview.snap !== null ? (
        <g data-connector-snap-badge={childId} pointerEvents="none">
          <circle
            cx={path.mid.x}
            cy={path.mid.y - SNAP_BADGE_LIFT}
            r={SNAP_BADGE_RADIUS}
            fill="var(--docblocks-canvas-surface-background, var(--card, #ffffff))"
            stroke={CONNECT_COLOR}
            strokeWidth={1.5}
          />
          <Link
            x={path.mid.x - 7}
            y={path.mid.y - SNAP_BADGE_LIFT - 7}
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

    // The endpoint handles (the selected line only): the two drag circles
    // at the resolved points (the preview point while dragging). The
    // invisible wider hit circle stands the pointerdown (the visible
    // circle is pointer-events none — the line's hit path stays the only
    // line click target).
    const handle = (key: "start" | "end", ep: EndpointHandle) =>
      interactive && selected ? (
        <g key={`${childId}-${key}`} data-connector-endpoint={key} data-connector-endpoint-id={childId}>
          <circle
            cx={ep.point.x}
            cy={ep.point.y}
            r={HANDLE_HIT_RADIUS}
            fill="transparent"
            pointerEvents="all"
            style={{ cursor: "grab" }}
            onPointerDown={(event) => {
              event.stopPropagation();
              onEndpointDrag(childId, key, event.pointerId, event.clientX, event.clientY);
            }}
          />
          <circle
            cx={ep.point.x}
            cy={ep.point.y}
            r={HANDLE_RADIUS}
            fill="var(--docblocks-canvas-surface-background, var(--card, #ffffff))"
            strokeWidth={1.5}
            pointerEvents="none"
            style={{ stroke: stroke }}
          />
        </g>
      ) : null;

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
        {snapBadge}
        {handle("start", { key: "start", point: startDraw })}
        {handle("end", { key: "end", point: endDraw })}
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
