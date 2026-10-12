import type { BlockId } from "docblocks-core";

/**
 * The pre-move target index for the block dragged across the root order,
 * or null when no command should be issued.
 *
 * `oldIds` is the current (pre-move) root order and `newIds` the order
 * after the drag (only the dragged block moves between the two). The
 * result follows `moveBlock`'s pre-move index semantics (the same math as
 * the mod+shift+arrow gesture): a final slot before the dragged block's
 * old slot is the slot itself, a final slot after it is the slot plus one
 * (the removal shifts the target left). Null when the order is unchanged
 * (a drag back to the own position) or the two orders describe different
 * block sets (a stale mid-drag order after a remote update — the drag is
 * dropped).
 */
function moveTargetForReorder(oldIds: BlockId[], newIds: BlockId[], draggedId: BlockId): number | null {
  if (oldIds.length !== newIds.length) return null;
  const known = new Set(oldIds);
  if (!newIds.every((id) => known.has(id))) return null;
  const from = oldIds.indexOf(draggedId);
  const at = newIds.indexOf(draggedId);
  if (from === -1 || at === -1 || from === at) return null;
  return at > from ? at + 1 : at;
}

/**
 * The post-move parent order for a list item dropped into a slot of its
 * own list run, or null when the drop is a no-op (the item lands in its
 * own slot) or the order is stale (a remote update changed the children
 * mid-drag — the drop is rejected).
 *
 * `anchorId` is the sibling the slot belongs to: with side "before" it is
 * the item BELOW the slot, with "after" the item ABOVE it; null is the slot
 * before the run's first item or after its last. The result is a
 * permutation of `oldIds` (the dragged item moved, nothing else) that
 * feeds `moveTargetForReorder`.
 */
function finalOrderAfterSlotDrop(
  oldIds: BlockId[],
  draggedId: BlockId,
  anchorId: BlockId | null,
  side: "before" | "after"
): BlockId[] | null {
  const from = oldIds.indexOf(draggedId);
  if (from === -1) return null;
  if (anchorId !== null && !oldIds.includes(anchorId)) return null;
  const rest = oldIds.filter((id) => id !== draggedId);
  const pos =
    anchorId === null
      ? side === "before"
        ? 0
        : rest.length
      : side === "before"
        ? rest.indexOf(anchorId)
        : rest.indexOf(anchorId) + 1;
  if (pos === -1) return null;
  const next = [...rest];
  next.splice(pos, 0, draggedId);
  return next.every((id, i) => oldIds[i] === id) ? null : next;
}

/**
 * The pre-move target index for a list item dropped into ANOTHER parent's
 * children (a cross-level drop): `oldIds` is the target parent's current
 * children and must not contain the dragged item (a within-parent drop
 * goes through `finalOrderAfterSlotDrop` instead). The result is the
 * index the item takes in the target order — or null for a stale anchor
 * (a remote update moved or removed it mid-drag) or a same-parent drop
 * (the wrong caller path).
 */
function crossParentTargetIndex(
  oldIds: BlockId[],
  draggedId: BlockId,
  anchorId: BlockId,
  side: "before" | "after"
): number | null {
  if (oldIds.includes(draggedId)) return null;
  const anchorIndex = oldIds.indexOf(anchorId);
  if (anchorIndex === -1) return null;
  return side === "before" ? anchorIndex : anchorIndex + 1;
}

export { crossParentTargetIndex, finalOrderAfterSlotDrop, moveTargetForReorder };
