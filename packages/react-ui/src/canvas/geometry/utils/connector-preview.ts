/**
 * The connector's endpoint resolution over the in-flight previews (the
 * move / resize's item deltas + the endpoint drag's live point / the
 * snap): the endpoint's HANDLES stand (the chrome overlay's data — the
 * handles stand in the screen space, over the floating toolbars) and the
 * line's MIDPOINT seat (the label chip's / the toolbar's anchor) — the
 * same two-pass resolution as the line's draw, so they stand from one
 * number.
 */
import type { Block } from "docblocks-core";

import { PORT_NORMAL } from "../constants";
import type { Box, CanvasPort, EndpointPoint } from "../models";
import { connectorPathPoints } from "./connector";
import { edgePointOf, effectiveGeometry, endpointBoxOf, endpointPointOf } from "./geometry";
import { connectorPath } from "./route";

/** The in-flight canvas previews (the move / resize's item deltas + the
 * connector's endpoint drag over its live point / the snap) — the live
 * geometry the line, the handles, and the line's midpoint seat (the label
 * chip / the toolbar's anchor) resolve from, so they stand from one
 * number. */
interface ConnectorPreviews {
  movePreview: { ids: readonly string[]; dx: number; dy: number } | null;
  resizePreview: { id: string; box: Box } | null;
  endpointDrag: { connectorId: string; which: "start" | "end" } | null;
  endpointPreview: {
    point: { x: number; y: number };
    snap: { blockId: string; port: CanvasPort; t: number } | null;
  } | null;
}

/**
 * The endpoint handles' stand for a single selected connector (the chrome
 * overlay's data — the handles stand in the screen space, over the
 * floating toolbars). The resolution stands the same two-pass logic as the
 * connector's render (the previewed blocks + the endpoint drag's live point
 * / the snap's stick), so the overlay and the line stand from one number.
 */
function connectorHandlePoints(
  childIds: readonly string[],
  blocks: Record<string, Block>,
  connectorId: string,
  previews: ConnectorPreviews
): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
  const block = blocks[connectorId];
  if (block === undefined || block.type !== "connector") return null;
  const attrs = block.attrs;
  if (attrs === undefined) return null;

  // The live geometry: the in-flight move / resize previews stand the
  // endpoint resolution (like the connector's render).
  const previewBlocks: Record<string, Block> = { ...blocks };
  if (previews.movePreview !== null || previews.resizePreview !== null) {
    for (const childId of childIds) {
      const child = previewBlocks[childId];
      if (child === undefined || child.type === "connector") continue;
      if (previews.resizePreview !== null && previews.resizePreview.id === childId) {
        previewBlocks[childId] = { ...child, geometry: { ...child.geometry, ...previews.resizePreview.box } };
      } else if (previews.movePreview !== null && previews.movePreview.ids.includes(childId)) {
        const g = effectiveGeometry(child);
        previewBlocks[childId] = {
          ...child,
          geometry: {
            x: g.x + previews.movePreview.dx,
            y: g.y + previews.movePreview.dy,
            w: g.w,
            h: g.h,
          },
        };
      }
    }
  }

  // The two-pass resolution (the connector's render's logic): a free
  // { x, y } point stands as-is; a block ref with a PORT stands at the
  // block's edge midpoint; a block ref WITHOUT a port stands at the
  // block's edge anchor toward the OTHER endpoint's stand.
  const startBox = endpointBoxOf(attrs.start, childIds, previewBlocks);
  const endBox = endpointBoxOf(attrs.end, childIds, previewBlocks);
  const startFree =
    attrs.start.x !== undefined && attrs.start.y !== undefined ? { x: attrs.start.x, y: attrs.start.y } : null;
  const endFree = attrs.end.x !== undefined && attrs.end.y !== undefined ? { x: attrs.end.x, y: attrs.end.y } : null;
  const startToward = endBox !== null ? { x: endBox.x, y: endBox.y } : (endFree ?? { x: 0, y: 0 });
  const endToward = startBox !== null ? { x: startBox.x, y: startBox.y } : (startFree ?? { x: 0, y: 0 });
  const startPoint = endpointPointOf(attrs.start, childIds, previewBlocks, startToward);
  const endPoint = endpointPointOf(attrs.end, childIds, previewBlocks, endToward);
  if (startPoint === null || endPoint === null) return null;

  // The endpoint drag's live stand: the preview replaces the dragged
  // endpoint's point; the live snap stands the EDGE ANCHOR (the side's
  // point at the fractional position — the stick effect, the continuous
  // anchor of).
  const dragging = previews.endpointDrag !== null && previews.endpointDrag.connectorId === connectorId;
  const livePoint = (which: "start" | "end", resolved: { x: number; y: number }): { x: number; y: number } => {
    if (!dragging || previews.endpointDrag === null || previews.endpointDrag.which !== which) {
      return resolved;
    }
    const preview = previews.endpointPreview;
    if (preview === null) return resolved;
    const snap = preview.snap;
    if (snap === null) return { x: preview.point.x, y: preview.point.y };
    const sibling = previewBlocks[snap.blockId];
    if (sibling === undefined) return { x: preview.point.x, y: preview.point.y };
    const p = edgePointOf(effectiveGeometry(sibling), snap.port, snap.t);
    return { x: p.x, y: p.y };
  };
  return {
    start: livePoint("start", { x: startPoint.x, y: startPoint.y }),
    end: livePoint("end", { x: endPoint.x, y: endPoint.y }),
  };
}

