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
import type { BlockId, Doc } from "docblocks-core";

import { indentOf, runsOf, segmentRange, textOf } from "./commands-reads";
import { copyRunsRange, insertSameTypeAfter } from "./commands-structure";

/**
 * Enter at a caret in a text block: split the block at the caret offset.
 *
 * Non-empty: a block of the same type and attrs (the indent included) is
 * inserted right after, the tail text (with marks) moves there, and the
 * tail is deleted. A caret on the empty LAST line (the text ends with a
 * soft line break) consumes that break: the gesture drops it and the new
 * block stands empty (the quote/callout/code exit parity — without this
 * the break would survive the split in the first block as a ghost empty
 * line).
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
      if (offset > 0 && offset === text.length && text.charCodeAt(offset - 1) === 0x0a) {
        // The empty LAST line: the gesture consumes the trailing soft line
        // break (the exit parity over the gesture family) — the new block
        // stands empty, the ghost line must not survive the split.
        focusId = insertSameTypeAfter(doc, block, contextId, id);
        doc.deleteText(id, text.length - 1, text.length);
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
 * segment — merging a container would swallow its nested content — the
 * previous is the surface (the canvas layer over its figures) or the
 * page-frame block (the window over the canvas frame's content — the
 * frame is childless, so its stand is unconditional, like the surface's):
 * the removal is not a single-Backspace gesture (the data loss — the
 * whole-canvas / the window's removal is the core API's / the explicit
 * selection's Delete) — or the block sits inside the previous block's
 * derived segment — the previous's segment removal would swallow it; the
 * caret stands, nothing is deleted, not a v1 gesture). The table is not
 * among the no-op's containers: its rows are the block's own data, and
 * the explicit deletion (the Backspace's gesture over the table) is the
 * documented removal — the rows' cascade over the core's removeBlock.
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
  // The surface (the canvas layer over its figures — the canvas layer's
  // removal is the core API's, not a page gesture's) and the page-frame
  // block (the window over the canvas frame's content — the frame is
  // childless, so the stand is unconditional, the surface's stand): the
  // removal is not a single-Backspace gesture (the data loss — the
  // explicit selection's Delete stands it). The table is excluded: its
  // rows are the block's own data, and the removal is the explicit
  // deletion (the core's removeBlock cascades the rows' segment), the
  // caret's re-seat + the caret row's zero-duration projection stand the
  // exit (the motion's bounds' pin over the tall table's slide).
  if (
    prev.type === "surface" ||
    prev.type === "frame" ||
    (!BLOCK_REGISTRY[prev.type].content && doc.getChildren(prevId).length > 0 && prev.type !== "table")
  ) {
    return null;
  }

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

export { findParentId, indentOf, segmentRange } from "./commands-reads";
export { ensureTrailingParagraph, removeBlocksSelection } from "./commands-structure";
export { indentIn, moveSegmentInSequence, outdentBlock } from "./commands-segment";
export { mergeWithPrevious, splitAt };
