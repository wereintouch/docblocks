/** The canvas hit resolver: the pointer's candidates over the world point,
 * computed from the geometry (never from the DOM's paint order — the DOM hit
 * is the z-order's stand, which cannot reach an object under another one).
 *
 * Two zone sets stand apart. The PRESS zones answer what a plain click
 * selects: a shape / a canvas-text by its box — a figure set to no fill (the
 * literal `none` / `transparent`) only by its outline's band, an invisible
 * figure (no fill and no stroke) by its whole box — a container / a frame by
 * the border's band (their interiors stay transparent to what lies beneath),
 * a connector by its stroke's band along the rendered route. An ABSENT fill
 * stands a normal figure (the box): only the explicitly transparent figure
 * passes the press through its interior. The STACK zones answer what the drill-down
 * cycles: the same shape / canvas-text zones, a container / a frame by the
 * whole box, the connector never (a direct grab of the line is its access).
 *
 * The tolerance is screen px (`HIT_TOL_PX / zoom`): a band's on-screen width
 * stands the same at any zoom. The stack's order is the paint order (the
 * surface's root order, then the children's order) with a member lifted
 * above every container that lists it (transitively — the containers are
 * lifted too); a mutual membership cannot loop the walk (the remaining
 * candidates stand their paint order).
 */
import type { Block, BlockId, Doc } from "docblocks-core";

import { connectorLineGeometryOf } from "../connector-line-geometry";
import type { Box } from "../geometry";
import { effectiveGeometry } from "../geometry";
import { distanceToPolyline, flattenPath, outlineDistanceOf } from "../shape-contour";
import type { CanvasSession } from "../viewport";
import { HIT_TOL_PX } from "./canvas-hit-config";

/** A canvas item under the point (the resolver's answer). */
interface HitCandidate {
  id: BlockId;
  surfaceId: BlockId;
  type: Block["type"];
  /** The block's effective box (the center-anchor geometry). */
  box: Box;
  /** The paint ordinal (the surface's order, then the children's order). */
  z: number;
}

/** The connector geometry's session stand (the resolver reads the committed
 * geometry — no in-flight preview stands over a press). */
const EMPTY_SESSION: CanvasSession = {
  movePreview: null,
  resizePreview: null,
  endpointDrag: null,
  endpointPreview: null,
};

/** Whether the point stands inside the box (the optional tolerance widens
 * the box's edges). */
function boxHolds(point: { x: number; y: number }, box: Box, tol = 0): boolean {
  return (
    point.x >= box.x - box.w / 2 - tol &&
    point.x <= box.x + box.w / 2 + tol &&
    point.y >= box.y - box.h / 2 - tol &&
    point.y <= box.y + box.h / 2 + tol
  );
}

/** Whether the point stands on the box's border band (the border's press
 * reach — the band straddles the edge by the tolerance). */
function onBorderBand(point: { x: number; y: number }, box: Box, tol: number): boolean {
  if (!boxHolds(point, box, tol)) return false;
  const left = box.x - box.w / 2;
  const right = box.x + box.w / 2;
  const top = box.y - box.h / 2;
  const bottom = box.y + box.h / 2;
  return (
    Math.abs(point.x - left) <= tol ||
    Math.abs(point.x - right) <= tol ||
    Math.abs(point.y - top) <= tol ||
    Math.abs(point.y - bottom) <= tol
  );
}

/** The explicit no-fill stand (the literal `none` / `transparent`): the
 * figure passes the press through its interior and stands its outline's band
 * only. An absent fill stands a normal figure (the whole box is its zone). */
function hasExplicitNoFill(block: Block): boolean {
  const fill = block.type === "shape" ? block.attrs?.fill : undefined;
  return fill === "none" || fill === "transparent";
}

/** The stroke's stand: the renderer's default stroke stands over an absent
 * attr; only an explicit `none` / `transparent` stands the stroke off. */
