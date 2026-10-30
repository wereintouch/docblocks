/** The flat-row drag commit (the motion view, pure framer Reorder over the
 * flat page sequence).
 *
 * The drag is framer's own reorder (the row's dragControls, the local
 * order state, the live reorder); the release commits it. The visible rows
 * are the entry root's SCOPE in its sequence container: for a
 * sequence-container entry root (the document root — the common case) the
 * container's full sequence; for a page-block entry root (a subtree
 * provider, e.g. a sync-embed subtree) the entry root's derived segment
 * within the container's sequence — the final VISIBLE order (the local
 * order at release — the collapsed segments are unmounted, so they do not
 * participate) is a permutation of the segment's blocks. The visible
 * order is mapped back to the scope (a collapsed item's hidden segment
 * rows reinsert after their collapsed item), and the commit is the range
 * move of the dragged block's derived subtree within the CONTAINER's
 * sequence (a range operation on one array, the scope's indices translated
 * by the scope's offset) plus the seam's indent assignment (below): one
 * transact, one undo step, one wire update. A no-op drop (the segment
 * landed at its own position) and a stale drop (a remote update changed
 * the scope mid-drag — the derived final order is not the current scope
 * with the segment moved) issue no command; so does a landing the core
 * rejects with its typed indent-jump violation (the move is the stale
 * drop's posture: no command, the order resyncs to the store).
 *
 * The seam's indent (the drop's two-variant rule): a drop at the seam
 * between the row A (the block before the landed span) and the row B (the
 * block after it) stands the segment's head at the seam's candidate
 * indent — the row the pointer stands over (its upper or lower half is
 * the same seam's side: the head lands before B at B's level, or after A
 * at A's level); in the gap between A and B the pointer's half decides
 * (the upper half stands the head before B — B's indent — the lower half
 * after A — A's indent); at the sequence's start the only candidate is
 * the first block's indent, at the end the last block's. The block's own
 * current indent is NOT a candidate for a real move (a no-op drop keeps
 * it — the position stands). The head's derived segment shifts by the
 * delta (candidate minus the head's current indent) uniformly, so the
 * segment's relative structure stands. */
import type { BlockId, Doc } from "docblocks-core";
import { BLOCK_REGISTRY, InvalidAttrsError, InvalidOperationError } from "docblocks-core";

