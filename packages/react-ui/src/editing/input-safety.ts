import { useCallback } from "react";
import type { ClipboardEvent, KeyboardEvent, RefObject } from "react";

import type { BlockId, BlockType } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import type { BlockContextValue } from "../blocks/block-context";
import { focusCaretIn, mergeWithPrevious, nestIntoPrevious, outdentFrom, splitAt } from "./block-commands";
import { applyRichPaste } from "./clipboard";
import { handleCrossRangeKey } from "./cross-range-keys";
import { caretOffsetIn, editorRootOf, restoreSelection } from "./dom-offset";
import { mapDomSelection, selectionsEqual } from "./selection-mapping";
import { useSlashMenuApi } from "./slash";

/**
 * Input safety and the keyboard gestures of one editable block.
 *
 * The browser default for Enter, Shift+Enter, and paste is suppressed: an
 * unmanaged DOM mutation would leave the doc and the DOM diverged. Paste
 * commits through doc commands at the DOM selection offset (one
 * transaction, one undo step): a `text/html` payload is flattened over the
 * clipboard whitelist (marks included), a plain-text payload is inserted
 * as text. Enter splits the block at the caret, Shift+Enter inserts a
 * line break (a `\n` in the run text, rendered through the inner's
 * `white-space: pre-wrap`), Backspace at offset 0 merges with the
 * previous sibling, Tab / Shift+Tab nest / outdent the block (the code
 * block keeps the typewriter Tab: a `\t` at the caret), and a "/" in an
 * empty root-level block opens the slash command menu (the
 * character is never inserted: the menu captures the filter query).
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
  declareLocalCaret,
}: {
  id: BlockId;
  blockType: BlockType;
  context: BlockContextValue;
  innerRef: RefObject<HTMLElement | null>;
  wrapperRef: RefObject<HTMLElement | null>;
  /**
   * Declare the caret the store-driven rebuild should restore (a flat
   * offset in the NEW text). The rebase rule for a change at the caret
   * is the remote-convergence rule (an insertion exactly at the offset
   * does not move it); a local gesture whose caret must land after its
   * own insertion declares it explicitly.
   */
  declareLocalCaret: (offset: number) => void;
}) {
  const { doc, selection: selectionRef, store, rootBlockId } = useEditorContext();
  const slash = useSlashMenuApi();

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      event.preventDefault();
      const html = event.clipboardData.getData("text/html");
      const text = event.clipboardData.getData("text/plain");

      // A cross-block range: the range is deleted as text and the paste
      // content lands at the seam. The pipeline is single-block-targeted
      // (reused as-is: the insert is an empty region at the seam), so a
      // cross paste is two undo steps — the delete, then the insert. A
      // fully deleted range leaves no seam: the data is dropped (the v1
      // edge).
      const view = selectionRef.view;
      if (view !== null) {
        const selection = view.get();
        if (selection.kind === "text" && selection.to !== null && selection.to.blockId !== selection.from.blockId) {
          const result = doc.deleteTextRange(selection.from, selection.to);
          if (result === null) return;
          let length = 0;
          if (html !== "") length = applyRichPaste(doc, result.blockId, result.offset, result.offset, html);
          else if (text !== "") {
            doc.insertText(result.blockId, result.offset, text);
            length = text.length;
          }
          if (length > 0) focusCaretIn(result.blockId, result.offset + length);
          return;
        }
      }

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
    [doc, id, selectionRef]
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const view = selectionRef.view;
      const inner = innerRef.current;
      if (view === null || inner === null) return;
      let selection = view.get();
      let root: HTMLElement | null = null;

      // The selection is re-mapped from the DOM at event time before any
      // operation acts on it: the view is normally updated by the
      // selectionchange event, which the browser does not dispatch for a
      // cross-boundary selection (and dispatches flakily in general). The
      // mapping is the one the event handler uses; a differing result is
      // pushed to the view there (the same equality guard: a no-op set is
      // skipped). A blocks view (the gutter selection) is never clobbered —
      // the DOM caret left behind by the gutter flow cannot express it.
      const mappedRoot = editorRootOf(event.currentTarget);
      const domSelection = window.getSelection();
      if (selection.kind !== "blocks" && mappedRoot instanceof HTMLElement && domSelection !== null) {
        const fresh = mapDomSelection(mappedRoot, domSelection, doc);
        if (!selectionsEqual(fresh, selection)) view.set(fresh);
        selection = view.get();
        root = mappedRoot;
      }

      // A cross-block text range: the range operations own the keys —
      // shift+arrow/home/end move the selection's focus end (the browser
      // cannot extend a selection across a contenteditable boundary),
      // Delete/Backspace and a printable character replace the range as
      // text, Enter is a no-op; any other key passes through to the
      // browser (the arrows collapse the range to a caret).
      if (selection.kind === "text" && selection.to !== null && selection.to.blockId !== selection.from.blockId) {
        if (root !== null && handleCrossRangeKey(doc, view, selection, root, event)) return;
      }

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

      // The slash trigger: a "/" with a collapsed caret in an empty,
      // root-level block opens the command menu (the key is consumed — the
      // character never reaches the doc). `content` is omitted from the
      // empty block's snapshot, so its absence is the empty state too.
      if (slash !== null && event.key === "/" && !event.nativeEvent.isComposing) {
        const domSelection = window.getSelection();
        if (domSelection === null || !domSelection.isCollapsed) return;
        if (domSelection.anchorNode === null || !inner.contains(domSelection.anchorNode)) return;
        const block = store.getState().blocks[id];
        if (block === undefined) return;
        const text = "content" in block ? (block.content ?? []).reduce((t, run) => t + run.text, "") : "";
        if (text === "" && slash.onSlashKey(event, id, context.parentId, true, context.parentId === rootBlockId))
          return;
      }

      // isComposing: an Enter during an IME composition commits the
      // candidate text — suppressing it would strand CJK input.
      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        event.preventDefault();
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
        if (event.shiftKey) {
          // Shift+Enter is a line break inside the block: one `\n` at the
          // caret. The caret lands after the break — declared before the
          // store update, since the rebase rule keeps a caret at the
          // insertion offset in place and the post-render commit may run
          // synchronously inside the command.
          declareLocalCaret(offset + 1);
          doc.insertText(id, offset, "\n");
          return;
        }
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

      if (event.key === "Tab" && !event.nativeEvent.isComposing) {
        if (blockType === "code") {
          // The code block keeps the typewriter Tab: a "\t" at the caret
          // (one insertText) instead of a structural move.
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
          return;
        }
        const acted = event.shiftKey
          ? outdentFrom(doc, id, context.parentId)
          : nestIntoPrevious(doc, id, context.parentId);
        if (acted) event.preventDefault();
      }
    },
    [blockType, context, declareLocalCaret, doc, id, innerRef, rootBlockId, selectionRef, slash, store, wrapperRef]
  );

  return { onKeyDown, onPaste };
}

export { useBlockInput };
