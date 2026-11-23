import { useCallback } from "react";
import type { KeyboardEvent, RefObject } from "react";

import type { BlockId, BlockType } from "docblocks-core";

import type { BlockContextValue } from "../blocks";
import { useEditorContext } from "../editor-provider";
import { handleCrossRangeKey } from "./cross-range-keys";
import { editorRootOf } from "./dom-offset";
import { handleTabKey } from "./indent-keys";
import { useMentionMenuApi } from "./mention";
import { handleBlocksSelectionKeys, handleCanvasEscapeKey, handlePageLineKeys } from "./selection-keys";
import { mapDomSelection, selectionsEqual } from "./selection-mapping";
import { useSlashMenuApi } from "./slash";
import { handleBackspaceKey, handleEnterKey, handleRangeDeleteKey } from "./text-entry-keys";
import { handleTriggerKeys } from "./trigger-keys";
import { useBlockPaste } from "./use-block-paste";

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
 * the live suffix; code keeps the "/" as plain text).
 * Quote, callout, and code blocks share the soft-line gesture family:
 * Enter on a non-empty line is a line break, Enter on the empty LAST line
 * exits (the preceding lines stand as the block, a new empty paragraph
 * takes the caret, a wholly empty one converts in place), and Backspace
 * at offset 0 never merges a non-empty one with the previous block (the
 * characters delete in place until the block is empty).
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
  const mention = useMentionMenuApi();
  // The cell context (the block is a table cell or lives in one): the cell
  // gestures own the keys — Enter is a soft line break at every position
  // (no split / no exit), Backspace at the line start is a no-op (no
  // merge), and the paste is plain text only (the markdown pipeline does
  // not run in a cell).
  const inCell = context.parentType === "table-cell" || blockType === "table-cell";

  const onPaste = useBlockPaste({
    doc,
    id,
    blockType,
    context,
    selectionRef,
    innerRef,
    rootBlockId,
    inCell,
    declareLocalCaret,
  });

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
        if (!selectionsEqual(fresh, selection)) {
          // The history reseat's window (the undo/redo's remount stands
          // the engine's transient selection loss): the fresh non-text
          // mapping stands the remount's residue (the engine's anchor's
          // wander over the wrapper — the blocks' stand, the none's
          // stand), not the user's clear — the push is suppressed over
          // the window (a history hotkey pressed over the inner would
          // then read the residue for its inverse's snapshot). The user's
          // gutter's click stands the wrapper's focus (no inner's keydown),
          // so the stand touches the residue only.
          const residue = fresh.kind !== "text" && Date.now() < selectionRef.reseatUntil.current;
          if (!residue) {
            view.set(fresh);
          }
        }
        selection = view.get();
        root = mappedRoot;
      }

      const gestures = {
        doc,
        view,
        selection,
        root,
        inner,
        id,
        blockType,
        context,
        inCell,
        declareLocalCaret,
        innerRef,
        wrapperRef,
        slash,
        mention,
        store,
        rootBlockId,
      };

      if (handlePageLineKeys(event, gestures)) return;

      // A cross-block text range: the range operations own the keys —
      // shift+arrow/home/end move the selection's focus end (the browser
      // cannot extend a selection across a contenteditable boundary),
      // Delete/Backspace and a printable character replace the range as
      // text, Enter is a no-op; any other key passes through to the
      // browser (the arrows collapse the range to a caret).
      if (selection.kind === "text" && selection.to !== null && selection.to.blockId !== selection.from.blockId) {
        if (root !== null && handleCrossRangeKey(doc, view, selection, root, event)) return;
      }

      if (handleBlocksSelectionKeys(event, gestures)) return;
      if (handleCanvasEscapeKey(event, gestures)) return;
      if (handleTriggerKeys(event, gestures)) return;
      if (handleEnterKey(event, gestures)) return;
      if (handleRangeDeleteKey(event, gestures)) return;
      if (handleBackspaceKey(event, gestures)) return;
      if (handleTabKey(event, gestures)) return;
    },
    [blockType, context, declareLocalCaret, doc, id, innerRef, rootBlockId, selectionRef, slash, store, wrapperRef]
  );

  return { onKeyDown, onPaste };
}

export { useBlockInput };
