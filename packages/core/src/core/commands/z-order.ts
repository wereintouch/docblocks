/**
 * The canvas z-order command: setZOrder. The canvas elements (shape /
 * connector / canvas-text / group) of a surface carry an explicit `zIndex`
 * (dense 1..N, the children order's mirror — 1 = bottom). This command
 * reorders the surface's canvas elements (forward / back / to front / to
 * back) and rewrites the `zIndex` (dense, in the new order) in one
 * transaction — one undo step, one wire update.
 *
 * The page blocks on the canvas (if any) do not carry a `zIndex`; they keep
 * their children-array position (the z-order is the children order).
 */
import * as Y from "yjs";

import { InvalidOperationError, UnknownBlockError } from "../errors";
import { localTransact } from "../layout";
import { blockTypeOf, childrenOf, findParent, getBlockMap } from "./structure";

/** The z-order action: a step up / down, or to the top / bottom. */
type ZOrderAction = "forward" | "back" | "toFront" | "toBack";

/** The canvas element types that carry the explicit z-order `zIndex`. */
export const CANVAS_ZORDER_TYPES: ReadonlySet<string> = new Set(["shape", "connector", "canvas-text", "group"]);

/** Sets the block's `zIndex` attr (the `attrs` map is created when absent). */
function writeZIndexAttr(ydoc: Y.Doc, block: Y.Map<unknown>, zIndex: number): void {
  const attrs = block.get("attrs");
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

export { refreshSurfaceZIndex, setZOrder, writeZIndexAttr };
export type { ZOrderAction };