/**
 * The line's MIDPOINT seat (the label's / the toolbar's anchor): the same
 * path resolution as the overlay's line — the stored `points` polyline's
 * end-midpoint, the legacy box-based path's midpoint (the plain-ref pair —
 * the legacy look), the resolved endpoints' midpoint otherwise (the port /
 * free stands). Null when an endpoint does not resolve within the surface
 * (the lenient posture — the line stands nothing, the seat with it).
 * With `previews` (the in-flight canvas session) the seat stands the live
 * geometry (the move / resize's previewed blocks + the endpoint drag's
 * live point / the snap's stick) — the same inputs as the line's re-draw,
 * so the seat follows the line mid-drag and the release stands no jump
 * (the preview's stand is the commit's stand). The `connectorId` (the
 * block's map key — the block's own shape carries no id) stands the
 * endpoint drag's identity match (like the handles' and the line's).
 */
function connectorMidpoint(
  connectorId: string,
  childIds: readonly string[],
  blocks: Record<string, Block>,
  previews?: ConnectorPreviews
): { x: number; y: number } | null {
  const block = blocks[connectorId];
  if (block === undefined || block.type !== "connector") return null;
  const attrs = block.attrs;
  if (attrs === undefined) return null; // lenient data without attrs: no line
  // The live geometry: the in-flight move / resize previews stand the
  // endpoint resolution (like the connector's render and the handles).
  let live = blocks;
  if (previews !== undefined && (previews.movePreview !== null || previews.resizePreview !== null)) {
    live = { ...blocks };
    for (const childId of childIds) {
      const child = live[childId];
      if (child === undefined || child.type === "connector") continue;
      if (previews.resizePreview !== null && previews.resizePreview.id === childId) {
        live[childId] = { ...child, geometry: { ...child.geometry, ...previews.resizePreview.box } };
      } else if (previews.movePreview !== null && previews.movePreview.ids.includes(childId)) {
        const g = effectiveGeometry(child);
        live[childId] = {
          ...child,
          geometry: {
            x: g.x + previews.movePreview.dx,
            y: g.y + previews.movePreview.dy,
            w: g.w,
            h: g.h,
          },
        };
      }
    }
  }
  const startBox = endpointBoxOf(attrs.start, childIds, live);
  const endBox = endpointBoxOf(attrs.end, childIds, live);
  const startFree =
    attrs.start.x !== undefined && attrs.start.y !== undefined ? { x: attrs.start.x, y: attrs.start.y } : null;
  const endFree = attrs.end.x !== undefined && attrs.end.y !== undefined ? { x: attrs.end.x, y: attrs.end.y } : null;
  const startToward = endBox !== null ? { x: endBox.x, y: endBox.y } : (endFree ?? { x: 0, y: 0 });
  const endToward = startBox !== null ? { x: startBox.x, y: startBox.y } : (startFree ?? { x: 0, y: 0 });
  const startPoint = endpointPointOf(attrs.start, childIds, live, startToward);
  const endPoint = endpointPointOf(attrs.end, childIds, live, endToward);
  if (startPoint === null || endPoint === null) return null;
  // The endpoint drag's live stand: the preview replaces the dragged
  // endpoint's point (the snap's edge anchor — the stick, the same
  // resolution as the line's re-draw and the handles).
  const endpointDrag = previews?.endpointDrag ?? null;
  const startDragged =
    endpointDrag !== null && endpointDrag.connectorId === connectorId && endpointDrag.which === "start";
  const endDragged = endpointDrag !== null && endpointDrag.connectorId === connectorId && endpointDrag.which === "end";
  const livePoint = (which: "start" | "end", resolved: EndpointPoint): EndpointPoint => {
    if (endpointDrag === null || endpointDrag.connectorId !== connectorId || endpointDrag.which !== which) {
      return resolved;
    }
    const preview = previews?.endpointPreview ?? null;
    if (preview === null) return resolved;
    const snap = preview.snap;
    const point = { x: preview.point.x, y: preview.point.y };
    if (snap === null) {
      // The frozen direction: the stored endpoint's normal (the drag stands
      // no doc write — the normal is the stored attrs' resolution).
      return { ...point, nx: resolved.nx, ny: resolved.ny };
    }
    const sibling = live[snap.blockId];
    if (sibling === undefined) return { ...point, nx: 0, ny: 0 };
    const p = edgePointOf(effectiveGeometry(sibling), snap.port, snap.t);
    const normal = PORT_NORMAL[snap.port];
    return { x: p.x, y: p.y, nx: normal.nx, ny: normal.ny };
  };
  const startDraw: EndpointPoint = livePoint("start", startPoint);
  const endDraw: EndpointPoint = livePoint("end", endPoint);
  // The polyline's endpoints stand as the legacy centers for plain refs
  // (the look preserved); a port / free endpoint / the dragged end stands
  // at its own point.
  const polyPoint = (
    ref: { x?: number; y?: number; port?: string },
    resolved: { x: number; y: number },
    box: { x: number; y: number } | null,
    dragged: boolean
  ): { x: number; y: number } =>
    ref.x !== undefined && ref.y !== undefined
      ? { x: ref.x, y: ref.y }
      : ref.port !== undefined || box === null || dragged
        ? { x: resolved.x, y: resolved.y }
        : { x: box.x, y: box.y };
  if (attrs.points !== undefined && attrs.points.length > 0) {
    const a = polyPoint(attrs.start, startDraw, startBox, startDragged);
    const b = polyPoint(attrs.end, endDraw, endBox, endDragged);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  // The legacy box-based path (the plain-ref pair) stands no re-draw while
  // one of its endpoints is in a drag (the line draws through the points
  // then — the seat with it).
  const legacy =
    startBox !== null &&
    endBox !== null &&
    startFree === null &&
    endFree === null &&
    attrs.start.port === undefined &&
    attrs.end.port === undefined &&
    !startDragged &&
    !endDragged;
  if (legacy) {
    return connectorPath(startBox, endBox, attrs.variant ?? "straight").mid;
  }
  // The port / free's stand: the seat resolves over the SAME path the line
  // draws (the orthogonal's elbow + the stubs, the obstacle's avoidance) —
  // the polyline's longest run's mid (one source: the label stands on the
  // visible line, not the endpoints' straight mid). The obstacles stand the
  // surface's sibling boxes (the group's frame stands no obstacle — like
  // the line's re-draw).
  const obstacleBoxes: Box[] = [];
  for (const childId of childIds) {
    const item = live[childId];
    if (item === undefined || item.type === "connector" || item.type === "group") continue;
    obstacleBoxes.push(effectiveGeometry(item));
  }
  return connectorPathPoints(startDraw, endDraw, attrs.variant ?? "straight", obstacleBoxes).mid;
}

export { connectorHandlePoints, connectorMidpoint };
export type { ConnectorPreviews };
