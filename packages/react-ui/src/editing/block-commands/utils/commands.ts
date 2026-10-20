/**
 * The doc-side block gestures over the FLAT page model: Enter
 * (split), Backspace (merge), Tab (indent), Shift+Tab (outdent), the
 * blocks-selection removal, the trailing-paragraph stand, and the
 * segment move. A page sequence (the root's children, a cell's mini-doc,
 * a frame's nested page) is one flat list; the nesting is the `indent`
 * attr relative to the PRECEDING block, so the gestures are:
 * Tab/Shift+Tab — one `updateBlock({ indent })` (one undo step, one wire
 * update); a drag / keyboard slot move — the block's derived SUBTREE moves
 * as one contiguous range (`moveSegmentInSequence`, one transact). The doc
 * is the source of truth: a gesture never writes the DOM back; the store
 * rebuilds it, and the focus/caret move is a DOM-only effect (the
 * `./focus` slice).
 */
import { BLOCK_REGISTRY, InvalidAttrsError, InvalidOperationError } from "docblocks-core";
import type { Block, BlockId, Doc, TextRun } from "docblocks-core";

/** The flattened text of the runs. */
function textOf(runs: TextRun[]): string {
  return runs.reduce((text, run) => text + run.text, "");
}

/**
 * The runs of a block snapshot: `content` is omitted from a snapshot when
 * the runs are empty, so an absent field and an empty list are the same.
 */
function runsOf(block: Block): TextRun[] {
  return "content" in block ? (block.content ?? []) : [];
}

/** The block's effective indent: a non-negative integer attr; absent is 0. */
function indentOf(doc: Doc, id: BlockId): number {
  const block = doc.getBlock(id);
  if (block === null || !("attrs" in block)) return 0;
  const indent = (block.attrs as { indent?: unknown } | undefined)?.indent;
  return typeof indent === "number" && Number.isInteger(indent) && indent >= 0 ? indent : 0;
}

/**
 * The parent id of a block: the single block whose children hold it (the
 * page context for a page block — the root, a table cell, or a frame). A
 * document scan — gestures are user-driven and v1 documents are small.
 */
function findParentId(doc: Doc, id: BlockId): BlockId | null {
  const blocks = doc.toJSON().blocks;
  for (const [parentId, block] of Object.entries(blocks)) {
    if ("children" in block && block.children !== undefined && block.children.includes(id)) return parentId;
  }
  return null;
}

/**
 * The derived subtree of a block in its page sequence: the
 * contiguous segment from the block to the first following block with
 * `indent` <= the block's own (the block inclusive). The core's removeBlock
 * cascades this derived segment too — a gesture that removes the segment
 * head may rely on the cascade, and the blocks-kind delete de-duplicates
 * against it (a live read skips ids the cascade already took).
 */
function segmentRange(doc: Doc, contextId: BlockId, id: BlockId): { start: number; end: number } | null {
  const sequence = doc.getChildren(contextId);
  const start = sequence.indexOf(id);
  if (start === -1) return null;
  const indent = indentOf(doc, id);
  let end = start + 1;
  while (end < sequence.length && indentOf(doc, sequence[end]!) > indent) end += 1;
  return { start, end };
}

/**
 * The gutter (blocks) selection removal: each selected block's derived
 * segment (its deeper followers) goes with it — the core's removeBlock
 * cascades the segment, so the removals run head-first and skip what a
 * previous cascade already took. One transact (one undo step, one wire
 * update).
 */
function removeBlocksSelection(doc: Doc, parentId: BlockId, ids: BlockId[]): void {
  doc.transact(() => {
    for (const blockId of ids) {
      if (doc.getBlock(blockId) === null) continue; // a previous cascade took it
      const segment = segmentRange(doc, parentId, blockId);
      if (segment === null) continue;
      const sequence = doc.getChildren(parentId);
      for (let i = segment.start; i < segment.end; i += 1) {
        const segId = sequence[i];
        if (segId !== undefined && doc.getBlock(segId) !== null) doc.removeBlock(segId);
      }
    }
  });
}

/**
 * The page sequence's tail guarantee: a non-text last block (a database /
 * image / table / divider — or the empty sequence) stands no caret home
 * and no delete stand over the sequence's end, so an empty paragraph
 * stands after it (the paste / slash's trailing-paragraph contract,
 * generalized to every sequence-stand). The caller runs it inside its own
 * transact when the stand must share the gesture's one undo step.
 * Returns the stood paragraph's id (the caret's home), or null when the
 * tail already stands a text block (no stand, the caller's focus stands).
 */