function hasVisibleStroke(block: Block): boolean {
  const stroke = block.type === "shape" ? block.attrs?.stroke : undefined;
  if (stroke === undefined) return true;
  return stroke !== "" && stroke !== "none" && stroke !== "transparent";
}

/**
 * The shape's press zone: the whole box over a filled or an unfilled-by-default
 * figure (an absent fill), over an invisible figure (no explicit fill and no
 * stroke — the box is its only handle), and over the zero opacity; the
 * figure's own outline band over the explicitly transparent figure.
 */
function shapePressHit(block: Block, box: Box, point: { x: number; y: number }, tol: number): boolean {
  const opacity = block.type === "shape" ? block.attrs?.opacity : undefined;
  if (opacity === 0) return boxHolds(point, box, tol);
  if (!hasExplicitNoFill(block)) return boxHolds(point, box);
  if (!hasVisibleStroke(block)) return boxHolds(point, box, tol);
  const local = { x: point.x - (box.x - box.w / 2), y: point.y - (box.y - box.h / 2) };
  const distance = outlineDistanceOf(block.type === "shape" ? block.attrs : undefined, { w: box.w, h: box.h }, local);
  // The unknown variant stands no outline: the box is the fallback.
  return distance === null ? boxHolds(point, box, tol) : distance <= tol;
}

/** The connector's press hit: the stroke's band along the rendered route
 * (the same path the line draws — the straight / orthogonal / curved
 * variants over the resolved endpoints, the label's inline edit's geometry
 * included). */
function connectorPressHit(
  connectorId: BlockId,
  block: Block,
  children: readonly BlockId[],
  blocks: Record<BlockId, Block>,
  point: { x: number; y: number },
  tol: number
): boolean {
  if (block.type !== "connector") return false;
  const geometry = connectorLineGeometryOf(connectorId, block, children, blocks, EMPTY_SESSION);
  if (geometry === null) return false;
  return distanceToPolyline(point, flattenPath(geometry.path)) <= tol;
}

/** The direct press's zone (what a plain click selects). */
function pressHitOf(block: Block, box: Box, point: { x: number; y: number }, tol: number): boolean {
  if (block.type === "group" || block.type === "frame") return onBorderBand(point, box, tol);
  if (block.type === "canvas-text") return boxHolds(point, box);
  if (block.type === "shape") return shapePressHit(block, box, point, tol);
  return false;
}

/** The stack's zone (what the drill-down cycles — the container / the frame
 * stand their whole box here; the interior's press stays theirs). */
function stackHitOf(block: Block, box: Box, point: { x: number; y: number }, tol: number): boolean {
  if (block.type === "group" || block.type === "frame") return boxHolds(point, box, tol);
  return pressHitOf(block, box, point, tol);
}

/** The surfaces' children in the paint order (the surface's root order, then
 * the children's order) — the base the resolver's passes share. */
function paintOrderOf(doc: Doc): { id: BlockId; surfaceId: BlockId; block: Block; children: BlockId[] }[] {
  const entries: { id: BlockId; surfaceId: BlockId; block: Block; children: BlockId[] }[] = [];
  for (const surfaceId of doc.getChildren(doc.meta.id)) {
    const surface = doc.getBlock(surfaceId);
    if (surface === null || surface.type !== "surface") continue;
    const children = doc.getChildren(surfaceId);
    for (const childId of children) {
      const block = doc.getBlock(childId);
      if (block === null) continue;
      entries.push({ id: childId, surfaceId, block, children });
    }
  }
  return entries;
}

/** The surface's children's block map (the connector's route resolution's
 * read — built lazily per surface, once). */
function blockMapOf(children: readonly BlockId[], doc: Doc): Record<BlockId, Block> {
  const map: Record<BlockId, Block> = {};
  for (const id of children) {
    const block = doc.getBlock(id);
    if (block !== null) map[id] = block;
  }
  return map;
}

