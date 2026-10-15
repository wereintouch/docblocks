import { useCallback } from "react";
import type { KeyboardEvent, RefObject } from "react";

import { BLOCK_REGISTRY } from "docblocks-core";
import type { BlockId, BlockType, Doc } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import type { BlockContextValue } from "../blocks/block-context";
import { extendSelectionTo, focusCaretIn, moveSegmentInSequence, segmentRange } from "./block-commands";
import { caretOffsetIn, editorRootOf, textBlockOfNode } from "./dom-offset";
import { syncDomSelection } from "./selection-mapping";

/** The marks the format shortcuts and the mark toolbar toggle. */
type FormatMark = "bold" | "italic" | "strike" | "underline" | "code";

/**
 * The toggle decision for one mark over [from, to): "unset" when every run
 * overlapping the range already carries the mark, "set" otherwise. A
 * partially covered run counts only if it carries the mark. Reads the block
 * snapshot via `getBlock`; the caller issues the command.
 */
function markToggleAction(doc: Doc, blockId: BlockId, from: number, to: number, mark: FormatMark): "set" | "unset" {
  const block = doc.getBlock(blockId);
  if (block === null || !("content" in block)) return "set";
  let pos = 0;
  let overlaps = false;
  for (const run of block.content ?? []) {
    const start = pos;
    pos += run.text.length;
    if (pos <= from || start >= to) continue;
    overlaps = true;
    if (run.marks[mark] !== true) return "set";
  }
  return overlaps ? "unset" : "set";
}

/**
 * The adjacent sibling a cross-block arrow can land in: the nearest
 * previous/next sibling whose type carries text content — non-text siblings
 * (divider, image, ...) are skipped. Null when nothing with content remains
 * in that direction.
 */
function findSiblingTextBlock(
  doc: Doc,
  id: BlockId,
  parentId: BlockId,
  direction: "previous" | "next"
): { id: BlockId; length: number } | null {
  const siblings = doc.getChildren(parentId);
  const index = siblings.indexOf(id);
  if (index === -1) return null;
  const step = direction === "previous" ? -1 : 1;
  for (let i = index + step; i >= 0 && i < siblings.length; i += step) {
    const siblingId = siblings[i];
    if (siblingId === undefined) return null;
    const sibling = doc.getBlock(siblingId);
    if (sibling === null || !BLOCK_REGISTRY[sibling.type].content) continue;
    return { id: siblingId, length: doc.getTextLength(siblingId) };
  }
  return null;
}

interface BlockKeyboardProps {
  id: BlockId;
  blockType: BlockType;
  context: BlockContextValue;
  innerRef: RefObject<HTMLElement | null>;
}

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
        const index = siblings.indexOf(id);
        const segment = segmentRange(doc, context.parentId, id);
        if (index === -1 || segment === null) return;
        const length = segment.end - segment.start;
        // Pre-move index semantics: up lands the segment's head in the
        // previous block's slot, down lands it right after the block
        // following the segment (removal shifts it left by the length).
        const target = event.key === "ArrowUp" ? segment.start - 1 : segment.end + 1;
        if (target < 0 || target > siblings.length) return; // clamped at the edge
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
      const { anchorNode, anchorOffset, focusNode, focusOffset } = domSelection;
      if (anchorNode === null || focusNode === null) return;
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
      const target = findSiblingTextBlock(
        doc,
        focusBlockId,
        parentBlockIdOf(focusBlock, doc),
        event.key === "ArrowUp" ? "previous" : "next"
      );
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

/**
 * The parent of a block element: the nearest block wrapper above it (the
 * nested children render inside the parent's wrapper), or the document
 * root when it stands at the top level.
 */
function parentBlockIdOf(blockEl: HTMLElement, doc: Doc): BlockId {
  const wrapper = blockEl.parentElement;
  const parent = wrapper?.parentElement?.closest<HTMLElement>("[data-block-id]") ?? null;
  return parent?.dataset.blockId ?? doc.meta.id;
}

export { markToggleAction, useBlockKeyboard };
export type { FormatMark };
