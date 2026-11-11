/** The block keyboard hook: the format shortcuts, the navigation
 *  (arrow-key) moves, and the table-cell descent. */
import { useCallback } from "react";
import type { KeyboardEvent } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";
import { extendSelectionTo, focusCaretIn, moveSegmentInSequence, segmentRange } from "../block-commands";
import { caretOffsetIn, editorRootOf, effectiveFocusEnd, textBlockOfNode } from "../dom-offset";
import { syncDomSelection } from "../selection-mapping";
import type { BlockKeyboardProps, FormatMark } from "./models";
import { cellDescendTarget, findSiblingTextBlock, markToggleAction, parentBlockIdOf } from "./utils";

/**
 * The block's keyboard gestures beyond the input-safety guards: cross-block
 * arrow navigation, mod+shift+arrow block moves, and the format shortcuts.
 *
 * Cross-block arrows act on a caret at the block edge — or on a selection
 * whose focus end sits at the edge (IME composition is ignored): ArrowUp at
 * offset 0 moves the caret to the end of the previous text sibling, ArrowDown
 * at the text end to the start of the next one (the DOM move is scheduled for
 * the next frame; the selectionchange mapping then updates the view
 * selection). With Shift
 * held the gesture extends the selection to the sibling's point instead —
 * the browser's shift+arrow cannot cross a contenteditable boundary, so
 * this edge-to-edge extension is how a cross-block selection is composed.
 * mod+shift+arrow
 * moves a single-block blocks selection (the wrapper-focused gutter
 * selection) one slot in the sibling order — one transact, and the
 * selection is re-set on the moved block so the highlight follows. The
 * format shortcuts (mod+b/i/u/e, mod+shift+x) toggle the mark over an
 * in-block range selection; a collapsed caret is a no-op, with the default
 * suppressed so the browser's mark edit does not diverge the text DOM.
 * Plain arrows yield to a blocks selection (the wrapper's selection
 * navigation owns them; only a caret selection takes the cross-block
gestures). Home/End keep the browser default (one line per block).
 */
