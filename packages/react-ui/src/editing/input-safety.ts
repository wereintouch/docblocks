import { useCallback } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { caretOffsetIn } from "./dom-offset";

/**
 * Input safety for one editable block: the browser default for
 * Enter/Shift+Enter and paste is suppressed.
 *
 * A block holds a single line. The default Enter/Shift+Enter would split
 * the line with <br>/<div> nodes in the DOM while the doc stays
 * single-line — a silent DOM/doc divergence — so the keys are no-ops.
 *
 * Paste inserts the plain-text clipboard content as doc commands at the
 * DOM selection offset (one transaction, one undo step). The DOM is never
 * mutated by a paste, so the typed-input diff commit is bypassed on
 * purpose; the store change then converges the text DOM through the
 * regular rebase path. A paste applies only when both selection endpoints
 * are inside the block; a cross-block or missing selection is ignored.
 */
function useBlockInput(id: BlockId) {
  const { doc } = useEditorContext();

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    // isComposing: an Enter during an IME composition commits the
    // candidate text — suppressing it would strand CJK input.
    if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault();
  }, []);

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      event.preventDefault();
      const text = event.clipboardData.getData("text/plain");
      if (text === "") return;
      const selection = window.getSelection();
      if (selection === null || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const el = event.currentTarget;
      if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;
      const anchor = caretOffsetIn(el, range.startContainer, range.startOffset);
      const focus = caretOffsetIn(el, range.endContainer, range.endOffset);
      const from = Math.min(anchor, focus);
      const to = Math.max(anchor, focus);
      doc.transact(() => {
        if (to > from) doc.deleteText(id, from, to);
        doc.insertText(id, from, text);
      });
    },
    [doc, id]
  );

  return { onKeyDown, onPaste };
}

export { useBlockInput };
