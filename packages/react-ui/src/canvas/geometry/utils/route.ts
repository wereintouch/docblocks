/**
 * The connector path's shape math (the variant's form): the edge anchor
 * (the Miro anchor model), the box-to-box path (the variant's shape), and
 * the route's measures (the obstacle's crossing — the direct scan, the
 * dense set's spatial grid stands in the resolved-endpoint's selection),
 * the length, the bend count, the longest-run's mid (the label's seat),
 * the bezier's midpoint.
 */
import { type Box, type ConnectorPath, type ConnectorVariant, type EdgeAnchor, type RoutePoint } from "../models";
import { segmentHitsRect } from "./obstacles";

/**
 * The edge anchor (the center-to-toward segment's exit from the box's
 * border, the Miro anchor model): the line always leaves the box at the
 * edge the target direction points at, so a moved block re-anchors the
 * line automatically. The zero vector (the coincident centers) falls
 * back to the east edge's midpoint.
 */
function edgeAnchor(box: Box, toward: { x: number; y: number }): EdgeAnchor {
  const dx = toward.x - box.x;
  const dy = toward.y - box.y;
  if (dx === 0 && dy === 0) return { x: box.x + box.w / 2, y: box.y, nx: 1, ny: 0 };
  const lambdaX = dx === 0 ? Infinity : dx > 0 ? box.w / 2 / dx : -box.w / 2 / dx;
  const lambdaY = dy === 0 ? Infinity : dy > 0 ? box.h / 2 / dy : -box.h / 2 / dy;
  if (lambdaX <= lambdaY) {
    return {
      x: box.x + (dx > 0 ? box.w / 2 : -box.w / 2),
      y: box.y + lambdaX * dy,
      nx: dx > 0 ? 1 : -1,
      ny: 0,
    };
  }
  return {
    x: box.x + lambdaY * dx,
    y: box.y + (dy > 0 ? box.h / 2 : -box.h / 2),
    nx: 0,
    ny: dy > 0 ? 1 : -1,
  };
}

/**
 * The connector's path between the endpoint boxes (the variant's shape).
 * straight: the edge-to-edge segment. orthogonal: the right-angled elbow
 * through the dominant axis' mid-edges (the horizontal dominant: the east
 * / west edge midpoints, the vertical bend at the mid x). curved: the
 * cubic bezier bowing out along the anchored edges' outward normals (the
 * line leaves each box perpendicular to its edge). Degenerate cases (the
 * coincident centers) stand as the straight edge-to-edge segment.
 */
function connectorPath(start: Box, end: Box, variant: ConnectorVariant): ConnectorPath {
  const a = edgeAnchor(start, { x: end.x, y: end.y });
  const b = edgeAnchor(end, { x: start.x, y: start.y });
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

  if (variant === "straight") {
    return { d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, end: { x: b.x, y: b.y }, mid };
  }

  if (variant === "orthogonal") {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) {
      return { d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, end: { x: b.x, y: b.y }, mid };
    }
    if (Math.abs(dx) >= Math.abs(dy)) {
      // The horizontal dominant: out of the east/west mid-edges, the
      // vertical bend at the mid x between the two edge x's.
      const sx = start.x + (dx > 0 ? start.w / 2 : -start.w / 2);
      const ex = end.x - (dx > 0 ? end.w / 2 : -end.w / 2);
      const bendX = (sx + ex) / 2;
      return {
        d: `M ${sx} ${start.y} L ${bendX} ${start.y} L ${bendX} ${end.y} L ${ex} ${end.y}`,
        end: { x: ex, y: end.y },
        mid: { x: bendX, y: (start.y + end.y) / 2 },
      };
    }
    // The vertical dominant (the symmetric case).
    const sy = start.y + (dy > 0 ? start.h / 2 : -start.h / 2);
    const ey = end.y - (dy > 0 ? end.h / 2 : -end.h / 2);
    const bendY = (sy + ey) / 2;
    return {
      d: `M ${start.x} ${sy} L ${start.x} ${bendY} L ${end.x} ${bendY} L ${end.x} ${ey}`,
      end: { x: end.x, y: ey },
      mid: { x: (start.x + end.x) / 2, y: bendY },
    };
  }

  // The curved: the control points ride the anchored edges' outward
  // normals (a third of the span), so the line bows out perpendicular
  // from each box.
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const reach = dist / 3;
  const c1 = { x: a.x + a.nx * reach, y: a.y + a.ny * reach };
  const c2 = { x: b.x + b.nx * reach, y: b.y + b.ny * reach };
  // The seat stands on the curve's own midpoint (the bezier's t = 0.5) — the
  // endpoints' straight mid stands in the air off the bow.
  return {
    d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`,
    end: { x: b.x, y: b.y },
    mid: cubicMid(a, c1, c2, b),
  };
}

/** Whether the route (the axis-aligned consecutive segments) crosses any
 * obstacle's interior, over the direct scan (the small set's stand — the
 * dense set's spatial grid stands in the route math). */
function routeHitsObstacles(points: readonly RoutePoint[], obstacles: readonly Box[]): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    if (p === undefined || q === undefined) continue;
    for (const r of obstacles) {
      if (segmentHitsRect(p.x, p.y, q.x, q.y, r)) return true;
    }
  }
  return false;
}

/** The route's total length (the Manhattan span of the consecutive
 * segments — the detour comparison's measure). */
function routeLength(points: readonly RoutePoint[]): number {
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    if (p === undefined || q === undefined) continue;
    length += Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
  }
  return length;
}

/** The route's bend count (the direction changes in the axis-aligned
 * polyline — straight = 0, the single-bend elbow = 1, the two-bend U = 2).
 * The consecutive duplicate points collapse first (the degenerate bends
 * stand no direction change). */
function routeBends(points: readonly RoutePoint[]): number {
  const pts: RoutePoint[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (last === undefined || last.x !== p.x || last.y !== p.y) pts.push(p);
  }
  let bends = 0;
  let prevAxis: "h" | "v" | null = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    if (p === undefined || q === undefined) continue;
    const axis: "h" | "v" = Math.abs(q.x - p.x) >= Math.abs(q.y - p.y) ? "h" : "v";
    if (prevAxis !== null && prevAxis !== axis) bends += 1;
    prevAxis = axis;
  }
  return bends;
}

/** The MIDDLE of the polyline's LONGEST consecutive segment (the label's
 * seat — on the visible line, on the longest run, so an elbow's short
 * stubs (the 12-px port's offset) stand no anchor). The first longest
 * segment stands on a tie (the deterministic order). */
function longestSegmentMid(points: readonly RoutePoint[]): { x: number; y: number } {
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i]!;
    const q = points[i + 1]!;
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  const p = points[best] ?? { x: 0, y: 0 };
  const q = points[best + 1] ?? p;
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
}

/** The cubic bezier's point at t = 0.5 (the curve's own midpoint — the seat
 * stands on the bow, not the endpoints' straight mid which stands in the air
 * off the curve). */
function cubicMid(
  a: { x: number; y: number },
  c1: { x: number; y: number },
  c2: { x: number; y: number },
  b: { x: number; y: number }
): { x: number; y: number } {
  return {
    x: 0.125 * a.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * b.x,
    y: 0.125 * a.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * b.y,
  };
}

export { connectorPath, cubicMid, edgeAnchor, longestSegmentMid, routeBends, routeHitsObstacles, routeLength };
