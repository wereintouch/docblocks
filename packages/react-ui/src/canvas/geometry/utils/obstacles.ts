/**
 * The connector route-avoidance's obstacle index: the uniform spatial grid
 * over the obstacle boxes (the per-segment hit test over the boxes the
 * segment's cells hold, not the whole set) + the candidate pool's bounded
 * coordinate selection (the obstacle edges NEAREST the route's span — the
 * far edges stand no detour: a far corner's route is longer than the near
 * one's, so the cap keeps every route the selection could pick while the
 * pool stays bounded over the sibling count — the Cartesian-product U pool
 * stood the O(n^3) stand over the dense surfaces).
 */
import { ROUTE_EPS } from "../constants";
import type { Box, RoutePoint } from "../models";

/** The grid's cell size (world px): the boxes are canvas figures (tens to
 * hundreds of px), so the cell holds the boxes it overlaps (a box larger
 * than two cells stands the direct test, never the grid). */
const GRID_CELL_PX = 256;
/** The box's max dimension over which it leaves the grid (the direct test). */
const GRID_LARGE_PX = 512;
/** The obstacle count under which the direct scan stands (the grid's build
 * cost is not worth it over the small sets). */
export const OBSTACLE_GRID_MIN = 48;

/**
 * The per-segment interior crossing (the boundary stands clear — a route
 * along the edge is not a crossing; the 0.5-px tolerance keeps a route
 * hugging the edge from standing as clear).
 */
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

/**
 * The obstacle's spatial grid: the box's inset interior (the 0.5-px
 * boundary's clear stand) over its covered cells, the oversized boxes
 * (the max dimension over two cells) in the direct list. The query walks
 * the axis-aligned segment's cells — a hit stands only over the boxes the
 * segment's cells hold (plus the direct list), so the per-segment cost is
 * the local density, not the set's size.
 */
interface ObstacleGrid {
  /** The cell's box list (the cell key: the column + row). */
  cells: Map<string, Box[]>;
  /** The oversized boxes (the direct test over every segment). */
  large: Box[];
}

function buildObstacleGrid(boxes: readonly Box[]): ObstacleGrid {
  const cells = new Map<string, Box[]>();
  const large: Box[] = [];
  const cell = GRID_CELL_PX;
  for (const r of boxes) {
    if (r.w <= 0 || r.h <= 0) continue;
    if (r.w > GRID_LARGE_PX || r.h > GRID_LARGE_PX) {
      large.push(r);
      continue;
    }
    // The inset interior (the boundary's clear stand — the segment's hit
    // predicate tests the same inset, so the grid holds exactly the boxes
    // the predicate could hit).
    const left = r.x - r.w / 2 + ROUTE_EPS;
    const right = r.x + r.w / 2 - ROUTE_EPS;
    const top = r.y - r.h / 2 + ROUTE_EPS;
    const bottom = r.y + r.h / 2 - ROUTE_EPS;
    if (right <= left || bottom <= top) continue;
    const colFrom = Math.floor(left / cell);
    const colTo = Math.floor((right - 1e-9) / cell);
    const rowFrom = Math.floor(top / cell);
    const rowTo = Math.floor((bottom - 1e-9) / cell);
    for (let cy = rowFrom; cy <= rowTo; cy++) {
      for (let cx = colFrom; cx <= colTo; cx++) {
        const key = `${cx},${cy}`;
        const list = cells.get(key);
        if (list === undefined) cells.set(key, [r]);
        else list.push(r);
      }
    }
  }
  return { cells, large };
}

/** The segment's cells (the axis-aligned walk): the boxes the segment
 * could cross, tested over the direct list first (the few oversized boxes). */
function segmentHitsGrid(grid: ObstacleGrid, x1: number, y1: number, x2: number, y2: number): boolean {
  for (const r of grid.large) {
    if (segmentHitsRect(x1, y1, x2, y2, r)) return true;
  }
  const cell = GRID_CELL_PX;
  if (Math.abs(x1 - x2) < 1e-9) {
    const col = Math.floor(x1 / cell);
    const yLo = Math.min(y1, y2);
    const yHi = Math.max(y1, y2);
    for (let row = Math.floor(yLo / cell); row <= Math.floor(yHi / cell); row++) {
      const list = grid.cells.get(`${col},${row}`);
      if (list === undefined) continue;
      for (const r of list) {
        if (segmentHitsRect(x1, y1, x2, y2, r)) return true;
      }
    }
    return false;
  }
  const row = Math.floor(y1 / cell);
  const xLo = Math.min(x1, x2);
  const xHi = Math.max(x1, x2);
  for (let col = Math.floor(xLo / cell); col <= Math.floor(xHi / cell); col++) {
    const list = grid.cells.get(`${col},${row}`);
    if (list === undefined) continue;
    for (const r of list) {
      if (segmentHitsRect(x1, y1, x2, y2, r)) return true;
    }
  }
  return false;
}

/** Whether the route (the axis-aligned consecutive segments) crosses any
 * obstacle's interior, over the spatial grid (the small set's direct stand
 * stays in the route math — the grid's build is not worth it there). */
function routeHitsGrid(points: readonly RoutePoint[], grid: ObstacleGrid): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    if (p === undefined || q === undefined) continue;
    if (segmentHitsGrid(grid, p.x, p.y, q.x, q.y)) return true;
  }
  return false;
}

/**
 * The pool's bounded coordinate selection: the NEAREST `cap` of the given
 * edge coords (distance to the [lo, hi] span's interval, the tie the input
 * order). The full set stands byte-for-byte when it fits the cap (the small
 * scene's candidate order keeps the former's stand — the unit's pins); the
 * capped stand orders by (distance, input order) — the near detours first,
 * the deterministic input order breaking the equal-distance ties.
 */
function topKSpanEdges(edges: readonly number[], lo: number, hi: number, cap: number): number[] {
  const spanLo = Math.min(lo, hi);
  const spanHi = Math.max(lo, hi);
  // The small set: the former's stand (the input order, the duplicates kept
  // — the duplicate candidate stands no new route, only the pool's order).
  if (edges.length <= cap) return [...edges];
  const distOf = (v: number): number =>
    v >= spanLo && v <= spanHi ? 0 : Math.min(Math.abs(v - spanLo), Math.abs(v - spanHi));
  // The top-`cap` by (distance, input index): one pass, the running list's
  // (distance, index) order (no full sort — the selection's only need).
  const picked: { d: number; idx: number; v: number }[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < edges.length; i++) {
    const v = edges[i]!;
    if (seen.has(v)) continue;
    seen.add(v);
    const d = distOf(v);
    let insertAt = -1;
    for (let k = 0; k < picked.length; k++) {
      const cur = picked[k]!;
      if (d < cur.d || (d === cur.d && i < cur.idx)) {
        insertAt = k;
        break;
      }
    }
    if (insertAt === -1 && picked.length < cap) insertAt = picked.length;
    if (insertAt === -1) continue;
    picked.splice(insertAt, 0, { d, idx: i, v });
    if (picked.length > cap) picked.pop();
  }
  return picked.map((p) => p.v);
}

export { buildObstacleGrid, routeHitsGrid, segmentHitsRect, topKSpanEdges };
export type { ObstacleGrid };
