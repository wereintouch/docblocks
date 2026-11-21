/** The text-entry's keydown gestures (the input-safety's stand over the
 *  browser's default — the unmanaged DOM mutation would leave the doc
 *  and the DOM diverged): the Enter's split / line break / exit family,
 *  the Delete / Backspace over a non-collapsed in-block range, and the
 *  Backspace at offset 0 (the merge with the previous sibling). */
import type { KeyboardEvent } from "react";

import type { BlockId, BlockType, Doc } from "docblocks-core";
import { InvalidAttrsError, InvalidOperationError } from "docblocks-core";

import type { BlockContextValue } from "../blocks";
import { focusCaretIn, indentOf, mergeWithPrevious, splitAt } from "./block-commands";
import { caretOffsetIn, editorRootOf, restoreSelection } from "./dom-offset";

type EnterArgs = {
  doc: Doc;
  id: BlockId;
  inner: HTMLElement;
  blockType: BlockType;
  inCell: boolean;
  context: BlockContextValue;
  declareLocalCaret: (offset: number) => void;
};

/** The Enter's split / line break / exit family (the soft-line gesture
 *  over quote, callout, and code; the cell's and the canvas-text's soft
 *  break; the split over the page text). */
function handleEnterKey(
  event: KeyboardEvent<HTMLElement>,
  { doc, id, inner, blockType, inCell, context, declareLocalCaret }: EnterArgs
): boolean {
  // isComposing: an Enter during an IME composition commits the
  // candidate text — suppressing it would strand CJK input.
  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
    event.preventDefault();
    const domSelection = window.getSelection();
    if (domSelection === null || domSelection.rangeCount === 0) return true;
    if (domSelection.anchorNode === null || domSelection.focusNode === null) return true;
    // A caret in this block only: a cross-block or missing selection is
    // a no-op, and an in-block range is a no-op.
    if (!inner.contains(domSelection.anchorNode) || !inner.contains(domSelection.focusNode)) return true;
    if (domSelection.anchorNode !== domSelection.focusNode || domSelection.anchorOffset !== domSelection.focusOffset)
      return true;
    const offset = caretOffsetIn(inner, domSelection.anchorNode, domSelection.anchorOffset);
    if (inCell) {
      // The cell context: Enter is a soft line break at every position
      // (the split / exit gestures are the page-level ones — a cell
      // paragraph never splits into a second paragraph).
      declareLocalCaret(offset + 1);
      doc.insertText(id, offset, "\n");
      return true;
    }
    if (blockType === "canvas-text") {
      // The canvas context (the block's parent is the surface): no
      // split (a new block in the surface's children is a BUG) — the
      // line stands the content's own break (the shape text's parity:
      // the single block carries its own soft breaks).
      declareLocalCaret(offset + 1);
      doc.insertText(id, offset, "\n");
      return true;
    }
    if (event.shiftKey) {
      // Shift+Enter is a line break inside the block: one `\n` at the
      // caret. The caret lands after the break — declared before the
      // store update, since the rebase rule keeps a caret at the
      // insertion offset in place and the post-render commit may run
      // synchronously inside the command.
      declareLocalCaret(offset + 1);
      doc.insertText(id, offset, "\n");
      return true;
    }
    if (blockType === "quote" || blockType === "callout" || blockType === "code") {
      // Quote, callout, and code share the interactivity: the lines
      // are soft breaks; Enter exits only where the caret's line is
      // empty and is the block's LAST line (nothing follows the
      // caret) — an empty line with a line after it takes a plain
      // break, and so does a non-empty line. The preceding lines
      // stand as the block and the empty last line becomes a new
      // paragraph after it (a wholly empty one converts in place).
      const text = doc.getText(id);
      const caretLineIsEmpty = offset === 0 || text[offset - 1] === "\n";
      if (!(caretLineIsEmpty && offset === text.length)) {
        declareLocalCaret(offset + 1);
        doc.insertText(id, offset, "\n");
        return true;
      }
      let focusId: BlockId = id;
      try {
        doc.transact(() => {
          if (text === "") {
            doc.changeBlockType(id, "paragraph");
            return;
          }
          doc.deleteText(id, text.length - 1, text.length);
          const indent = indentOf(doc, id);
          focusId = doc.insertBlock("paragraph", indent !== 0 ? { indent } : undefined, {
            parent: context.parentId,
            after: id,
          });
        });
      } catch (error) {
        // The core's typed rejection rolls the transact back: the
        // gesture is a no-op, not a crash.
        if (error instanceof InvalidAttrsError || error instanceof InvalidOperationError) return true;
        throw error;
      }
      focusCaretIn(focusId, 0, editorRootOf(inner));
      return true;
    }
    const newId = splitAt(doc, id, context.parentId, offset);
    if (newId !== null) focusCaretIn(newId, 0, editorRootOf(inner));
    return true;
  }
  return false;
}