function ensureTrailingParagraph(doc: Doc, parentId: BlockId): BlockId | null {
  const sequence = doc.getChildren(parentId);
  const lastId = sequence[sequence.length - 1];
  if (lastId === undefined) return doc.insertBlock("paragraph", undefined, { parent: parentId });
  const last = doc.getBlock(lastId);
  if (last === null) return null;
  if (BLOCK_REGISTRY[last.type].content) return null;
  return doc.insertBlock("paragraph", undefined, { parent: parentId, after: lastId });
}

/** Inserts a block of the same type and attrs as `block`, right after `after` under `parent` (the indent stands). */
function insertSameTypeAfter(doc: Doc, block: Block, parent: BlockId, after: BlockId): BlockId {
  const indent = indentOf(doc, after);
  switch (block.type) {
    case "heading":
      return doc.insertBlock("heading", { level: block.attrs.level, indent }, { parent, after });
    case "list-item":
      // A new item's check stands UNSET (a checked task's Enter must not
      // spawn a checked sibling — the placeholder would stand struck).
      return doc.insertBlock("list-item", { list: block.attrs.list, indent }, { parent, after });
    case "callout":
      return doc.insertBlock(
        "callout",
        block.attrs?.variant !== undefined ? { variant: block.attrs.variant, indent } : { indent },
        { parent, after }
      );
    case "code":
      return doc.insertBlock(
        "code",
        block.attrs?.language !== undefined ? { language: block.attrs.language, indent } : { indent },
        { parent, after }
      );
    case "latex":
      return doc.insertBlock("latex", { display: block.attrs.display, indent }, { parent, after });
    case "canvas-text":
      return doc.insertBlock("canvas-text", block.attrs !== undefined ? { ...block.attrs } : undefined, {
        parent,
        after,
      });
    case "quote":
      // The optional align does not ride the split: a new quote starts with
      // the default alignment (the same as a new paragraph).
      return doc.insertBlock("quote", indent !== 0 ? { indent } : undefined, { parent, after });
    default:
      return doc.insertBlock("paragraph", indent !== 0 ? { indent } : undefined, { parent, after });
  }
}

/**
 * Copies the runs covering flattened offsets [from, to) into `targetId`
 * at `targetPos`, reapplying each run's marks (a plain-text copy would
 * silently drop them).
 */
function copyRunsRange(
  doc: Doc,
  runs: TextRun[],
  from: number,
  to: number,
  targetId: BlockId,
  targetPos: number
): void {
  let pos = 0;
  let cursor = targetPos;
  for (const run of runs) {
    const start = pos;
    pos += run.text.length;
    if (pos <= from || start >= to) continue;
    const piece = run.text.slice(Math.max(0, from - start), Math.min(run.text.length, to - start));
    if (piece === "") continue;
    doc.insertText(targetId, cursor, piece, run.marks);
    cursor += piece.length;
  }
}

/**
 * Enter at a caret in a text block: split the block at the caret offset.
 *
 * Non-empty: a block of the same type and attrs (the indent included) is
 * inserted right after, the tail text (with marks) moves there, and the
 * tail is deleted.
 * Empty: a child block (indent > 0) outdents one level (the type stands,
 * until the indent reaches 0); a root-level non-text block resets its type
 * to a plain paragraph (in place — the type-specific attrs are dropped, the
 * derived segment stands); a root-level empty paragraph inserts a new
 * empty paragraph after.
 * One transact — one undo step.
 *
 * Returns the id of the block that receives the caret; null for a no-op
 * (missing block or offset out of range, or the core's typed rejection of
 * a composed landing — the transact rolled back, the gesture is a no-op,
 * not a crash).
 */
