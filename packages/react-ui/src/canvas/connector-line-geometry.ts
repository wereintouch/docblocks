/** The canvas connector's line geometry: the path's resolution over the
 * endpoints' stand (the legacy's box path's byte parity over the stored
 * attrs, the resolved point's path over the port / the free endpoint /
 * the drag, the stored waypoints' priority) + the live preview's
 * endpoint boxes (the in-flight move / resize's stand — the lines follow
 * the items mid-drag). `null` over the unresolvable endpoint (the caller
 * stands its data-missing). The content's stand (the line's SVG, the
 * arrowheads, the connect badge) stands over ./connector-line. */
import type { Block, BlockId, ConnectorBlock } from "docblocks-core";

import type { Box } from "../canvas";
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

/** The line's resolved geometry (the caller's content's input). */
export interface ConnectorLineGeometry {
  /** The path's `d` (the surface's center-anchor space). */
  path: string;
  /** The start's draw point (the badge's endpoint drag's stand). */
  startDraw: EndpointPoint;
  /** The end's draw point (the badge's endpoint drag's stand). */
  endDraw: EndpointPoint;
  /** Whether this line's endpoint drag stands in flight. */
  dragging: boolean;
}

export function connectorLineGeometryOf(
  connectorId: BlockId,
  block: ConnectorBlock,
  childIds: readonly BlockId[],
  blocks: Record<BlockId, Block>,
  session: CanvasSession
): ConnectorLineGeometry | null {
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

  const dragging = endpointDrag !== null && endpointDrag.connectorId === connectorId;
  const snapPoint = (which: "start" | "end"): EndpointPoint | null => {
    if (!dragging || endpointDrag === null || endpointDrag.which !== which || endpointPreview === null) {
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
    dragging && endpointDrag !== null && endpointDrag.which === "start"
      ? (snapPoint("start") ?? startPoint)
      : startPoint;
  const endDraw: EndpointPoint =
    dragging && endpointDrag !== null && endpointDrag.which === "end" ? (snapPoint("end") ?? endPoint) : endPoint;

  // The stored points keep the polyline priority (the pre-variant
  // behavior: the freehand waypoints through the centers). The
  // polyline's endpoints stand as the legacy centers for plain refs
  // (the look preserved); a port / free endpoint stands at its own
  // point. A line whose endpoint is in a drag draws through the points
  // too (the live re-draw — the box path would stand the line off the
  // preview point).
  const legacy =
    startBox !== null &&
    endBox !== null &&
    startFree === null &&
    endFree === null &&
    attrs.start.port === undefined &&
    attrs.end.port === undefined &&
    !dragging;
  const polyPoint = (
    ref: { x?: number; y?: number; port?: string },
    resolved: EndpointPoint,
    box: { x: number; y: number } | null,
    key: "start" | "end"
  ): { x: number; y: number } => {
    const dragged = dragging && endpointDrag !== null && endpointDrag.which === key;
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

  return { path, startDraw, endDraw, dragging };
}
