/** The selection's keydown gestures (the input-safety's stand): the page
 *  line's Home/End over the shared page inner (the span model), the
 *  gutter's blocks selection (Delete / Backspace, Escape, the
 *  single-block's arrows), and the canvas-text's empty Escape (the
 *  block's removal). */
import type { KeyboardEvent, RefObject } from "react";

import type { BlockId, BlockType, Doc, Selection, SelectionView } from "docblocks-core";

import type { BlockContextValue } from "../blocks";
import { focusCaretIn, removeBlocksSelection } from "./block-commands";
import { caretOffsetIn, effectiveFocusEnd, logicalTextOf, restoreSelection } from "./dom-offset";
import { isPageSurfaceInner, parkEditorFocus } from "./page-surface";

/** Home/End over the shared page inner (the span model): the browser's
 *  native line Home/End runs over the outer editable's (the page
 *  container's) lines, and over the inner's own edge the native move
 *  escapes the inner (the line's edge stands the container's flow,
 *  the shift's extend stands the neighboring blocks' residue). The
 *  product owns the move over the block's own logical line (the soft
 *  break's edge). The island's inners (the table cells' own
 *  editables) keep the browser's native stand. */
function handlePageLineKeys(
  event: KeyboardEvent<HTMLElement>,
  { inner, selection }: { inner: HTMLElement; selection: Selection }
): boolean {
  if (
    isPageSurfaceInner(inner) &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    (event.key === "Home" || event.key === "End") &&
    selection.kind === "text" &&
    (selection.to === null || selection.to.blockId === selection.from.blockId)
  ) {
    const homeDom = window.getSelection();
    if (homeDom !== null && homeDom.rangeCount > 0) {
      const logical = logicalTextOf(inner);
      const endpoint = homeDom.isCollapsed
        ? { node: homeDom.anchorNode, offset: homeDom.anchorOffset }
        : effectiveFocusEnd(homeDom);
      if (endpoint !== null) {
        const caret = caretOffsetIn(inner, endpoint.node, endpoint.offset);
        const lineStart = logical.lastIndexOf("\n", caret - 1) + 1;
        const breakIndex = logical.indexOf("\n", caret);
        const lineEnd = breakIndex === -1 ? logical.length : breakIndex;
        const target = event.key === "Home" ? lineStart : lineEnd;
        event.preventDefault();
        if (event.shiftKey) {
          // The shift's extend keeps the anchor (over a collapsed
          // selection the anchor is the caret, over a range the
          // browser's anchor stand): the focus end takes the edge.
          const anchorFlat = caretOffsetIn(inner, homeDom.anchorNode, homeDom.anchorOffset);
          restoreSelection(inner, Math.min(anchorFlat, target), Math.max(anchorFlat, target));
        } else {
          // The caret's move (the plain key over a range collapses to
          // the edge, the browser's stand).
          restoreSelection(inner, target, null);
        }
        return true;
      }
    }
  }
  return false;
}

/** The gutter's blocks selection's keys (the wrapper's focus's stand):
 *  Delete / Backspace remove the selected blocks, the arrows move a
 *  single-block selection to the previous / next sibling, Escape clears
 *  it. */
function handleBlocksSelectionKeys(
  event: KeyboardEvent<HTMLElement>,
  {
    doc,
    view,
    selection,
    context,
    wrapperRef,
    id,
  }: {
    doc: Doc;
    view: SelectionView;
    selection: Selection;
    context: BlockContextValue;
    wrapperRef: RefObject<HTMLElement | null>;
    id: BlockId;
  }
): boolean {
  if (selection.kind === "blocks") {
    // The wrapper is focused (gutter click): the selection keys act on it.
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      const caret = removeBlocksSelection(doc, context.parentId, selection.ids);
      view.set({ kind: "none" });
      const editorRoot = wrapperRef.current?.closest("[data-slot='docblocks/editor']") ?? document;
      if (caret !== null) {
        focusCaretIn(caret.blockId, caret.offset, editorRoot);
        return true;
      }
      // The deleted rows unmount and the browser would drop the focus to
      // the document: park it on the editor root (the undo hotkey reach).
      if (editorRoot instanceof HTMLElement) editorRoot.focus();
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      view.set({ kind: "none" });
      return true;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      // A single-block selection held by this wrapper; multi-selections
      // ignore the arrows.
      if (selection.ids.length === 1 && selection.ids[0] === id) {
        const siblings = doc.getChildren(context.parentId);
        const index = siblings.indexOf(id);
        let nextId = event.key === "ArrowUp" ? siblings[index - 1] : siblings[index + 1];
        if (nextId !== undefined && doc.getBlock(nextId)?.type === "surface") {
          nextId = undefined; // a surface stands no page row (the canvas layer)
        }
        if (nextId !== undefined) {
          event.preventDefault();
          view.set({ kind: "blocks", ids: [nextId], anchorId: nextId });
          // The wrappers are not focusable over the span model (the
          // mousedown's focus fallback would seat a caret over the
          // blocks' view): the focus parks on the editor root when it
          // stands outside the editor.
          if (wrapperRef.current !== null) parkEditorFocus(wrapperRef.current);
        }
      }
    }
    return true;
  }
  return false;
}

/** The canvas-text's empty block: the Escape removes the block (no
 *  orphan — the double-click's ghost's cancel's parity; the page-text
 *  stand never runs here, the block's parent is the surface). The
 *  inner blurs and the focus parks on the editor root (the undo
 *  hotkey's reach). */
function handleCanvasEscapeKey(
  event: KeyboardEvent<HTMLElement>,
  {
    doc,
    id,
    blockType,
    context,
    innerRef,
    wrapperRef,
  }: {
    doc: Doc;
    id: BlockId;
    blockType: BlockType;
    context: BlockContextValue;
    innerRef: RefObject<HTMLElement | null>;
    wrapperRef: RefObject<HTMLElement | null>;
  }
): boolean {
  if (
    event.key === "Escape" &&
    blockType === "canvas-text" &&
    context.parentType === "surface" &&
    doc.getTextLength(id) === 0
  ) {
    event.preventDefault();
    doc.transact(() => {
      doc.removeBlock(id);
    });
    innerRef.current?.blur();
    wrapperRef.current?.closest<HTMLElement>('[data-slot="docblocks/editor"]')?.focus();
    return true;
  }
  return false;
}

export { handlePageLineKeys, handleBlocksSelectionKeys, handleCanvasEscapeKey };
