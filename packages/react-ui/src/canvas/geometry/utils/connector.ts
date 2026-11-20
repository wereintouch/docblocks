/**
 * The connector's resolved-endpoint path (the free-port generalization of
 * the box-to-box's connectorPath): the variant's shape over the resolved
 * points (the orthogonal's right-angle stubs) + the orthogonal's obstacle
 * AVOIDANCE's candidate selection (the shortest clear route over the
 * single-bend's candidates + the two-bend-line U's; the pool stands
 * bounded over the sibling count — the candidate's obstacle coords are
 * the NEAREST cap of the edges within the route's span (topKSpanEdges)).
 */
import { ORTHO_AVOID_MARGIN_PX, ORTHO_DETOUR_PX, ORTHO_STUB_PX, SINGLE_BEND_EDGE_CAP, U_EDGE_CAP } from "../constants";
import type { Box, ConnectorPath, ConnectorVariant, EndpointPoint, RoutePoint } from "../models";
import { OBSTACLE_GRID_MIN, buildObstacleGrid, routeHitsGrid, topKSpanEdges } from "./obstacles";
import { cubicMid, longestSegmentMid, routeBends, routeHitsObstacles, routeLength } from "./route";

/**
 * The connector's path between the RESOLVED endpoint points (the variant's
 * shape): the free-port generalization of connectorPath — straight is the
 * segment, orthogonal the right-angled elbow (the port endpoints stand a
 * STUB along their normal — the line leaves / enters the edge at a right
 * angle, the 12-px minimum offset from the block), curved the cubic bow (a zero normal — the free point —
 * bows out along the segment's own direction, so the line leaves the
 * point the way it arrived). The orthogonal's AVOIDANCE: when
 * `obstacles` stand (the surface's sibling
 * boxes), the bend line runs the first CLEAR candidate (the default
 * elbow, then the alternatives, then the outer detours) — the line never
 * crosses a figure when a clear route stands; when the single-bend
 * candidates stand no route (the endpoint boxes nearly touch — the
 * corridor is sealed), the two-bend-line (U) candidates stand — the
 * shortest clear U; the fallback is the default elbow (the crossing
 * stands when no candidate is clear — the best effort). The candidate's
 * SELECTION is the shortest CLEAR route over the whole pool (the
 * single-bend's candidates + the U's); the equal length prefers the
 * FEWER bends (the straighter route), and the list order breaks only the
 * full tie, so an unrelated obstacle's far edge cannot beat a near
 * detour (an obstacle-free scene stands the default elbow byte-for-byte
 * — it is the shortest and straightest). The pool is BOUNDED over the
 * sibling count: the candidate's obstacle coords stand the NEAREST edges
 * over the route's span (the per-axis cap — a far edge's detour is longer
 * than the near one's, so the cap drops only the candidates the
 * selection cannot pick), and the hit test runs the spatial grid over
 * the dense sets (the segment's local stand, not the whole set).
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
    // elbow stands first, so an obstacle-free scene stands
    // byte-for-byte): the
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
    const obs = obstacles ?? [];
    // The route's hit test: the dense set's spatial grid (the segment's
    // local stand — the per-candidate cost is the cells' density, not the
    // set's size), the small set's direct scan.
    const grid = avoid && obs.length >= OBSTACLE_GRID_MIN ? buildObstacleGrid(obs) : null;
    const hits = (points: readonly RoutePoint[]): boolean =>
      grid !== null ? routeHitsGrid(points, grid) : routeHitsObstacles(points, obs);
    // The pool's obstacle edges per axis (the input order — the small scene's
    // pool stands the former's candidate order byte-for-byte): each box's
    // both edges inset by the margin (the detour's clearance).
    const xEdges: number[] = [];
    const yEdges: number[] = [];
    if (avoid) {
      for (const r of obs) {
        xEdges.push(r.x - r.w / 2 - ORTHO_AVOID_MARGIN_PX, r.x + r.w / 2 + ORTHO_AVOID_MARGIN_PX);
        yEdges.push(r.y - r.h / 2 - ORTHO_AVOID_MARGIN_PX, r.y + r.h / 2 + ORTHO_AVOID_MARGIN_PX);
      }
    }
    // The per-structure candidate order (the structure's OWN axis
    // coords): the midpoint (the default elbow), the L-shapes (the bend
    // on an endpoint's own line), the outer detours (the span offset,
    // both sides), and the OBSTACLE detours (the NEAREST obstacle's edges
    // on the structure's axis — the bounded cap keeps the pool's size off
    // the sibling count; a far edge's detour is longer than the near
    // one's, so the cap drops only the candidates the selection cannot
    // pick).
    const tsOf = (c1: number, c2: number, structureHorizontal: boolean): number[] => {
      const ts_ = [(c1 + c2) / 2, c2, c1, Math.min(c1, c2) - ORTHO_DETOUR_PX, Math.max(c1, c2) + ORTHO_DETOUR_PX];
      if (avoid) {
        ts_.push(...topKSpanEdges(structureHorizontal ? xEdges : yEdges, c1, c2, SINGLE_BEND_EDGE_CAP));
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
    // sealed corridor's only clear set). The shortest stands; the equal
    // length prefers the FEWER bends (the straighter route); the pool's
    // order breaks the remaining ties (deterministic).
    const pool: { points: RoutePoint[]; length: number; bends: number }[] = [];
    for (let i = 0; i < structures.length; i++) {
      const structure = structures[i];
      const ts = tsList[i];
      if (structure === undefined || ts === undefined) continue;
      for (const t of ts) {
        const candidate = routeOf(structure(t));
        if (avoid && hits(candidate)) continue;
        // The obstacle-free scene: the lengths stand equal (0) and the
        // pool's first entry (the default elbow) stands the pick.
        pool.push({ points: candidate, length: avoid ? routeLength(candidate) : 0, bends: routeBends(candidate) });
      }
    }
    if (avoid) {
      // The two-bend-line (U) candidates: both orientations (the exit
      // vertical / horizontal first), the corner's coords stand the span +
      // the NEAREST obstacle's detours (the bounded cap — the Cartesian
      // product over every edge stood the O(n^3) stand over the dense
      // surfaces).
      const xs = [
        Math.min(aOut.x, bIn.x) - ORTHO_DETOUR_PX,
        Math.max(aOut.x, bIn.x) + ORTHO_DETOUR_PX,
        ...topKSpanEdges(xEdges, aOut.x, bIn.x, U_EDGE_CAP),
      ];
      const ys = [
        Math.min(aOut.y, bIn.y) - ORTHO_DETOUR_PX,
        Math.max(aOut.y, bIn.y) + ORTHO_DETOUR_PX,
        ...topKSpanEdges(yEdges, aOut.y, bIn.y, U_EDGE_CAP),
      ];
      for (const y1 of ys) {
        for (const x1 of xs) {
          // F1: aOut -> (x1, aOut.y) -> (x1, y1) -> (bIn.x, y1) -> bIn
          // (the exit horizontal first).
          const f1 = routeOf([
            { x: x1, y: aOut.y },
            { x: x1, y: y1 },
            { x: bIn.x, y: y1 },
          ]);
          if (!hits(f1)) pool.push({ points: f1, length: routeLength(f1), bends: routeBends(f1) });
          // F2: aOut -> (aOut.x, y1) -> (x1, y1) -> (x1, bIn.y) -> bIn
          // (the exit vertical first).
          const f2 = routeOf([
            { x: aOut.x, y: y1 },
            { x: x1, y: y1 },
            { x: x1, y: bIn.y },
          ]);
          if (!hits(f2)) pool.push({ points: f2, length: routeLength(f2), bends: routeBends(f2) });
        }
      }
    }
    let points: RoutePoint[] | null = null;
    if (pool.length > 0) {
      let best = 0;
      for (let i = 1; i < pool.length; i++) {
        const candidate = pool[i]!;
        const current = pool[best]!;
        // The (length, bends) order: the shorter route stands; the equal
        // length prefers the FEWER bends (the straighter route). The bend
        // tiebreaker stands only over the obstacle scene (the avoid flag) —
        // the obstacle-free scene's equal lengths (0) keep the list order
        // (the default elbow byte-for-byte). The list order breaks the
        // remaining ties (stability).
        const fewerBends = avoid && candidate.length === current.length && candidate.bends < current.bends;
        if (candidate.length < current.length || fewerBends) best = i;
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
      // The seat stands on the polyline's longest run (the visible line —
      // not the stubs, not the endpoints' straight mid).
      mid: longestSegmentMid(deduped),
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
  // The seat stands on the curve's own midpoint (the bezier's t = 0.5) — the
  // endpoints' straight mid stands in the air off the bow (the label
  // sits on the curve, not on the chord).
  return {
    d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`,
    end: { x: b.x, y: b.y },
    mid: cubicMid(a, c1, c2, b),
  };
}

export { connectorPathPoints };
