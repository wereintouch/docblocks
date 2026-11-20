/**
 * The canvas z-order command: setZOrder. The canvas elements (shape /
 * connector / canvas-text / group / frame) of a surface carry an explicit
 * `zIndex` (dense 1..N, the children order's mirror — 1 = bottom). This
 * command reorders the surface's canvas elements (forward / back / to
 * front / to back) and rewrites the `zIndex` (dense, in the new order) in
 * one transaction — one undo step, one wire update.
 *
 * The page blocks on the canvas (if any) do not carry a `zIndex`; they keep
 * their children-array position (the z-order is the children order).
 */
import * as Y from "yjs";

import { CANVAS_ZORDER_TYPES } from "@docblocks-core/schema";
import type { BlockId } from "@docblocks-core/schema";

import { InvalidOperationError, UnknownBlockError } from "../errors";
import { localTransact } from "../layout";
import { blockTypeOf, childrenOf, findParent, getBlockMap } from "./structure";

/** The z-order action: a step up / down, or to the top / bottom. */
type ZOrderAction = "forward" | "back" | "toFront" | "toBack";

/**
 * The dense z-order position (1..N, 1 = bottom) of a canvas element among
 * its surface's canvas elements, derived from the (converged) children
 * order — the single source of the z-order. The stored `zIndex` attr is a
 * mirror that can be stale after a concurrent merge (each peer wrote its
 * own local position); the read path derives the index so the snapshot
 * always reflects the true order and stays valid. A phantom (the id in the
 * array but owned by another container) does not count. Null when the block
 * is not a canvas element of a surface.
 */
function derivedZIndex(ydoc: Y.Doc, id: string): number | null {
  const type = blockTypeOf(ydoc, id);
  if (type === null || !CANVAS_ZORDER_TYPES.has(type)) return null;
  const surfaceId = findParent(ydoc, id);
  if (surfaceId === null || blockTypeOf(ydoc, surfaceId) !== "surface") return null;
  const cache = surfaceZCacheOf(ydoc);
  let positions = cache.surfaces.get(surfaceId);
  if (positions === undefined) {
    positions = deriveSurfaceZIndex(ydoc, surfaceId);
    cache.surfaces.set(surfaceId, positions);
  }
  return positions.get(id) ?? null;
}

/** The per-surface z-order derivation's cache (the doc's transaction's
 * stand): the dense position's map over the surface's canvas elements,
 * derived once per surface per transaction (the per-block's fresh walk
 * over the surface's whole children stood the bulk read's quadratic
 * stand). The `beforeTransaction`'s clear (local or remote) is the
 * invalidation — a mid-transaction read stands the fresh walk over the
 * in-flight order, the legacy's parity. */
interface SurfaceZCache {
  surfaces: Map<BlockId, Map<BlockId, number>>;
}

const surfaceZCaches = new WeakMap<Y.Doc, SurfaceZCache>();

function surfaceZCacheOf(ydoc: Y.Doc): SurfaceZCache {
  let cache = surfaceZCaches.get(ydoc);
  if (cache === undefined) {
    const fresh: SurfaceZCache = { surfaces: new Map() };
    // The yjs 13.6's on() returns the handler (not the unbind): the clear
    // stands the cache's invalidation over every transaction's start (the
    // convergence's stand — the walk stands the current's order, never the
    // stale's mirror).
    const handler = (): void => {
      fresh.surfaces.clear();
    };
    ydoc.on("beforeTransaction", handler);
    cache = fresh;
    surfaceZCaches.set(ydoc, cache);
  }
  return cache;
}

/** The surface's dense positions over its canvas elements (the legacy's
 * no-stored-`zIndex` stand: the empty map — the read's null over the
 * whole surface). The phantom / the duplicate's stands stand over the
 * walk (the lenient reader's parity). */
function deriveSurfaceZIndex(ydoc: Y.Doc, surfaceId: BlockId): Map<BlockId, number> {
  const children = childrenOf(ydoc, surfaceId);
  const positions = new Map<BlockId, number>();
  if (children === null) return positions;
  const seen = new Set<string>();
  let pos = 0;
  let anyStored = false;
  for (const childId of children.toArray()) {
    if (seen.has(childId)) continue; // a duplicate (concurrent reorder residue)
    seen.add(childId);
    const childType = blockTypeOf(ydoc, childId);
    if (childType === null || !CANVAS_ZORDER_TYPES.has(childType)) continue;
    if (findParent(ydoc, childId) !== surfaceId) continue; // a phantom (owned elsewhere)
    const childBlock = getBlockMap(ydoc, childId);
    const attrs = childBlock !== null ? childBlock.get("attrs") : null;
    if (attrs instanceof Y.Map && typeof attrs.get("zIndex") === "number") anyStored = true;
    pos += 1;
    positions.set(childId, pos);
  }
  if (!anyStored) positions.clear();
  return positions;
}

/** Sets the block's `zIndex` attr (the `attrs` map is created when
 * absent). The unchanged value stands no write (the yjs's set allocates a
 * new item over the equal value — the per-command refresh's rewrite of
 * the unchanged siblings stood the bulk insert's quadratic stand). */
