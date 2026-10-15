/**
 * The flat-row drag commit (the motion view, pure framer Reorder over the
 * flat page sequence).
 *
 * The drag is framer's own reorder (the row's dragControls, the local
 * order state, the live reorder); the release commits it. The visible rows
 * are the entry root's SCOPE in its sequence container: for a
 * sequence-container entry root (the document root — the common case) the
 * container's full sequence; for a page-block entry root (a subtree
 * provider, e.g. a sync-embed subtree) the entry root's derived segment
 * within the container's sequence — a vertical drag keeps every indent, so
 * the segment membership is invariant during the drag and the final
 * VISIBLE order (the local order at release — the collapsed segments are
 * unmounted, so they do not participate) is a permutation of the segment's
 * blocks. The visible order is mapped back to the scope (a collapsed
 * item's hidden segment rows reinsert after their collapsed item), and the
 * commit is the range move of the dragged block's derived subtree within
 * the CONTAINER's sequence (a range operation on one array, the scope's
 * indices translated by the scope's offset): one transact, one undo step,
 * one wire update. A no-op drop (the segment landed at its own position)
 * and a stale drop (a remote update changed the scope mid-drag — the
 * derived final order is not the current scope with the segment moved)
 * issue no command; so does a landing the core rejects with its typed
 * indent-jump violation (the move is the stale drop's posture: no command,
 * the order resyncs to the store).
 */
import type { BlockId, Doc } from "docblocks-core";

import { entrySequenceParent } from "../blocks/flat";
import { moveSegmentInSequence, segmentRange } from "../editing/block-commands";

