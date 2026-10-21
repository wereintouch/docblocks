/** The canvas viewport's pure helpers: the connector endpoints'
 *  CONTINUOUS edge snap (the nearest point on a surface sibling's edge
 *  within the snap radius — the endpoint stands at that side and the
 *  fractional position along it;). */
import type { Doc } from "docblocks-core";

import { effectiveGeometry } from "../../blocks/canvas-geometry";
import type { CanvasPort } from "../../blocks/canvas-geometry";
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
 * The CONTINUOUS edge snap over the single block: the side and the
 * fractional position whose edge point stands nearest to `p` within the
 * snap radius (the canvas px, the zoom-blind space). Null when no side
 * stands (the release in the air stands the free point).
 */
function snapEdgePoint(doc: Doc, blockId: string, point: CanvasPoint): EndpointSnap | null {
  const block = doc.getBlock(blockId);
  if (block === null) return null;
  const box = effectiveGeometry(block);
  let snap: EndpointSnap | null = null;
  let best = ENDPOINT_SNAP_RADIUS;
  for (const port of SIDE_ORDER) {
    const { t, dist } = projectToSide(box, port, point);
    if (dist < best) {
      best = dist;
      snap = { blockId, port, t };
    }
  }
  return snap;
}

/**
 * The endpoint drag / the draw's second pick: the surface sibling whose
 * edge stands the nearest point to `p` within the snap radius. A release
 * over the dragged endpoint's OWN block re-anchors it (the side and the
 * position stand the release's projection — the continuous contract
 * replaces the legacy "the own port stands the detach" rule). The
 * connector and the group never stand edges (a connector carries no box;
 * the group's box is derived — the snap would stand the default size).
 */
function snapEndpointEdge(doc: Doc, surfaceId: string, point: CanvasPoint): EndpointSnap | null {
  const children = doc.getChildren(surfaceId);
  let snap: EndpointSnap | null = null;
  let best = ENDPOINT_SNAP_RADIUS;
  for (const siblingId of children) {
    const sibling = doc.getBlock(siblingId);
    if (sibling === null || sibling.type === "connector" || sibling.type === "group") continue;
    const box = effectiveGeometry(sibling);
    for (const port of SIDE_ORDER) {
      const { t, dist } = projectToSide(box, port, point);
      if (dist < best) {
        best = dist;
        snap = { blockId: siblingId, port, t };
      }
    }
  }
  return snap;
}

export { snapEdgePoint, snapEndpointEdge };
