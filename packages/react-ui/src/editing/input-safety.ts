import { useCallback } from "react";
import type { ClipboardEvent, KeyboardEvent, RefObject } from "react";

import type { BlockId, BlockType } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import type { BlockContextValue } from "../blocks/block-context";
import { focusCaretIn, mergeWithPrevious, nestIntoPrevious, outdentFrom, splitAt } from "./block-commands";
import { applyRichPaste } from "./clipboard";
import { caretOffsetIn, restoreSelection } from "./dom-offset";

/**
 * Input safety and the keyboard gestures of one editable block.
 *
 * The browser default for Enter, Shift+Enter, and paste is suppressed: an
 * unmanaged DOM mutation would leave the doc and the DOM diverged. Paste
 * commits through doc commands at the DOM selection offset (one
 * transaction, one undo step): a `text/html` payload is flattened over the
 * clipboard whitelist (marks included), a plain-text payload is inserted
 * as text. Enter splits the block at the caret, Backspace at offset 0
 * merges with the previous sibling, and Tab / Shift+Tab nest a list item.
 * While a blocks selection is active (the wrapper is focused from the
 * gutter): Delete / Backspace remove the selected blocks, the arrows move
 * a single-block selection to the previous / next sibling, Escape clears it.
 *
 * A text gesture runs only when the DOM selection is a caret inside the
 * block's inner editable; a cross-block or missing selection is a no-op.
 */
function useBlockInput({
  id,
  blockType,
  context,
  innerRef,
  wrapperRef,
}: {
  id: BlockId;
  blockType: BlockType;
  context: BlockContextValue;
  innerRef: RefObject<HTMLElement | null>;
  wrapperRef: RefObject<HTMLElement | null>;
}) {
  const { doc, selection: selectionRef } = useEditorContext();

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      event.preventDefault();
      const html = event.clipboardData.getData("text/html");
      const text = event.clipboardData.getData("text/plain");
      const selection = window.getSelection();
      if (selection === null || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const el = event.currentTarget;
      if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;
      const anchor = caretOffsetIn(el, range.startContainer, range.startOffset);
      const focus = caretOffsetIn(el, range.endContainer, range.endOffset);
      const from = Math.min(anchor, focus);
      const to = Math.max(anchor, focus);

      // A rich payload: apply the whitelist-flattened runs as doc commands;
      // the selection collapses to its end first, so the store-driven
      // rebuild lands the caret after the inserted text (the rebase path).
      if (html !== "") {
        restoreSelection(el, to, null);
        applyRichPaste(doc, id, from, to, html);
        return;
      }

      if (text === "") return;
      doc.transact(() => {
        if (to > from) doc.deleteText(id, from, to);
        doc.insertText(id, from, text);
      });
    },
    [doc, id]
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const view = selectionRef.view;
      const inner = innerRef.current;
      if (view === null || inner === null) return;
      const selection = view.get();

      if (selection.kind === "blocks") {
        // The wrapper is focused (gutter click): the selection keys act on it.
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          doc.transact(() => {
            for (const blockId of selection.ids) doc.removeBlock(blockId);
          });
          view.set({ kind: "none" });
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          view.set({ kind: "none" });
          return;
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          // A single-block selection held by this wrapper; multi-selections
          // ignore the arrows (v1).
          if (selection.ids.length === 1 && selection.ids[0] === id) {
            const siblings = doc.getChildren(context.parentId);
            const index = siblings.indexOf(id);
            const nextId = event.key === "ArrowUp" ? siblings[index - 1] : siblings[index + 1];
            if (nextId !== undefined) {
              event.preventDefault();
              view.set({ kind: "blocks", ids: [nextId], anchorId: nextId });
              const root = wrapperRef.current?.closest<HTMLElement>('[data-slot="docblocks/editor"]');
              root?.querySelector<HTMLElement>(`[data-block-id="${nextId}"]`)?.focus();
            }
          }
        }
        return;
      }

      // isComposing: an Enter during an IME composition commits the
      // candidate text — suppressing it would strand CJK input.
      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        if (event.shiftKey) return; // a soft line break is not a v1 feature
        const domSelection = window.getSelection();
        if (domSelection === null || domSelection.rangeCount === 0) return;
        if (domSelection.anchorNode === null || domSelection.focusNode === null) return;
        // A caret in this block only: a cross-block or missing selection is
        // a no-op, and an in-block range is a no-op (v1).
        if (!inner.contains(domSelection.anchorNode) || !inner.contains(domSelection.focusNode)) return;
        if (
          domSelection.anchorNode !== domSelection.focusNode ||
          domSelection.anchorOffset !== domSelection.focusOffset
        )
          return;
        const offset = caretOffsetIn(inner, domSelection.anchorNode, domSelection.anchorOffset);
        const newId = splitAt(doc, id, context.parentId, offset);
        if (newId !== null) focusCaretIn(newId, 0);
        return;
      }

      if (event.key === "Backspace" && !event.nativeEvent.isComposing) {
        const domSelection = window.getSelection();
        if (domSelection === null || domSelection.rangeCount === 0 || !domSelection.isCollapsed) return;
        if (domSelection.anchorNode === null || !inner.contains(domSelection.anchorNode)) return;
        const offset = caretOffsetIn(inner, domSelection.anchorNode, domSelection.anchorOffset);
        if (offset !== 0) return; // inside the block: the input diff path handles it
        const merged = mergeWithPrevious(doc, id, context.parentId);
        if (merged === null) return;
        event.preventDefault();
        focusCaretIn(merged.blockId, merged.offset);
        return;
      }

      if (event.key === "Tab" && !event.nativeEvent.isComposing && blockType === "list-item") {
        const acted = event.shiftKey
          ? outdentFrom(doc, id, context.parentId)
          : nestIntoPrevious(doc, id, context.parentId);
        if (acted) event.preventDefault();
      }
    },
    [blockType, context, doc, id, innerRef, selectionRef, wrapperRef]
  );

  return { onKeyDown, onPaste };
}

export { useBlockInput };