/** Same ids in the same order (order matters). */
function sameIds(a: readonly BlockId[], b: readonly BlockId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** The block's effective indent (absent is 0). */
function indentOf(doc: Doc, id: BlockId): number {
  const block = doc.getBlock(id);
  if (block === null || !("attrs" in block)) return 0;
  const indent = (block.attrs as { indent?: unknown } | undefined)?.indent;
  return typeof indent === "number" && Number.isInteger(indent) && indent >= 0 ? indent : 0;
}

/**
 * A collapsed list item's hidden segment rows (in scope order): the
 * contiguous stretch after the item with `indent` deeper than the item's
 * own, up to the first block with `indent` <= the item's (the segment
 * minus the item itself). Absent when the item is not in the scope. The
 * scope is a superset of the item's segment (its followers are deeper than
 * the item, hence inside the scope), so the scoped scan equals the
 * full-sequence one.
 */
function hiddenSegmentRows(doc: Doc, sequence: readonly BlockId[], itemId: BlockId): BlockId[] {
  const start = sequence.indexOf(itemId);
  if (start === -1) return [];
  const indent = indentOf(doc, itemId);
  const rows: BlockId[] = [];
  for (let i = start + 1; i < sequence.length; i += 1) {
    const id = sequence[i];
    if (id === undefined) break;
    if (indentOf(doc, id) <= indent) break;
    rows.push(id);
  }
  return rows;
}

/**
 * The commit of a flat-row drag (the scope and the visible-order mapping:
 * the module header). `contextId` is the provider's entry root: the commit
 * resolves its sequence container and runs over its SCOPE — the full
 * sequence for a sequence-container entry root, the entry root's derived
 * segment (in the container's sequence) for a page-block one — and issues
 * the range move of the dragged block's derived subtree within the
 * CONTAINER's sequence (the scope's indices translated by the scope's
 * offset — the scope's membership stands, so a valid permutation of the
 * scope always commits: the segment's internal adjacencies and the
 * boundary neighbors are unchanged, and the indent-jump rule holds).
 *
 * Returns true when the drag landed (a command issued or a no-op — the
 * local order already matches the store); false when the commit was
 * dropped (stale — the caller resyncs the local order to the store).
 */
function commitFlatDrag(
  doc: Doc,
  contextId: BlockId,
  draggedId: BlockId,
  visibleFinalOrder: readonly BlockId[],
  collapsedIds: readonly BlockId[]
): boolean {
  // The entry root's sequence container (the container itself when the
  // entry root is one — the document root, the common case), and the
  // VISIBLE rows' scope: the container's full sequence, or the entry
  // root's derived segment within it (a vertical drag keeps every indent,
  // so the segment membership is invariant — the visible final order is a
  // permutation of the segment's blocks).
  const containerId = entrySequenceParent(doc, contextId);
  const containerSequence = doc.getChildren(containerId);
  let scopeOffset = 0;
  let sequence = containerSequence;
  if (containerId !== contextId) {
    const entry = segmentRange(doc, containerId, contextId);
    if (entry === null) return false; // the entry root vanished mid-drag
    scopeOffset = entry.start;
    sequence = containerSequence.slice(entry.start, entry.end);
  }

  const start = sequence.indexOf(draggedId);
  if (start === -1) return false; // the block vanished mid-drag
  const segment = segmentRange(doc, containerId, draggedId);
  if (segment === null) return false;
  // The dragged segment lies wholly inside the scope (its followers are
  // deeper than the dragged block, hence inside the entry root's segment)
  // — its range relative to the scope.
  if (segment.start < scopeOffset || segment.end > scopeOffset + sequence.length) return false; // stale
  const segmentLength = segment.end - segment.start;

  // The dragged segment's other rows (visible or hidden — the drag moves
  // them as a unit, so they reinsert contiguously after the dragged item
  // in data order, wherever the visible order left the visible ones).
  const segmentRows = sequence.slice(start, start + segmentLength);
  const segmentOthers = segmentRows.filter((id) => id !== draggedId);
  const segmentOthersSet = new Set(segmentOthers);

  // The hidden rows of the OTHER collapsed items (a collapsed item is
  // itself visible — only its segment rows are unmounted); the dragged
  // item's hidden rows stand in segmentOthers.
  const collapsed = new Set(collapsedIds);
  const hiddenByItem = new Map<BlockId, BlockId[]>();
  for (const id of sequence) {
    if (id === draggedId) continue;
    const block = doc.getBlock(id);
    if (block === null || block.type !== "list-item") continue;
    if (!collapsed.has(id)) continue;
    const rows = hiddenSegmentRows(doc, sequence, id);
    if (rows.length > 0) hiddenByItem.set(id, rows);
  }

  const finalFull: BlockId[] = [];
  for (const id of visibleFinalOrder) {
    if (segmentOthersSet.has(id)) continue;
    finalFull.push(id);
    if (id === draggedId) finalFull.push(...segmentOthers);
    else {
      const hidden = hiddenByItem.get(id);
      if (hidden !== undefined) finalFull.push(...hidden);
    }
  }
  if (finalFull.length !== sequence.length) return false; // stale: the visible set changed mid-drag

  const target = finalFull.indexOf(draggedId);
  if (target === start) return true; // a no-op drop: the segment stood in place, the order matches

  // The final must be exactly the scope with the segment moved: the
  // segment's internal order stands and the rest stands in order.
  const segmentNow = sequence.slice(start, start + segmentLength);
  const segmentFinal = finalFull.slice(target, target + segmentLength);
  if (!segmentNow.every((id, i) => id === segmentFinal[i])) return false; // stale
  const restNow = [...sequence.slice(0, start), ...sequence.slice(start + segmentLength)];
  const restFinal = [...finalFull.slice(0, target), ...finalFull.slice(target + segmentLength)];
  if (!sameIds(restNow, restFinal)) return false; // stale: a remote reorder mid-drag

  // The core's pre-move index of the item the segment's head precedes, in
  // the CONTAINER's sequence (the scope-relative index translated by the
  // scope's offset): up — that item's index stands (target); down — the
  // head precedes scope[target + length] (the segment's own trailing
  // edge), and the move to the scope's end maps onto the container's own
  // trailing edge (target + length there). A landing the core rejects (its
  // typed indent-jump violation) rolls the transact back — the commit
  // drops like a stale drop (the caller resyncs the local order to the
  // store).
  const t = target < start ? target : target + segmentLength;
  return moveSegmentInSequence(doc, containerId, scopeOffset + start, segmentLength, scopeOffset + t);
}

export { commitFlatDrag, sameIds };