/**
 * The cycle stack at the point (top → down): the shape / canvas-text / group
 * / frame candidates over the stack zones, ordered by the paint order with a
 * member lifted above every container that lists it (transitively, the
 * mutual membership's loop guarded).
 */
function hitStackAt(doc: Doc, point: { x: number; y: number }, zoom: number): HitCandidate[] {
  const tol = HIT_TOL_PX / zoom;
  const candidates: HitCandidate[] = [];
  let z = 0;
  for (const { id, surfaceId, block } of paintOrderOf(doc)) {
    z += 1;
    if (block.type === "connector") continue;
    const box = effectiveGeometry(block);
    if (!stackHitOf(block, box, point, tol)) continue;
    candidates.push({ id, surfaceId, type: block.type, box, z });
  }
  return promoteMembers(doc, candidates.reverse());
}

/**
 * The member lift: Kahn's ordering over the paint order (the highest painted
 * candidate first) with the edge member → container (every container that
 * lists the member). The remaining candidates over a mutual membership stand
 * their paint order.
 */
function promoteMembers(doc: Doc, ordered: HitCandidate[]): HitCandidate[] {
  const ids = new Set(ordered.map((candidate) => candidate.id));
  const containersOf = new Map<BlockId, BlockId[]>();
  const indegree = new Map<BlockId, number>();
  for (const candidate of ordered) indegree.set(candidate.id, 0);
  for (const candidate of ordered) {
    const block = doc.getBlock(candidate.id);
    if (block === null || block.type !== "group") continue;
    for (const memberId of block.attrs.members) {
      if (!ids.has(memberId)) continue;
      const list = containersOf.get(memberId) ?? [];
      list.push(candidate.id);
      containersOf.set(memberId, list);
      indegree.set(candidate.id, (indegree.get(candidate.id) ?? 0) + 1);
    }
  }
  const emitted = new Set<BlockId>();
  const result: HitCandidate[] = [];
  while (result.length < ordered.length) {
    const next = ordered.find((candidate) => !emitted.has(candidate.id) && (indegree.get(candidate.id) ?? 0) === 0);
    if (next === undefined) {
      // The mutual membership's loop: the rest stands its paint order.
      for (const candidate of ordered) {
        if (emitted.has(candidate.id)) continue;
        emitted.add(candidate.id);
        result.push(candidate);
      }
      break;
    }
    emitted.add(next.id);
    result.push(next);
    for (const containerId of containersOf.get(next.id) ?? []) {
      indegree.set(containerId, (indegree.get(containerId) ?? 0) - 1);
    }
  }
  return result;
}

/**
 * The plain press's target at the point: the top-most item from the paint
 * order whose PRESS zone holds the point (a connector stands among them by
 * its band). The container's and the frame's interiors stand no candidate
 * here — the press falls to what lies beneath them. `null`: nothing stands
 * (the page card's / the container's interior's / the marquee's branches
 * follow).
 */
function pressHitAt(doc: Doc, point: { x: number; y: number }, zoom: number): HitCandidate | null {
  const tol = HIT_TOL_PX / zoom;
  const maps = new Map<BlockId, Record<BlockId, Block>>();
  let best: HitCandidate | null = null;
  let z = 0;
  for (const { id, surfaceId, block, children } of paintOrderOf(doc)) {
    z += 1;
    const box = effectiveGeometry(block);
    let hit: boolean;
    if (block.type === "connector") {
      let map = maps.get(surfaceId);
      if (map === undefined) {
        map = blockMapOf(children, doc);
        maps.set(surfaceId, map);
      }
      hit = connectorPressHit(id, block, children, map, point, tol);
    } else {
      hit = pressHitOf(block, box, point, tol);
    }
    if (!hit) continue;
    if (best === null || z > best.z) best = { id, surfaceId, type: block.type, box, z };
  }
  return best;
}

export { boxHolds, hitStackAt, onBorderBand, pressHitAt, shapePressHit };
export type { HitCandidate };
