/** The canvas connector's line math + content: the line's render over the
 * endpoints' resolution (the orthogonal avoidance over the ports, the
 * arrowheads, the connect badge over the snapped port) and the hit path's
 * bbox read (the webkit's hit-test's stand). The per-line component
 * (ConnectorLine.tsx) stands the session's subscription + the svg's mount;
 * the content's stand is this module (the memo's unit). */
import type { CSSProperties, ReactNode } from "react";

import type { Block, BlockId, ConnectorBlock } from "docblocks-core";

import type { Box } from "../canvas";
import { Link } from "../shared/ui/icons";
import { SURFACE_BG } from "./canvas-view/constants";
import { CONNECT_COLOR, SNAP_BADGE_LIFT, SNAP_BADGE_RADIUS } from "./connector-constants";
import { arrowDefId, connectorStrokeOf, connectorStrokeWidthOf } from "./connector-utils";
import type { EndpointPoint } from "./geometry";
import {
  PORT_NORMAL,
  connectorPath,
  connectorPathPoints,
  edgePointOf,
  effectiveGeometry,
  endpointBoxOf,
  endpointPointOf,
} from "./geometry";
import type { CanvasSession } from "./viewport";

/**
 * One connector's line content over the endpoint's resolution: the route's
 * stand (the legacy's box path's byte parity over the stored attrs, the
 * resolved point's path over the port / the free endpoint / the drag),
 * the arrowheads (the per-end figures), the connect badge (the endpoint
 * drag's port snap — the green Link over the snapped port). `null` over
 * the unresolvable endpoint (the wrapper stands its data-missing).
 *
 * `interactive` toggles the hit path: the canvas view is interactive
 * (the line is selectable, the endpoints draggable), the page view's
 * embedded surface stands it inert (no selection / dragging there — the
 * bands must not intercept the content's clicks). The hit path's `d`
 * is returned alongside the content: the hit path renders in its own
 * bbox-sized svg — the webkit does not hit-test the overflow-visible
 * content over the 1x1 svg's box, so the line is not clickable from
 * there without the box.
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
): { content: ReactNode; hitD: string | null } | null {
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
      } else if (movePreview !== null && movePreview.idSet.has(childId)) {
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
  // attribute cannot carry var()).
  const pathStyle: CSSProperties = { stroke: stroke };

  return {
    content: (
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
        {snapBadge}
      </>
    ),
    hitD: interactive ? path : null,
  };
}

/** The path's points' bounding box (the surface's center-anchor space):
 * the `d`'s M/L's coordinates (the plain numbers' parse — the builder's
 * template's format). The hit path's svg box must contain the stroke:
 * the webkit hit-tests only inside the svg's own box, so the hit path
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