function splitAt(doc: Doc, id: BlockId, contextId: BlockId, offset: number): BlockId | null {
  const block = doc.getBlock(id);
  if (block === null || !BLOCK_REGISTRY[block.type].content) return null;
  const runs = runsOf(block);
  const text = textOf(runs);
  if (offset < 0 || offset > text.length) return null;

  let focusId: BlockId | null = null;
  try {
    doc.transact(() => {
      if (text === "") {
        const indent = indentOf(doc, id);
        if (indent > 0) {
          // A child empty block: one level out, the type stands (the
          // repeated-Enter climb back to the root level).
          doc.updateBlock(id, { indent: indent - 1 });
          focusId = id;
          return;
        }
        if (block.type !== "paragraph") {
          // A root-level empty non-text block: the type resets to plain
          // text in place (the markdown list exit at the root level — the
          // derived segment, if any, stands under the paragraph).
          doc.changeBlockType(id, "paragraph");
          focusId = id;
          return;
        }
        focusId = doc.insertBlock("paragraph", undefined, { parent: contextId, after: id });
        return;
      }
      focusId = insertSameTypeAfter(doc, block, contextId, id);
      copyRunsRange(doc, runs, offset, text.length, focusId, 0);
      doc.deleteText(id, offset, text.length);
    });
  } catch (error) {
    // A composed landing the core rejects: the sequence's indent-jump rule
    // (corrupt data — the composed position of valid data always holds)
    // or a context whose container no longer carries the sequence. The
    // transact rolled back — the gesture is a no-op, not a crash.
    if (error instanceof InvalidAttrsError || error instanceof InvalidOperationError) return null;
    throw error;
  }
  return focusId;
}

/**
 * Backspace at offset 0: merge the block with its previous sequence block.
 *
 * Empty block: a non-text block resets its type to a plain paragraph (in
 * place — the type-specific attrs are dropped, the derived segment stands);
 * a child paragraph (indent > 0) outdents one level (the type stands, until
 * the indent reaches 0). A root-level empty paragraph then takes the merge
 * below — removed when a previous block exists (the caret lands at the
 * join point), a no-op when it is the sequence's only block.
 * Non-empty: previous is a text block: the block's runs (with marks) are
 * appended to the previous block's end and the block is removed. Previous
 * is non-text (divider, image, ...): the previous block and its derived
 * segment are removed only.
 *
 * Returns the surviving block and the caret offset (the join point); null
 * for a no-op (no previous block, the block has a non-empty derived
 * segment — merging a container would swallow its nested content — or the
 * block sits inside the previous block's derived segment — the previous's
 * segment removal would swallow it; the caret stands, nothing is deleted,
 * not a v1 gesture).
 */
function mergeWithPrevious(doc: Doc, id: BlockId, contextId: BlockId): { blockId: BlockId; offset: number } | null {
  const block = doc.getBlock(id);
  if (block === null || !BLOCK_REGISTRY[block.type].content) return null;
  const runs = runsOf(block);
  const text = textOf(runs);
  if (text === "") {
    // The empty-block steps (the type reset / the outdent) never remove
    // content, so they run before the derived-segment guard below (which
    // protects the removal path only).
    if (block.type !== "paragraph") {
      doc.transact(() => {
        doc.changeBlockType(id, "paragraph");
      });
      return { blockId: id, offset: 0 };
    }
    const indent = indentOf(doc, id);
    if (indent > 0) {
      doc.transact(() => {
        doc.updateBlock(id, { indent: indent - 1 });
      });
      return { blockId: id, offset: 0 };
    }
  }
  const segment = segmentRange(doc, contextId, id);
  if (segment === null) return null;
  if (segment.end > segment.start + 1) return null; // the block owns a derived segment: no merge
  const sequence = doc.getChildren(contextId);
  const index = sequence.indexOf(id);
  if (index <= 0) return null;
  const prevId = sequence[index - 1];
  if (prevId === undefined) return null;
  const prev = doc.getBlock(prevId);
  if (prev === null) return null;
  // The current block inside the previous block's derived segment (deeper
  // than the previous): the previous's segment removal would swallow the
  // current block, so the merge is a no-op (the mirrored case of the
  // container guard above) — the caret stands, nothing is deleted.
  const prevSegment = segmentRange(doc, contextId, prevId);
  if (prevSegment !== null && index < prevSegment.end) return null;
  const prevLength = BLOCK_REGISTRY[prev.type].content ? textOf(runsOf(prev)).length : 0;

  let result: { blockId: BlockId; offset: number } | null = null;
  doc.transact(() => {
    if (BLOCK_REGISTRY[prev.type].content) {
      copyRunsRange(doc, runs, 0, textOf(runs).length, prevId, prevLength);
      doc.removeBlock(id);
      result = { blockId: prevId, offset: prevLength };
    } else {
      // The previous block and its derived segment go together: the core's
      // removeBlock cascades the segment (the guard above keeps the current
      // block out of it, so the cascade cannot swallow it).
      doc.removeBlock(prevId);
      result = { blockId: id, offset: 0 };
    }
  });
  return result;
}

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

export {
  ensureTrailingParagraph,
  findParentId,
  indentIn,
  indentOf,
  mergeWithPrevious,
  moveSegmentInSequence,
  outdentBlock,
  removeBlocksSelection,
  segmentRange,
  splitAt,
};
