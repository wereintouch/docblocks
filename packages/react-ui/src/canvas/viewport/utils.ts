/** The canvas viewport's pure helpers: the connector endpoints' edge
 *  snap — the CONTINUOUS stand (the nearest point on a surface sibling's
 *  edge within the snap radius — the endpoint stands at that side and the
 *  fractional position along it;) with the
 *  PORT stick: within the snap radius of
 *  the side's midpoint PORT the anchor locks to the port (t = 0.5) — the
 *  endpoint sticks to the edge's central dot as it approaches it, the
 *  continuous stand stands the rest of the edge. */
import type { Doc } from "docblocks-core";

import { edgeAnchor, edgePointOf, effectiveGeometry } from "../../blocks/canvas-geometry";
import type { Box, CanvasPort } from "../../blocks/canvas-geometry";
import type { CanvasPoint } from "../viewport";
import { ENDPOINT_SNAP_RADIUS } from "./models";
import type { EndpointSnap } from "./models";

const SIDE_ORDER: readonly CanvasPort[] = ["north", "east", "south", "west"];

/**
 * The point of `p`'s projection onto the box's side segment: the side's
 * start corner stands t = 0, its end corner t = 1 (north / south: left
 * to right; east / west: top to bottom — the portT's contract). The
 * degenerate side (the zero span) stands the midpoint's fallback (the
 * distance to the box's center).
 */
function projectToSide(
  box: { x: number; y: number; w: number; h: number },
  port: CanvasPort,
  p: CanvasPoint
): { t: number; dist: number } {
  const [x0, y0] =
    port === "north"
      ? [box.x - box.w / 2, box.y - box.h / 2]
      : port === "east"
        ? [box.x + box.w / 2, box.y - box.h / 2]
        : port === "south"
          ? [box.x - box.w / 2, box.y + box.h / 2]
          : [box.x - box.w / 2, box.y - box.h / 2];
  const horizontal = port === "north" || port === "south";
  const span = horizontal ? box.w : box.h;
  if (span <= 0) {
    return { t: 0.5, dist: Math.hypot(p.x - box.x, p.y - box.y) };
  }
  const t = Math.min(1, Math.max(0, horizontal ? (p.x - x0) / span : (p.y - y0) / span));
  const cx = horizontal ? x0 + t * span : x0;
  const cy = horizontal ? y0 : y0 + t * span;
  return { t, dist: Math.hypot(p.x - cx, p.y - cy) };
}

/**
 * The side's candidate for `p`: the PORT stick first (within the snap
 * radius of the side's midpoint the anchor locks to the port — the
 * central dot attracts, t = 0.5), the CONTINUOUS projection otherwise
 * (the nearest point on the side's segment, clamped to its span).
 */
function sideCandidate(
  box: { x: number; y: number; w: number; h: number },
  port: CanvasPort,
  p: CanvasPoint
): { t: number; dist: number } {
  const mid = edgePointOf(box, port, 0.5);
  const distMid = Math.hypot(p.x - mid.x, p.y - mid.y);
  if (distMid <= ENDPOINT_SNAP_RADIUS) return { t: 0.5, dist: distMid };
  return projectToSide(box, port, p);
}

/**
 * The edge snap over the single block: the side and the fractional
 * position whose edge point stands nearest to `p` within the snap radius
 * (the canvas px, the zoom-blind space) — the port's midpoint locks the
 * anchor at t = 0.5 over its stick disk. Null when no side stands (the
 * release in the air stands the free point).
 */
function snapEdgePoint(doc: Doc, blockId: string, point: CanvasPoint): EndpointSnap | null {
  const block = doc.getBlock(blockId);
  if (block === null) return null;
  const box = effectiveGeometry(block);
  let snap: EndpointSnap | null = null;
  let best = ENDPOINT_SNAP_RADIUS;
  for (const port of SIDE_ORDER) {
    const { t, dist } = sideCandidate(box, port, point);
    if (dist < best) {
      best = dist;
      snap = { blockId, port, t };
    }
  }
  return snap;
}

/**
 * The endpoint drag / the draw's second pick: the surface sibling whose
 * edge stands the nearest point to `p` within the snap radius (the port's
 * stick disk included). A release over the dragged endpoint's OWN block
 * re-anchors it (the side and the position stand the release's stand —
 * the continuous contract replaces the legacy "the own port stands the
 * detach" rule). The connector and the group never stand edges (a
 * connector carries no box; the group's box is derived — the snap would
 * stand the default size).
 */
function snapSurfaceEdge(doc: Doc, surfaceId: string, point: CanvasPoint): { snap: EndpointSnap; dist: number } | null {
  const children = doc.getChildren(surfaceId);
  let best: { snap: EndpointSnap; dist: number } | null = null;
  for (const siblingId of children) {
    const sibling = doc.getBlock(siblingId);
    if (sibling === null || sibling.type === "connector" || sibling.type === "group") continue;
    const box = effectiveGeometry(sibling);
    for (const port of SIDE_ORDER) {
      const { t, dist } = sideCandidate(box, port, point);
      if (dist < ENDPOINT_SNAP_RADIUS && (best === null || dist < best.dist)) {
        best = { snap: { blockId: siblingId, port, t }, dist };
      }
    }
  }
  return best;
}