type RangeDeleteArgs = { doc: Doc; id: BlockId; inner: HTMLElement };

/** Delete / Backspace over a non-collapsed in-block range: the command
 *  commits the deletion (one transact, the caret re-seats at the
 *  range's start). */
function handleRangeDeleteKey(event: KeyboardEvent<HTMLElement>, { doc, id, inner }: RangeDeleteArgs): boolean {
  // Delete / Backspace over a non-collapsed in-block range: the
  // command commits the deletion (one transact, the caret re-seats at
  // the range's start). The native range deletion runs in the focus's
  // context: over the shared page editable the focus can stand in the
  // container (the programmatic focus cannot move into a nested
  // editable), and the nested line-deletion then mutates the
  // container's DOM (the inner's row) instead of the block's text.
  if ((event.key === "Backspace" || event.key === "Delete") && !event.nativeEvent.isComposing) {
    const rangeSelection = window.getSelection();
    if (rangeSelection !== null && rangeSelection.rangeCount > 0 && !rangeSelection.isCollapsed) {
      const range = rangeSelection.getRangeAt(0);
      if (inner.contains(range.startContainer) && inner.contains(range.endContainer)) {
        const anchor = caretOffsetIn(inner, range.startContainer, range.startOffset);
        const focus = caretOffsetIn(inner, range.endContainer, range.endOffset);
        const from = Math.min(anchor, focus);
        const to = Math.max(anchor, focus);
        if (from !== to) {
          event.preventDefault();
          doc.deleteText(id, from, to);
          restoreSelection(inner, from, null);
        }
        return true;
      }
    }
  }
  return false;
}

type BackspaceArgs = {
  doc: Doc;
  id: BlockId;
  inner: HTMLElement;
  inCell: boolean;
  blockType: BlockType;
  context: BlockContextValue;
};

/** The Backspace at offset 0 (the merge with the previous sibling — the
 *  soft-line block's stand: a non-empty quote/callout/code never merges;
 *  the cell's stand: no merge). */
function handleBackspaceKey(
  event: KeyboardEvent<HTMLElement>,
  { doc, id, inner, inCell, blockType, context }: BackspaceArgs
): boolean {
  if (event.key === "Backspace" && !event.nativeEvent.isComposing) {
    const domSelection = window.getSelection();
    if (domSelection === null || domSelection.rangeCount === 0 || !domSelection.isCollapsed) return false;
    if (domSelection.anchorNode === null || !inner.contains(domSelection.anchorNode)) return false;
    const offset = caretOffsetIn(inner, domSelection.anchorNode, domSelection.anchorOffset);
    if (offset !== 0) {
      // The trailing line-break anchor's caret (the text ends with the
      // break): the native engine eats the rendered anchor span (the
      // firefox's stand) instead of the break, so the break's deletion
      // stands the command's stand (one transact, engine-neutral).
      const text = doc.getText(id);
      if (offset === text.length && text.endsWith("\n")) {
        event.preventDefault();
        doc.deleteText(id, offset - 1, offset);
        focusCaretIn(id, offset - 1, editorRootOf(inner));
        return true;
      }
      return false; // inside the block: the input diff path handles it
    }
    // The native line-backspace (a collapsed caret at the offset 0
    // over the nested editable): the default action would mutate the
    // page container's DOM (the block's row over the span model)
    // outside the engine's writer — the no-op paths suppress it.
    // The cell context: no merge with the previous in-cell paragraph
    // and no exit.
    if (inCell) {
      event.preventDefault();
      return true;
    }
    // A non-empty quote/callout/code never merges with the previous
    // block: the Backspace keeps deleting the block's own characters
    // (line breaks included) until it is empty, and the empty-block
    // gesture below then resets it to a paragraph.
    if ((blockType === "quote" || blockType === "callout" || blockType === "code") && doc.getTextLength(id) > 0) {
      event.preventDefault();
      return true;
    }
    const merged = mergeWithPrevious(doc, id, context.parentId);
    if (merged === null) {
      event.preventDefault();
      return true;
    }
    event.preventDefault();
    focusCaretIn(merged.blockId, merged.offset, editorRootOf(inner));
    return true;
  }
  return false;
}

export { handleEnterKey, handleRangeDeleteKey, handleBackspaceKey };
