import type { BlockId, Doc, Selection, TextPoint } from "docblocks-core";

import { caretOffsetIn, editorRootOf, locatePosition, textBlockOfNode } from "./dom-offset";

/**
 * The keyboard extension of a cross-block text range: move the selection's
 * focus end with the arrow / home / end keys.
 *
 * The browser cannot extend a DOM selection across a contenteditable
 * boundary (a drag or a native shift+arrow stays inside the starting
 * editable), so the editor owns the movement for a cross range: the focus
 * end steps by one character (arrows) or to the block's edge (home / end),
 * and steps across the edge into the adjacent chain block. The move
 * re-bases the DOM selection with the anchor end standing; the
 * selectionchange mapping then updates the view. A move with nothing left
 * to extend (the range's edge) stands as a no-op. Returns whether the
 * focus end moved (the caller suppresses the browser default then: the
 * native extension would race the re-base).
 */
function extendRangeFocusEnd(doc: Doc, selection: Selection, key: string): boolean {
  if (selection.kind !== "text" || selection.to === null) return false;
  const domSelection = window.getSelection();
  if (domSelection === null || domSelection.rangeCount === 0) return false;
  const { anchorNode, anchorOffset, focusNode, focusOffset } = domSelection;
  if (anchorNode === null || focusNode === null) return false;
  const scope = editorRootOf(focusNode);

  // The focus end is one of the range's points — the point whose block's
  // inner editable contains the focus node (a position at a block
  // boundary sits in that block's element and reads as its start).
  const focusBlock = textBlockOfNode(focusNode);
  if (focusBlock === null) return false;
  const focusBlockId = focusBlock.dataset.blockId as BlockId;
  const movable =
    focusBlockId === selection.to.blockId
      ? selection.to
      : focusBlockId === selection.from.blockId
        ? selection.from
        : null;
  if (movable === null) return false;

  const offset = caretOffsetIn(focusBlock, focusNode, focusOffset);
  const length = doc.getTextLength(movable.blockId);
  const chain = selection.blocks ?? [selection.from.blockId, selection.to.blockId];
  const index = chain.indexOf(movable.blockId);

  let next: TextPoint | null = null;
  if (key === "ArrowRight") {
    if (offset < length) next = { blockId: movable.blockId, offset: offset + 1 };
    else {
      const nextId = chain[index + 1];
      if (nextId !== undefined) next = { blockId: nextId, offset: 0 };
    }
  } else if (key === "ArrowLeft") {
    if (offset > 0) next = { blockId: movable.blockId, offset: offset - 1 };
    else {
      const prevId = chain[index - 1];
      if (prevId !== undefined) next = { blockId: prevId, offset: doc.getTextLength(prevId) };
    }
  } else if (key === "End") {
    next = { blockId: movable.blockId, offset: length };
  } else if (key === "Home") {
    next = { blockId: movable.blockId, offset: 0 };
  }
  if (next === null) return false;
  if (next.blockId === movable.blockId && next.offset === offset) return false;

  const target = scope.querySelector<HTMLElement>(
    `[data-block-id="${next.blockId}"][data-slot="docblocks/block-content"]`
  );
  if (target === null) return false;
  const position = locatePosition(target, next.offset);
  domSelection.setBaseAndExtent(anchorNode, anchorOffset, position.node, position.offset);
  return true;
}

export { extendRangeFocusEnd };