function writeZIndexAttr(ydoc: Y.Doc, block: Y.Map<unknown>, zIndex: number): void {
  const attrs = block.get("attrs");
  if (attrs instanceof Y.Map) {
    if (attrs.get("zIndex") === zIndex) return;
  }
  const attrsMap: Y.Map<unknown> = attrs instanceof Y.Map ? attrs : new Y.Map<unknown>();
  if (!(attrs instanceof Y.Map)) block.set("attrs", attrsMap);
  attrsMap.set("zIndex", zIndex);
}

/**
 * Reorders a surface's canvas elements by the z-order action and rewrites
 * the `zIndex` (dense 1..N, in the new order). The action is applied over
 * the canvas elements' relative order (the page blocks keep their position);
 * a step at the top / bottom edge and a to-front / to-back at the edge are
 * no-ops (nothing is written).
 */
function setZOrder(ydoc: Y.Doc, targetId: string, action: ZOrderAction): void {
  const type = blockTypeOf(ydoc, targetId);
  if (type === null) throw new UnknownBlockError(`Unknown block "${targetId}".`);
  if (!CANVAS_ZORDER_TYPES.has(type)) {
    throw new InvalidOperationError(`Block "${targetId}" (type "${type}") is not a canvas element (no z-order).`);
  }
  const surfaceId = findParent(ydoc, targetId);
  if (surfaceId === null || blockTypeOf(ydoc, surfaceId) !== "surface") {
    throw new InvalidOperationError(`Block "${targetId}" is not a child of a surface.`);
  }
  const children = childrenOf(ydoc, surfaceId);
  if (children === null) throw new InvalidOperationError(`Surface "${surfaceId}" has no children.`);

  const order = children.toArray();
  // The canvas elements' relative order (the page blocks keep their position).
  const canvasOrder = order.filter((id) => {
    const childType = blockTypeOf(ydoc, id);
    return childType !== null && CANVAS_ZORDER_TYPES.has(childType);
  });
  const targetPos = canvasOrder.indexOf(targetId);
  if (targetPos === -1) throw new UnknownBlockError(`Block "${targetId}" is not in surface "${surfaceId}".`);
  const count = canvasOrder.length;

  // The new canvas elements' order, by action. A step at the edge is a no-op.
  const newCanvasOrder = [...canvasOrder];
  switch (action) {
    case "forward": {
      if (targetPos === count - 1) return; // already at the top
      newCanvasOrder.splice(targetPos, 1);
      newCanvasOrder.splice(targetPos + 1, 0, targetId);
      break;
    }
    case "back": {
      if (targetPos === 0) return; // already at the bottom
      newCanvasOrder.splice(targetPos, 1);
      newCanvasOrder.splice(targetPos - 1, 0, targetId);
      break;
    }
    case "toFront": {
      if (targetPos === count - 1) return; // already at the top
      newCanvasOrder.splice(targetPos, 1);
      newCanvasOrder.push(targetId);
      break;
    }
    case "toBack": {
      if (targetPos === 0) return; // already at the bottom
      newCanvasOrder.splice(targetPos, 1);
      newCanvasOrder.unshift(targetId);
      break;
    }
  }

  // Reconstruct the children order: the canvas elements in the new order, the
  // page blocks keep their position (the canvas elements take the slots the
  // canvas elements occupied, in the new order).
  let cursor = 0;
  const newOrder: string[] = [];
  for (const id of order) {
    const childType = blockTypeOf(ydoc, id);
    const next = newCanvasOrder[cursor];
    if (childType !== null && CANVAS_ZORDER_TYPES.has(childType)) {
      if (next !== undefined) newOrder.push(next);
      cursor += 1;
    } else {
      newOrder.push(id);
    }
  }

  localTransact(ydoc, () => {
    // The children array is the storage: rewrite it to the new order.
    children.delete(0, children.length);
    children.insert(0, newOrder);
    // The zIndex is the dense position among the canvas elements (the mirror).
    const canvasBlocks = newCanvasOrder.map((id) => getBlockMap(ydoc, id));
    canvasBlocks.forEach((block, i) => {
      if (block !== null) writeZIndexAttr(ydoc, block, i + 1);
    });
  });
}

/**
 * Rewrites the dense `zIndex` of a surface's canvas elements (1..N, in the
 * children order) — the order's mirror. Used after a reorder (setZOrder,
 * moveBlock) to keep the index dense and consistent with the order.
 */
function refreshSurfaceZIndex(ydoc: Y.Doc, surfaceId: string): void {
  const children = childrenOf(ydoc, surfaceId);
  if (children === null) return;
  let pos = 0;
  for (const childId of children.toArray()) {
    const childType = blockTypeOf(ydoc, childId);
    if (childType !== null && CANVAS_ZORDER_TYPES.has(childType)) {
      pos += 1;
      const block = getBlockMap(ydoc, childId);
      if (block !== null) writeZIndexAttr(ydoc, block, pos);
    }
  }
}

export { CANVAS_ZORDER_TYPES, derivedZIndex, refreshSurfaceZIndex, setZOrder, writeZIndexAttr };
export type { ZOrderAction };
