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

export { moveTargetForReorder };
