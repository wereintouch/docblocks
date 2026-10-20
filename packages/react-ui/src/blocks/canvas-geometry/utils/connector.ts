/**
 * The connector line math: the edge anchor (the Miro anchor model), the
 * box-to-box path (the variant's shape), and the resolved-endpoint path
 * (the free-port generalization) with the orthogonal's right-angle stubs
 * and the obstacle AVOIDANCE (the shortest clear route over the
 * single-bend candidates + the two-bend-line U's).
 */
import { ORTHO_AVOID_MARGIN_PX, ORTHO_DETOUR_PX, ORTHO_STUB_PX, ROUTE_EPS } from "../models";
import type { Box, ConnectorPath, ConnectorVariant, EdgeAnchor, EndpointPoint, RoutePoint } from "../models";

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
  return { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`, end: { x: b.x, y: b.y }, mid };
}

/** Whether the axis-aligned segment crosses the rect's INTERIOR (the
 * boundary stand clear — a route along the edge is not a crossing).
 * The 0.5-px tolerance keeps a route hugging the edge from standing as
 * clear. */
function segmentHitsRect(x1: number, y1: number, x2: number, y2: number, r: Box): boolean {
  const left = r.x - r.w / 2 + ROUTE_EPS;
  const right = r.x + r.w / 2 - ROUTE_EPS;
  const top = r.y - r.h / 2 + ROUTE_EPS;
  const bottom = r.y + r.h / 2 - ROUTE_EPS;
  if (right <= left || bottom <= top) return false;
  if (Math.abs(x1 - x2) < 1e-9) {
    const yLo = Math.min(y1, y2);
    const yHi = Math.max(y1, y2);
    return x1 > left && x1 < right && yLo < bottom && yHi > top;
  }
  const xLo = Math.min(x1, x2);
  const xHi = Math.max(x1, x2);
  return y1 > top && y1 < bottom && xLo < right && xHi > left;
}

/** Whether the route (the axis-aligned consecutive segments) crosses any
 * obstacle's interior. */
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

/**
 * The connector's path between the RESOLVED endpoint points (the variant's
 * shape): the free-port generalization of connectorPath — straight is the
 * segment, orthogonal the right-angled elbow (the port endpoints stand a
 * STUB along their normal — the line leaves / enters the edge at a right
 * angle, the 12-px minimum offset from the block), curved the cubic bow (a zero normal — the free point —
 * bows out along the segment's own direction, so the line leaves the
 * point the way it arrived). The orthogonal's AVOIDANCE (the owner
 * decision 2026-10-19): when `obstacles` stand (the surface's sibling
 * boxes), the bend line runs the first CLEAR candidate (the default
 * elbow, then the alternatives, then the outer detours) — the line never
 * crosses a figure when a clear route stands; when the single-bend
 * candidates stand no route (the endpoint boxes nearly touch — the
 * corridor is sealed), the two-bend-line (U) candidates stand — the
 * shortest clear U; the fallback is the default elbow (the crossing
 * stands when no candidate is clear — the best effort). The candidate's
 * SELECTION is the shortest CLEAR route over the whole pool (the
 * single-bend's candidates + the U's; the list order — the default elbow
 * first — breaks the length ties), so an unrelated obstacle's far edge
 * cannot beat a near detour (a clear scene stands the default elbow
 * byte-for-byte — it is the shortest clear candidate).
 */
function connectorPathPoints(
  a: EndpointPoint,
  b: EndpointPoint,
  variant: ConnectorVariant,
  obstacles?: readonly Box[]
): ConnectorPath {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (variant === "straight") {
    return { d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, end: { x: b.x, y: b.y }, mid };
  }
  if (variant === "orthogonal") {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) {
      return { d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, end: { x: b.x, y: b.y }, mid };
    }
    // The port's STUB: the anchored endpoint (the non-zero normal) leaves
    // / is entered along its OUTWARD normal for the fixed offset — the
    // approach stands outside the block (the side run is parallel to the
    // edge at the 12-px offset and turns into the port at a right
    // angle); the free point (the zero normal) stands no stub (the elbow
    // reaches it directly).
    const aAnchored = a.nx !== 0 || a.ny !== 0;
    const bAnchored = b.nx !== 0 || b.ny !== 0;
    const aOut = aAnchored ? { x: a.x + a.nx * ORTHO_STUB_PX, y: a.y + a.ny * ORTHO_STUB_PX } : a;
    const bIn = bAnchored ? { x: b.x + b.nx * ORTHO_STUB_PX, y: b.y + b.ny * ORTHO_STUB_PX } : b;
    // The bend-line candidates (the deterministic order — the default
    // elbow stands first, so a clear scene stands byte-for-byte): the
    // dominant axis' midpoint, the other axis' midpoint, the L-shapes
    // (the bend on an endpoint's own line), and the outer detours (the
    // span offset by the detour px, both sides).
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const structures: Array<(t: number) => RoutePoint[]> = [
      horizontal
        ? (t) => [
            { x: t, y: aOut.y },
            { x: t, y: bIn.y },
          ]
        : (t) => [
            { x: aOut.x, y: t },
            { x: bIn.x, y: t },
          ],
      horizontal
        ? (t) => [
            { x: aOut.x, y: t },
            { x: bIn.x, y: t },
          ]
        : (t) => [
            { x: t, y: aOut.y },
            { x: t, y: bIn.y },
          ],
    ];
    const avoid = obstacles !== undefined && obstacles.length > 0;
    // The per-structure candidate order (the structure's OWN axis
    // coords): the midpoint (the default elbow), the L-shapes (the bend
    // on an endpoint's own line), the outer detours (the span offset,
    // both sides), and the OBSTACLE detours (each obstacle's edge on the
    // structure's axis offset by the margin — a box in the corridor
    // stands the route around it).
    const tsOf = (c1: number, c2: number, structureHorizontal: boolean): number[] => {
      const ts_ = [(c1 + c2) / 2, c2, c1, Math.min(c1, c2) - ORTHO_DETOUR_PX, Math.max(c1, c2) + ORTHO_DETOUR_PX];
      if (avoid) {
        for (const r of obstacles ?? []) {
          if (structureHorizontal) {
            ts_.push(r.x - r.w / 2 - ORTHO_AVOID_MARGIN_PX, r.x + r.w / 2 + ORTHO_AVOID_MARGIN_PX);
          } else {
            ts_.push(r.y - r.h / 2 - ORTHO_AVOID_MARGIN_PX, r.y + r.h / 2 + ORTHO_AVOID_MARGIN_PX);
          }
        }
      }
      return ts_;
    };
    const tsList = [
      horizontal ? tsOf(aOut.x, bIn.x, true) : tsOf(aOut.y, bIn.y, false),
      horizontal ? tsOf(aOut.y, bIn.y, false) : tsOf(aOut.x, bIn.x, true),
    ];
    // The route = the stubs + the bend's two points (the stubs stand at
    // the stub-less points when the endpoint stands no normal).
    const routeOf = (bend: RoutePoint[]): RoutePoint[] => {
      const points: RoutePoint[] = [a];
      if (aAnchored) points.push(aOut);
      points.push(...bend);
      if (bAnchored) points.push(bIn);
      points.push(b);
      return points;
    };
    // The selection pool: the single-bend's CLEAR candidates stand first
    // (the list order — the default elbow first), the U's append (the
    // sealed corridor's only clear set). The shortest stands; the pool's
    // order breaks the length ties (deterministic).
    const pool: { points: RoutePoint[]; length: number }[] = [];
    for (let i = 0; i < structures.length; i++) {
      const structure = structures[i];
      const ts = tsList[i];
      if (structure === undefined || ts === undefined) continue;
      for (const t of ts) {
        const candidate = routeOf(structure(t));
        if (avoid && routeHitsObstacles(candidate, obstacles)) continue;
        // The obstacle-free scene: the lengths stand equal (0) and the
        // pool's first entry (the default elbow) stands the pick.
        pool.push({ points: candidate, length: avoid ? routeLength(candidate) : 0 });
      }
    }
    if (avoid) {
      // The two-bend-line (U) candidates: both orientations (the exit
      // vertical / horizontal first), the corner's coords stand the span +
      // the obstacle detours.
      const xs = [Math.min(aOut.x, bIn.x) - ORTHO_DETOUR_PX, Math.max(aOut.x, bIn.x) + ORTHO_DETOUR_PX];
      const ys = [Math.min(aOut.y, bIn.y) - ORTHO_DETOUR_PX, Math.max(aOut.y, bIn.y) + ORTHO_DETOUR_PX];
      for (const r of obstacles ?? []) {
        xs.push(r.x - r.w / 2 - ORTHO_AVOID_MARGIN_PX, r.x + r.w / 2 + ORTHO_AVOID_MARGIN_PX);
        ys.push(r.y - r.h / 2 - ORTHO_AVOID_MARGIN_PX, r.y + r.h / 2 + ORTHO_AVOID_MARGIN_PX);
      }
      for (const y1 of ys) {
        for (const x1 of xs) {
          // F1: aOut -> (x1, aOut.y) -> (x1, y1) -> (bIn.x, y1) -> bIn
          // (the exit horizontal first).
          const f1 = routeOf([
            { x: x1, y: aOut.y },
            { x: x1, y: y1 },
            { x: bIn.x, y: y1 },
          ]);
          if (!routeHitsObstacles(f1, obstacles)) pool.push({ points: f1, length: routeLength(f1) });
          // F2: aOut -> (aOut.x, y1) -> (x1, y1) -> (x1, bIn.y) -> bIn
          // (the exit vertical first).
          const f2 = routeOf([
            { x: aOut.x, y: y1 },
            { x: x1, y: y1 },
            { x: x1, y: bIn.y },
          ]);
          if (!routeHitsObstacles(f2, obstacles)) pool.push({ points: f2, length: routeLength(f2) });
        }
      }
    }
    let points: RoutePoint[] | null = null;
    if (pool.length > 0) {
      let best = 0;
      for (let i = 1; i < pool.length; i++) {
        const length = pool[i]!.length;
        if (length < pool[best]!.length) best = i;
      }
      points = pool[best]!.points;
    }
    // The fallback (no clear candidate): the default elbow stands on its
    // OWN axis (the crossing stands when no route is clear).
    const midCoord = horizontal ? (aOut.x + bIn.x) / 2 : (aOut.y + bIn.y) / 2;
    const final = points ?? routeOf(structures[0]!(midCoord));
    // The degenerate bends (the bend point at the stub's point) stand no
    // redundant L (the duplicate points collapse).
    const deduped = final.filter((p, i) => i === 0 || p.x !== final[i - 1]!.x || p.y !== final[i - 1]!.y);
    const d = deduped.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    return {
      d,
      end: { x: b.x, y: b.y },
      mid: { x: (aOut.x + bIn.x) / 2, y: (aOut.y + bIn.y) / 2 },
    };
  }
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const reach = dist / 3;
  // The free point's zero normal bows out perpendicular to the segment
  // (both control points on the same side — the line bows to one side,
  // the deterministic side: the segment direction rotated -90°).
  const perp = dist === 0 ? { nx: 0, ny: 1 } : { nx: (b.y - a.y) / dist, ny: -(b.x - a.x) / dist };
  const aNormal = a.nx === 0 && a.ny === 0 ? perp : { nx: a.nx, ny: a.ny };
  const bNormal = b.nx === 0 && b.ny === 0 ? perp : { nx: b.nx, ny: b.ny };
  const c1 = { x: a.x + aNormal.nx * reach, y: a.y + aNormal.ny * reach };
  const c2 = { x: b.x + bNormal.nx * reach, y: b.y + bNormal.ny * reach };
  return { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`, end: { x: b.x, y: b.y }, mid };
}

export { connectorPath, connectorPathPoints, edgeAnchor };
