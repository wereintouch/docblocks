import { useCallback } from "react";
import type { ClipboardEvent, KeyboardEvent, RefObject } from "react";

import type { BlockId, BlockType, TextPoint } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import type { BlockContextValue } from "../blocks/block-context";
import {
  focusCaretIn,
  indentIn,
  mergeWithPrevious,
  outdentBlock,
  restoreSelectionIn,
  segmentRange,
  splitAt,
} from "./block-commands";
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
 * block keeps the typewriter Tab: a `\t` at the caret), and a "/" typed in a
 * page text block opens the slash command menu — the character and the
 * query typed after it enter the doc as plain text (the menu filters on
 * the live suffix; code and latex keep the "/" as plain text).
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
      // content lands at the seam — one transaction (one undo step, one
      // wire update), the single-block insert pipeline reused as-is. A
      // fully deleted range leaves no seam: the data is dropped (the v1
      // edge).
      const view = selectionRef.view;
      if (view !== null) {
        const selection = view.get();
        if (selection.kind === "text" && selection.to !== null && selection.to.blockId !== selection.from.blockId) {
          // The const locals keep the narrowing inside the transact closure
          // (a property narrowing does not persist past the arrow).
          const from = selection.from;
          const to = selection.to;
          // The seam outlives the transact via a property (a closure-
          // assigned variable is not flow-narrowed past the call).
          const seam: { point: TextPoint | null; length: number } = { point: null, length: 0 };
          doc.transact(() => {
            const deleted = doc.deleteTextRange(from, to);
            if (deleted === null) return;
            if (html !== "") seam.length = applyRichPaste(doc, deleted.blockId, deleted.offset, deleted.offset, html);
            else if (text !== "") {
              doc.insertText(deleted.blockId, deleted.offset, text);
              seam.length = text.length;
            }
            seam.point = deleted;
          });
          if (seam.point === null) return;
          if (seam.length > 0) {
            // Scope the caret seat to this editor's root: the seam block id
            // also exists in the other panes' editors (same doc), and an
            // unscoped document query would seat the caret in the first
            // match in document order.
            const root = innerRef.current?.closest('[data-slot="docblocks/editor"]') ?? document;
            focusCaretIn(seam.point.blockId, seam.point.offset + seam.length, root);
          }
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
            // Each selected block's derived segment (its deeper
            // followers) goes with it: the core's removeBlock cascades
            // the segment, so the removals run head-first and skip what
            // a previous cascade already took (the cross-range
            // commands' skip-already-removed pattern) — a single-block
            // selection is one removeBlock, a multi-block selection one
            // transact (one undo step).
            for (const blockId of selection.ids) {
              if (doc.getBlock(blockId) === null) continue; // a previous cascade took it
              const segment = segmentRange(doc, context.parentId, blockId);
              if (segment === null) continue;
              const sequence = doc.getChildren(context.parentId);
              for (let i = segment.start; i < segment.end; i += 1) {
                const segId = sequence[i];
                if (segId !== undefined && doc.getBlock(segId) !== null) doc.removeBlock(segId);
              }
            }
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

      // The slash trigger: a "/" with a collapsed caret in a page text block
      // (paragraph, heading, list-item, callout — code and latex are
      // excluded: a "/" there is plain text) at any position and any indent
      // of the root page sequence (or the provider's entry root itself)
      // opens the command menu. The character stands in the doc as a regular
      // one (the editor commits it; the browser's insertion is suppressed) —
      // the menu tracks the text after it (the doc is the query's source
      // of truth), and Backspace deletes it like any other.
      if (
        slash !== null &&
        event.key === "/" &&
        !event.nativeEvent.isComposing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        const domSelection = window.getSelection();
        if (domSelection === null || !domSelection.isCollapsed) return;
        if (domSelection.anchorNode === null || !inner.contains(domSelection.anchorNode)) return;
        const block = store.getState().blocks[id];
        if (block === undefined) return;
        const type = block.type;
        const isPageText = type === "paragraph" || type === "heading" || type === "list-item" || type === "callout";
        const inPageSequence = context.parentId === rootBlockId || id === rootBlockId;
        if (isPageText && inPageSequence) {
          const caret = caretOffsetIn(inner, domSelection.anchorNode, domSelection.anchorOffset);
          if (slash.onSlashKey(event, id, context.parentId, caret)) {
            // The key's default is prevented by the trigger: the editor
            // commits the "/" itself (one undo step) and the caret lands
            // after it — declared before the store update, since the
            // rebase rule keeps a caret at the insertion offset in place.
            declareLocalCaret(caret + 1);
            doc.insertText(id, caret, "/");
            return;
          }
        }
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
        if (newId !== null) focusCaretIn(newId, 0, editorRootOf(inner));
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
        focusCaretIn(merged.blockId, merged.offset, editorRootOf(inner));
        return;
      }

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
          return;
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
    },
    [blockType, context, declareLocalCaret, doc, id, innerRef, rootBlockId, selectionRef, slash, store, wrapperRef]
  );

  return { onKeyDown, onPaste };
}

export { useBlockInput };