import { entrySequenceParent } from "../../blocks";
import { ensureTrailingParagraph, moveSegmentInSequence, segmentRange } from "../../editing/block-commands";

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
 * boundary neighbors are unchanged, and the indent-jump rule holds) plus
 * the seam's indent assignment (the `candidateIndent`, the module
 * header's seam rule).
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
  collapsedIds: readonly BlockId[],
  candidateIndent: number
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
  // trailing edge (target + length there).
  let t = target < start ? target : target + segmentLength;
  // The document root's tail seat (the full-doc tail contract): a down
  // landing at the sequence's end stands a non-text last block when the
  // segment's own last block is non-text (a text-terminated segment lands
  // its text tail last — the invariant stands, the end landing is clean).
  // In the non-text case the move's own tail guarantee would stand a NEW
  // paragraph behind the segment and the existing trailing block would
  // stand stranded above the drag (an extra row appears on release and
  // the block stands above where it was released). The seat stands last:
  // the segment lands just before the trailing top-level text block (the
  // pre-move index of that block — the head precedes it); the trailing
  // block stays last, so the guarantee is a no-op — no stand, no jump.
  // A nested trailing block (indent > 0) stands no seat: landing before
  // it would re-attach it to the childless non-text segment, so the end
  // landing (with its own guaranteed paragraph) stands there.
  if (target >= start && containerId === doc.meta.id && scopeOffset === 0 && t === sequence.length) {
    const segmentLast = segmentRows[segmentRows.length - 1];
    const segmentLastBlock = segmentLast === undefined ? null : doc.getBlock(segmentLast);
    const trailingId = containerSequence[containerSequence.length - 1];
    const trailingBlock = trailingId === undefined ? null : doc.getBlock(trailingId);
    if (
      segmentLastBlock !== null &&
      trailingId !== undefined &&
      trailingBlock !== null &&
      trailingId !== segmentLast &&
      !BLOCK_REGISTRY[segmentLastBlock.type].content &&
      BLOCK_REGISTRY[trailingBlock.type].content &&
      indentOf(doc, trailingId) === 0
    )
      t -= 1;
  }

  // The seam's candidate (the module header): the head stands at the
  // seam's neighbor's indent — the block before the landed span (A) or
  // the block after it (B). The block's own indent is the no-op drop's
  // only (the early return above), so a candidate that matches neither
  // neighbor is a stale measurement (a mid-slide box) — the stale drop's
  // posture: no command, the caller resyncs.
  const before = target > 0 ? finalFull[target - 1] : undefined;
  const after = finalFull[target + segmentLength];
  const matchesSeam =
    (before !== undefined && candidateIndent === indentOf(doc, before)) ||
    (after !== undefined && candidateIndent === indentOf(doc, after));
  if (!matchesSeam) return false;

  const headIndent = indentOf(doc, draggedId);
  const delta = candidateIndent - headIndent;
  const followers = segmentOthers.map((id) => ({ id, indent: indentOf(doc, id) + delta }));

  if (delta === 0) {
    // The pure move (the segment's indents stand): the pre-existing
    // head-first composition (its per-step landing checks read the
    // final predecessors, so a valid final state commits every step).
    return moveSegmentInSequence(doc, containerId, scopeOffset + start, segmentLength, scopeOffset + t);
  }

  // The move plus the head's and the followers' indent updates — one
  // transact (one undo step, one wire update). The steps' order keeps
  // every intermediate state jump-rule-valid (the final state is valid
  // by the seam rule, and the path exists in both directions):
  // deepening (delta > 0) — the move first (the head's shallower old
  // indent lands validly at the new predecessor), then the indents;
  // shallowing (delta < 0) — the indents first (a shallower value at the
  // block's own position is always valid), then the move. The follower
  // updates ride the head's check (each follower stands one deeper than
  // its predecessor, and the uniform delta keeps the difference).
  const applyIndents = (): void => {
    doc.updateBlock(draggedId, { indent: candidateIndent });
    for (const follower of followers) doc.updateBlock(follower.id, { indent: follower.indent });
  };
  try {
    doc.transact(() => {
      if (delta < 0) applyIndents();
      const blockIds = doc.getChildren(containerId).slice(scopeOffset + start, scopeOffset + start + segmentLength);
      // Up: the segment's blocks (in order) land at t + i — each block's
      // position is unaffected by the earlier steps (a remove-before +
      // insert-before cancel), so the pre-move indices hold. Down: every
      // block lands at the pre-move index t (the removal from the segment's
      // start shifts the t slot left by one per step).
      for (let i = 0; i < segmentLength; i += 1) {
        const landing = target < start ? scopeOffset + t + i : scopeOffset + t;
        doc.moveBlock(blockIds[i]!, containerId, landing);
      }
      if (delta > 0) applyIndents();
      // The document root's tail guarantee (the move's one transact stands
      // the stand): the segment's move stands a non-text last block (the
      // database / image dragged to the end) — the empty paragraph stands
      // after it (the paste / slash's trailing contract).
      if (containerId === doc.meta.id) ensureTrailingParagraph(doc, doc.meta.id);
    });
  } catch (error) {
    // The core's typed rejection (a corrupt or stale state the seam rule
    // did not foresee — the move's position or an indent update's jump
    // rule): the transact rolled back — the stale drop's posture.
    if (error instanceof InvalidAttrsError || error instanceof InvalidOperationError) return false;
    throw error;
  }
  return true;
}

/**
 * The tail seat's clamp (the preview side of the commit's tail landing):
 * framer's own reorder lets the dragged row cross the full-doc root's
 * trailing text paragraph (the pointer beyond the last row stands it
 * last). The commit stands the segment above the seat (the doc's tail
 * contract), so the preview stands the crossing too — the dragged row
 * clamps to the seat's slot, and the release settles at the preview's
 * stand. The seat's own drag stands unclamped (it is a real block — the
 * guarantee stands its own stand on release).
 */
function clampTailSeatCrossing(next: readonly BlockId[], draggedId: BlockId, seatId: BlockId | undefined): BlockId[] {
  if (seatId === undefined || draggedId === seatId) return [...next];
  const draggedAt = next.indexOf(draggedId);
  const seatAt = next.indexOf(seatId);
  if (draggedAt < 0 || seatAt < 0 || draggedAt <= seatAt) return [...next];
  const rest = next.filter((id) => id !== draggedId);
  const seatAfter = rest.indexOf(seatId);
  return [...rest.slice(0, seatAfter), draggedId, ...rest.slice(seatAfter)];
}

export { clampTailSeatCrossing, commitFlatDrag, hiddenSegmentRows, indentOf, sameIds };
