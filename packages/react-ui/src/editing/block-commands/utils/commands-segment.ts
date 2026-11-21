/**
 * The segment-level gestures (the `./commands`'s helpers): the Tab and
 * Shift+Tab indents (one `updateBlock` / the whole derived segment's
 * outdent) and the derived subtree's move within the page sequence.
 */
import { InvalidAttrsError, InvalidOperationError } from "docblocks-core";
import type { BlockId, Doc } from "docblocks-core";

import { indentOf, segmentRange } from "./commands-reads";

/**
 * Tab in a text block: indent the block by one — `updateBlock({ indent:
 * indent + 1 })` — when valid: a preceding block must exist and the new
 * indent must not exceed the preceding block's indent by more than 1 (the
 * markdown jump rule; the strict validator enforces it over the sequence).
 * A no-op at the boundary (the first block, or the jump already maximal).
 * True when the block was updated (one updateBlock in one transact).
 */
function indentIn(doc: Doc, id: BlockId, contextId: BlockId): boolean {
  const block = doc.getBlock(id);
  if (block === null) return false;
  const sequence = doc.getChildren(contextId);
  const index = sequence.indexOf(id);
  if (index <= 0) return false; // no preceding block: nothing to nest under
  const prevId = sequence[index - 1];
  if (prevId === undefined) return false;
  const prev = doc.getBlock(prevId);
  if (prev === null) return false;
  const nextIndent = indentOf(doc, id) + 1;
  if (nextIndent > indentOf(doc, prevId) + 1) return false;
  doc.transact(() => {
    doc.updateBlock(id, { indent: nextIndent });
  });
  return true;
}

/**
 * Shift+Tab in a text block: outdent the block's WHOLE derived segment —
 * the head and every deeper follower, one level each (the markdown/Notion
 * UX: the item moves out with its sublist) — in one transact (one undo
 * step). A lone head outdent would leave a follower at head + 2 — an
 * indent jump the sequence no longer validates (the per-block updateBlock
 * check covers only the updated block's own position). The relative
 * indents stand, so the jump rule holds at every landing: a follower's
 * new predecessor is its segment predecessor at the same relative indent,
 * and the head's new indent is one below the old, which passed its
 * predecessor's +1. A follower at indent 0 cannot occur (a segment member
 * is deeper than the head, and the head's indent > 0), so the per-member
 * floor is moot. A no-op at the top level (indent 0) and for a head with
 * no deeper followers the update is the block alone. True when the
 * segment was updated.
 */
function outdentBlock(doc: Doc, id: BlockId, contextId: BlockId): boolean {
  const block = doc.getBlock(id);
  if (block === null) return false;
  const indent = indentOf(doc, id);
  if (indent === 0) return false; // the top level has no outdent target
  const segment = segmentRange(doc, contextId, id);
  if (segment === null) return false;
  const sequence = doc.getChildren(contextId);
  const ids = sequence.slice(segment.start, segment.end);
  try {
    doc.transact(() => {
      // Head-first: each member's landing check runs against the final
      // state (the earlier members are already outdented).
      for (const segId of ids) {
        const segIndent = indentOf(doc, segId);
        doc.updateBlock(segId, { indent: Math.max(0, segIndent - 1) });
      }
    });
  } catch (error) {
    // A composed landing the core rejects (corrupt data — the composed
    // position of valid data always holds): the transact rolled back —
    // the gesture is a no-op, not a crash.
    if (error instanceof InvalidAttrsError || error instanceof InvalidOperationError) return false;
    throw error;
  }
  return true;
}

/**
 * Moves a block's derived subtree (the contiguous segment from `startIndex`
 * of length `length`) within the same page sequence to `target` — a range
 * operation on one array (the segment's internal order and
 * indents stand — a drop is a reorder, never a re-nest; the level change
 * is the Tab/Shift+Tab gesture). One transact — one undo step, one wire
 * update.
 *
 * `target` is the pre-move sequence index of the item the segment's head
 * will PRECEDE (`target` = the sequence's length = move to the end, no
 * item preceded). The two in-place targets (the head precedes itself —
 * `target` = the segment's start — or its own last element — `target` =
 * the segment's end) issue no command. A landing the core rejects with a
 * typed error (the sequence's indent-jump rule — the segment's head would
 * jump levels at the target) rolls the transact back and issues no
 * command: the gesture is a no-op (the caller's stale-drop posture — the
 * order resyncs to the store).
 */
function moveSegmentInSequence(
  doc: Doc,
  contextId: BlockId,
  startIndex: number,
  length: number,
  target: number
): boolean {
  const sequence = doc.getChildren(contextId);
  if (startIndex < 0 || startIndex + length > sequence.length) return false;
  if (target < 0 || target > sequence.length) return false;
  // The in-place targets: the head precedes itself or its own last element
  // (the segment's own position — a no-op drop).
  if (target === startIndex || target === startIndex + length) return false;

  try {
    doc.transact(() => {
      const blockIds = doc.getChildren(contextId).slice(startIndex, startIndex + length);
      if (target < startIndex) {
        // Moving up: the segment's blocks (in order) land at target + i.
        // Each block's position is unaffected by the earlier steps (a
        // remove-before + insert-before cancel), so the indices hold for
        // every step.
        for (let i = 0; i < length; i += 1) {
          doc.moveBlock(blockIds[i]!, contextId, target + i);
        }
      } else {
        // Moving down: the segment's blocks (head-first) each land at the
        // pre-move index `target` — the removal from the segment's start
        // shifts the `target` slot left by one, so the head lands before
        // the item at `target` and each follower right after the block
        // moved before it. Head-first runs every LANDING block's jump
        // check against its final predecessor (the earlier segment
        // members are already in place), so a valid final state commits
        // every step. The mid-transact sequence can briefly violate the
        // rule for a not-yet-moved follower (it stands on a shallower
        // predecessor until its own step), but the Yjs transaction is
        // atomic — the transient never reaches the wire or a listener, and
        // the per-block landing check reads only the landing block's own
        // position (only a rejected batch on corrupt/stale state could
        // emit it).
        for (let i = 0; i < length; i += 1) {
          doc.moveBlock(blockIds[i]!, contextId, target);
        }
      }
    });
  } catch (error) {
    // The core's typed landing rejection (the indent-jump rule): the
    // transact rolled back — no command issued, the gesture is a no-op.
    if (error instanceof InvalidOperationError) return false;
    throw error;
  }
  return true;
}

export { indentIn, moveSegmentInSequence, outdentBlock };