function snapEndpointEdge(doc: Doc, surfaceId: string, point: CanvasPoint): EndpointSnap | null {
  return snapSurfaceEdge(doc, surfaceId, point)?.snap ?? null;
}

/**
 * The hover / the preview end's edge snap over ALL the root-level
 * surfaces' siblings (the nearest edge within the radius wins): the
 * draw's stand and the line's end can stand on any surface, not just the
 * hovered one's. The connector and the group stands no edges (the
 * `snapSurfaceEdge`'s contract).
 */
function snapAnySurfaceEdge(doc: Doc, point: CanvasPoint): EndpointSnap | null {
  const rootChildren = doc.getChildren(doc.meta.id);
  let best: { snap: EndpointSnap; dist: number } | null = null;
  for (const childId of rootChildren) {
    const surface = doc.getBlock(childId);
    if (surface === null || surface.type !== "surface") continue;
    const candidate = snapSurfaceEdge(doc, childId, point);
    if (candidate !== null && (best === null || candidate.dist < best.dist)) {
      best = candidate;
    }
  }
  return best?.snap ?? null;
}

/**
 * The connector's press stand over the pressed block (the line stands from the pressed point, not the block's
 * center): the edge snap's stand — the PORT ref within the port's stick
 * disk (the legacy port stand, the portT's 0.5 absent), the FREE point at
 * the snapped edge point over the continuous edge (the frozen direction
 * = the snapped side), the PLAIN block ref over the interior (the auto
 * anchor stands the render / the commit).
 */
function connectorPressStand(
  doc: Doc,
  blockId: string,
  point: CanvasPoint
): { blockId?: string; free?: CanvasPoint; port?: CanvasPort; freePort?: CanvasPort } {
  const snap = snapEdgePoint(doc, blockId, point);
  if (snap === null) return { blockId };
  const block = doc.getBlock(blockId);
  if (block === null) return { blockId };
  const box = effectiveGeometry(block);
  const portPoint = edgePointOf(box, snap.port, 0.5);
  if (Math.hypot(point.x - portPoint.x, point.y - portPoint.y) <= ENDPOINT_SNAP_RADIUS) {
    return { blockId, port: snap.port };
  }
  const edgePoint = edgePointOf(box, snap.port, snap.t);
  return { free: { x: edgePoint.x, y: edgePoint.y }, freePort: snap.port };
}

/**
 * The pending preview's FROM over the pending stand: the port's point
 * over the port stand (the press's snap), the block's edge anchor toward
 * the cursor over the plain block ref (the auto anchor), the origin over
 * the missing block. The free stand stands its own point (no call).
 */
function connectorPreviewFrom(box: Box | null, port: CanvasPort | null, cursor: CanvasPoint): CanvasPoint {
  if (box === null) return { x: 0, y: 0 };
  if (port !== null) return edgePointOf(box, port, 0.5);
  return edgeAnchor(box, cursor);
}

/**
 * The pending preview's END point: the snapped edge point over the snap
 * (the endpoint drag's parity — the stick to the port / the continuous
 * edge within the radius), the raw cursor otherwise (or the cursor over
 * the missing snap block — the lenient read).
 */
function connectorPreviewPoint(cursor: CanvasPoint, snap: EndpointSnap | null, box: Box | null): CanvasPoint {
  if (snap === null || box === null) return cursor;
  return edgePointOf(box, snap.port, snap.t);
}

/**
 * The drag-to-size place's box: the center is the drag's midpoint (the
 * anchor stands regardless of the constraint), the size is the free drag's
 * W×H — or the SQUARE (W = H) while `shift` stands (the 1:1 constraint: the
 * larger of |dx| / |dy| wins, the Figma idiom; the 1 px floor stands so a
 * degenerate drag commits a 1 px figure). The preview and the release's
 * commit read from this one function (the preview's stand is the commit's
 * stand — the no-jump contract).
 */
function placeDragBox(
  start: CanvasPoint,
  current: CanvasPoint,
  shift: boolean
): { x: number; y: number; w: number; h: number } {
  const dx = Math.abs(current.x - start.x);
  const dy = Math.abs(current.y - start.y);
  const w = shift ? Math.max(dx, dy, 1) : Math.max(dx, 1);
  const h = shift ? Math.max(dx, dy, 1) : Math.max(dy, 1);
  return { x: (start.x + current.x) / 2, y: (start.y + current.y) / 2, w, h };
}

export {
  connectorPressStand,
  connectorPreviewFrom,
  connectorPreviewPoint,
  placeDragBox,
  snapAnySurfaceEdge,
  snapEdgePoint,
  snapEndpointEdge,
};
