/** The Tab's keydown gesture (the input-safety's stand): the code's
 *  typewriter Tab (a "\t" at the caret) and the indent / outdent (the
 *  selection's re-seat over the remount). */
import type { KeyboardEvent, RefObject } from "react";

import type { BlockId, BlockType, Doc } from "docblocks-core";

import type { BlockContextValue } from "../blocks";
import { indentIn, outdentBlock, restoreSelectionIn } from "./block-commands";
import { caretOffsetIn, editorRootOf } from "./dom-offset";

type TabArgs = {
  doc: Doc;
  id: BlockId;
  inner: HTMLElement;
  innerRef: RefObject<HTMLElement | null>;
  blockType: BlockType;
  context: BlockContextValue;
  declareLocalCaret: (offset: number) => void;
};

function handleTabKey(
  event: KeyboardEvent<HTMLElement>,
  { doc, id, inner, innerRef, blockType, context, declareLocalCaret }: TabArgs
): boolean {
  if (event.key === "Tab" && !event.nativeEvent.isComposing) {
    if (blockType === "code") {
      // The code block keeps the typewriter Tab: a "\t" at the caret
      // (one insertText) instead of an indent change.
      if (!event.shiftKey) {
        const domSelection = window.getSelection();
        if (
          domSelection !== null &&
          domSelection.rangeCount > 0 &&
          domSelection.isCollapsed &&
          domSelection.anchorNode !== null &&
          inner.contains(domSelection.anchorNode)
        ) {
          const offset = caretOffsetIn(inner, domSelection.anchorNode, domSelection.anchorOffset);
          event.preventDefault();
          // The caret lands after the inserted tab — declared before
          // the store update (the rebase rule keeps a caret at the
          // insertion offset in place).
          declareLocalCaret(offset + 1);
          doc.insertText(id, offset, "\t");
        }
      }
      return true;
    }
    // The DOM selection before the gesture: the indent change is a
    // structural edit (a list item re-derives its nesting — in the
    // base view its li moves between lists and remounts), so the
    // gesture's own selection (a caret, or a range within the block)
    // is captured here and re-seated when the remount dropped it.
    const domSelection = window.getSelection();
    let seat: { from: number; to: number | null } | null = null;
    if (
      domSelection !== null &&
      domSelection.rangeCount > 0 &&
      domSelection.anchorNode !== null &&
      domSelection.focusNode !== null &&
      inner.contains(domSelection.anchorNode) &&
      inner.contains(domSelection.focusNode)
    ) {
      const anchor = caretOffsetIn(inner, domSelection.anchorNode, domSelection.anchorOffset);
      const focus = caretOffsetIn(inner, domSelection.focusNode, domSelection.focusOffset);
      const from = Math.min(anchor, focus);
      const to = Math.max(anchor, focus);
      seat = { from, to: to === from ? null : to };
      // The gesture owns the key while the caret sits in this block's
      // text — the browser's default Tab (focus to the next focusable
      // element) must not run, even when the gesture itself is a
      // no-op (a first block's Tab, a top-level Shift+Tab): the focus
      // stays in the text.
      event.preventDefault();
    }
    // The gesture's own inner element: the motion view's exit clone
    // keeps this node connected while the remount adds the survivor,
    // so the re-seat must not mistake the clone for the target.
    const exclude = innerRef.current ?? null;
    const acted = event.shiftKey ? outdentBlock(doc, id, context.parentId) : indentIn(doc, id, context.parentId);
    if (acted) {
      // The flat gesture (updateBlock) keeps the block's element where
      // it stands in the flat-row view (no remount: the selection is
      // already seated). A remount (a base-view list item moving
      // between lists) drops the selection — then the re-seat.
      const freshSelection = window.getSelection();
      const stillSeated =
        inner.isConnected &&
        freshSelection !== null &&
        freshSelection.rangeCount > 0 &&
        freshSelection.anchorNode !== null &&
        inner.contains(freshSelection.anchorNode);
      if (!stillSeated && seat !== null) {
        restoreSelectionIn(doc, id, seat.from, seat.to, editorRootOf(inner), exclude);
      }
    }
  }
  return false;
}

export { handleTabKey };