function useBlockKeyboard({ id, blockType, context, innerRef }: BlockKeyboardProps): {
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
} {
  const { doc, selection: selectionRef } = useEditorContext();

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const inner = innerRef.current;
      if (inner === null) return;
      const mod = event.metaKey || event.ctrlKey;

      // mod+shift+arrow with a single-block blocks selection on this block:
      // move the block (and its derived subtree — the contiguous segment
      // of its deeper followers) one slot in the sequence order.
      if (mod && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        const view = selectionRef.view;
        if (view === null) return;
        const selection = view.get();
        if (selection.kind !== "blocks" || selection.ids.length !== 1 || selection.ids[0] !== id) return;
        const siblings = doc.getChildren(context.parentId);
        const segment = segmentRange(doc, context.parentId, id);
        if (segment === null) return;
        const length = segment.end - segment.start;
        // The page view filters the surface out of the sequence (the canvas
        // layer — a page gesture does not reorder the canvas layer), so the
        // move targets the nearest NON-surface sibling (a surface standing
        // between keeps its scope slot): up — the previous non-surface
        // sibling's slot; down — right after the next non-surface sibling.
        const isSurface = (blockId: BlockId): boolean => doc.getBlock(blockId)?.type === "surface";
        let target: number;
        if (event.key === "ArrowUp") {
          let i = segment.start - 1;
          while (i >= 0 && isSurface(siblings[i]!)) i -= 1;
          if (i < 0) return; // the top of the visible sequence (only fixed members precede)
          target = i;
        } else {
          let j = segment.end;
          while (j < siblings.length && isSurface(siblings[j]!)) j += 1;
          if (j >= siblings.length) return; // the bottom of the visible sequence (only fixed members follow)
          target = j + 1;
        }
        event.preventDefault();
        moveSegmentInSequence(doc, context.parentId, segment.start, length, target);
        // The selection is blocks-kind by id and survives the move; re-set
        // it so the highlight re-renders at the block's new position.
        view.set({ kind: "blocks", ids: [id], anchorId: id });
        return;
      }

      // The format shortcuts: a caret or range selection inside this block;
      // code blocks reject marks, so they get no shortcut.
      if (mod && !event.nativeEvent.isComposing && blockType !== "code") {
        const key = event.key.toLowerCase();
        const mark: FormatMark | null = !event.shiftKey
          ? key === "b"
            ? "bold"
            : key === "i"
              ? "italic"
              : key === "u"
                ? "underline"
                : key === "e"
                  ? "code"
                  : null
          : key === "x"
            ? "strike"
            : null;
        if (mark === null) return;
        const domSelection = window.getSelection();
        if (domSelection === null || domSelection.rangeCount === 0) return;
        const { anchorNode, anchorOffset, focusNode, focusOffset } = domSelection;
        if (anchorNode === null || focusNode === null) return;
        // Suppress the browser's native formatting over the document DOM —
        // a native edit would diverge it (the collapsed no-op and a
        // cross-block range included).
        event.preventDefault();
        if (!inner.contains(anchorNode) || !inner.contains(focusNode)) return;
        const anchor = caretOffsetIn(inner, anchorNode, anchorOffset);
        const focus = caretOffsetIn(inner, focusNode, focusOffset);
        const from = Math.min(anchor, focus);
        const to = Math.max(anchor, focus);
        if (to === from) return; // a caret has no range to toggle
        const action = markToggleAction(doc, id, from, to, mark);
        doc.transact(() => {
          if (action === "unset") doc.unsetMark(id, from, to, mark);
          else doc.setMark(id, from, to, { type: mark });
        });
        return;
      }

      // Cross-block arrows: a caret — or a selection with its focus end —
      // at a text block's edge.
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (mod || event.nativeEvent.isComposing) return;
      // A blocks selection owns the plain arrows (the wrapper's selection
      // navigation); a leftover DOM caret must not take them over.
      if (selectionRef.view?.get().kind === "blocks") return;
      const domSelection = window.getSelection();
      if (domSelection === null || domSelection.rangeCount === 0) return;
      const { anchorNode, anchorOffset } = domSelection;
      if (anchorNode === null) return;
      // The cross-editable stand (the webkit's clamped focus): the effective
      // focus end stands the range's far endpoint over the clamped
      // read-back (the extension chains over the intermediate blocks then,
      // the edge check over the far block, not the clamped one).
      const effective = effectiveFocusEnd(domSelection);
      if (effective === null) return;
      const focusNode = effective.node;
      const focusOffset = effective.offset;
      // The focus end's block — not necessarily this one: after a cross
      // extension the browser re-focuses the anchor's editable, so the
      // next gesture keydown dispatches from the anchor block and the
      // focus end sits in the far block (the extension chains). A plain
      // arrow over a non-collapsed selection yields to the browser (it
      // collapses the selection); a shift arrow extends the focus end —
      // the browser's shift+arrow cannot cross a contenteditable boundary,
      // so this edge-to-edge extension is how a cross-block selection is
      // composed (the selectionchange mapping then updates the view).
      const focusBlock = textBlockOfNode(focusNode);
      if (focusBlock === null) return;
      const focusBlockId = focusBlock.dataset.blockId as BlockId;
      if (doc.getBlock(focusBlockId) === null) return; // another editor's block
      const focus = caretOffsetIn(focusBlock, focusNode, focusOffset);
      const edge = event.key === "ArrowUp" ? 0 : doc.getTextLength(focusBlockId);
      if (!domSelection.isCollapsed && !event.shiftKey) return;
      if (focus !== edge) return;
      // The cell's own content layer's down edge: the layer's text is
      // above the cell's children sequence (not beside it in the row), so
      // the first text child takes the caret; without children the row's
      // sibling walk stands (the next cell). The up edge keeps the
      // sibling walk (the previous cell).
      const isDown = event.key === "ArrowDown";
      const descend = isDown ? cellDescendTarget(doc, focusBlockId) : null;
      const target =
        descend ??
        findSiblingTextBlock(doc, focusBlockId, parentBlockIdOf(focusBlock, doc), isDown ? "next" : "previous");
      if (target === null) return;
      event.preventDefault();
      if (event.shiftKey) {
        extendSelectionTo(anchorNode, anchorOffset, target.id, event.key === "ArrowUp" ? target.length : 0);
        // The browser does not dispatch selectionchange for the cross-boundary
        // re-base: push the mapping to the view directly (the presence
        // publish and the toolbar follow the view).
        const root = editorRootOf(event.currentTarget);
        if (root instanceof HTMLElement && selectionRef.view !== null) {
          syncDomSelection(root, doc, selectionRef.view);
        }
        return;
      }
      focusCaretIn(target.id, event.key === "ArrowUp" ? target.length : 0, editorRootOf(focusBlock));
    },
    [blockType, context, doc, id, innerRef, selectionRef]
  );

  return { onKeyDown };
}

export { useBlockKeyboard };
