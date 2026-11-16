import type { Doc, Selection, TextPoint } from "docblocks-core";
import { BLOCK_REGISTRY } from "docblocks-core";

import { applyDomSelection } from "./block-commands";
import { editorRootOf, locatePosition } from "./dom-offset";
import { findSiblingTextBlock, parentBlockIdOf } from "./keyboard/utils";

/**
 * The keyboard extension of a cross-block text range: move the selection's
 * focus end with the arrow / home / end keys.
 *
 * The browser cannot extend a DOM selection across a contenteditable
 * boundary (a drag or a native shift+arrow stays inside the starting
 * editable), so the editor owns the movement for a cross range: the
 * moving end steps by one character (arrows) or to the block's edge
 * (home / end), and steps across the edge into the adjacent chain block.
 * The moving end's stand (the anchor's identity's stand): the user's
 * anchor stands the view's direction (the DOM's read-back stands the
 * range's start over the backward seat's flipped anchor), so the moving
 * end is the opposite point — the reverse's `from`, the `to` otherwise.
 * The move re-bases the DOM selection with the anchor end standing (the
 * view's points, not the DOM's read-back); the selectionchange mapping
 * then updates the view. A move with nothing left to extend (the range's
 * edge) stands as a no-op; a move to the fixed end shrinks the range to
 * the caret (the selection's shrink's parity). Returns whether the moving
 * end moved (the caller suppresses the browser default then: the native
 * extension would race the re-base).
 */
function extendRangeFocusEnd(doc: Doc, selection: Selection, key: string): boolean {
  if (selection.kind !== "text" || selection.to === null) return false;
  const domSelection = window.getSelection();
  if (domSelection === null || domSelection.rangeCount === 0) return false;
  const scope = editorRootOf(domSelection.anchorNode ?? domSelection.focusNode ?? document.body);
  const movable = selection.reverse ? selection.from : selection.to;
  const fixed = selection.reverse ? selection.to : selection.from;

  const offset = movable.offset;
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

  const anchorEl = scope.querySelector<HTMLElement>(
    `[data-block-id="${CSS.escape(fixed.blockId)}"][data-slot="docblocks/block-content"]`
  );
  if (anchorEl === null) return false;
  const anchorPos = locatePosition(anchorEl, fixed.offset);
  const target = scope.querySelector<HTMLElement>(
    `[data-block-id="${CSS.escape(next.blockId)}"][data-slot="docblocks/block-content"]`
  );
  if (target === null) return false;
  const position = locatePosition(target, next.offset);
  applyDomSelection(anchorPos.node, anchorPos.offset, position.node, position.offset);
  return true;
}

/**
 * The vertical keyboard extension of a cross-block text range: the
 * shift+arrow up/down move of the selection's moving end. The browser's
 * vertical shift arrow cannot extend a range across the block boundary
 * (the extension stands inside the focus's inner) and collapses the range
 * at the block's edge instead of a no-op (the Chromium's stand), so the
 * editor owns the key over the cross range: the moving end's stand (the
 * anchor's identity's stand — the DOM's read-back's flip's stand) is the
 * view's direction's opposite point; a moving end over a single-line block
 * crosses to the adjacent text block (the up's the previous block's end,
 * the down's the next's start — the caret's cross model's parity, the
 * chain's continuation over the adjacent blocks, the non-text siblings'
 * skip), a multi-line block's inner line stands the native's in-block's
 * extension (the browser's line's walk), and the multi-line's outer line
 * stands the edge's cross or a suppressed no-op. `owned` signals the
 * default's suppression (the passthrough's stand the browser's native
 * line's walk); `moved` the re-base (the view's sync's stand).
 */
function extendRangeFocusEndVertical(
  doc: Doc,
  selection: Selection,
  key: "ArrowUp" | "ArrowDown"
): { owned: boolean; moved: boolean } {
  if (selection.kind !== "text" || selection.to === null) return { owned: false, moved: false };
  const domSelection = window.getSelection();
  if (domSelection === null || domSelection.rangeCount === 0) return { owned: false, moved: false };
  const scope = editorRootOf(domSelection.anchorNode ?? domSelection.focusNode ?? document.body);
  // The moving end's stand (the anchor's identity's stand — the DOM's
  // read-back's flip's stand): the user's anchor stands the view's
  // direction, so the moving end is the opposite point.
  const movable = selection.reverse ? selection.from : selection.to;
  const fixed = selection.reverse ? selection.to : selection.from;
  const block = doc.getBlock(movable.blockId);
  // The registry's content flag (the JSON's `content` field stands omitted
  // over the empty block — the field's presence is not the test).
  if (block === null || !BLOCK_REGISTRY[block.type]?.content) return { owned: true, moved: false };
  const movableEl = scope.querySelector<HTMLElement>(
    `[data-block-id="${CSS.escape(movable.blockId)}"][data-slot="docblocks/block-content"]`
  );
  if (movableEl === null) return { owned: true, moved: false };
  const offset = movable.offset;
  const runs = "content" in block ? (block.content ?? []) : [];
  const text = runs.map((run) => run.text).join("");
  const length = text.length;
  const lines = text.split("\n");
  const lineIndex = text.slice(0, Math.max(0, Math.min(offset, length))).split("\n").length - 1;
  const isUp = key === "ArrowUp";
  // The multi-line block's inner line (not the block's outer line): the
  // native's in-block's line's walk stands (the extension's possibility's
  // stand — a line above / below exists over the inner line).
  if (lines.length > 1 && ((isUp && lineIndex > 0) || (!isUp && lineIndex < lines.length - 1))) {
    return { owned: false, moved: false };
  }
  // The block's outer line: the editor's stand. The single-line's block
  // crosses from any offset (the chain's continuation's stand — the up's
  // the previous block's end, the down's the next's start); the multi-line's
  // outer line crosses from its edge only (the caret's cross model's parity).
  if (lines.length > 1 && (isUp ? offset !== 0 : offset !== length)) {
    return { owned: true, moved: false };
  }
  const target = findSiblingTextBlock(
    doc,
    movable.blockId,
    parentBlockIdOf(movableEl, doc),
    isUp ? "previous" : "next"
  );
  if (target === null) return { owned: true, moved: false };
  const next: TextPoint = { blockId: target.id, offset: isUp ? target.length : 0 };
  const anchorEl = scope.querySelector<HTMLElement>(
    `[data-block-id="${CSS.escape(fixed.blockId)}"][data-slot="docblocks/block-content"]`
  );
  if (anchorEl === null) return { owned: true, moved: false };
  const anchorPos = locatePosition(anchorEl, fixed.offset);
  const targetEl = scope.querySelector<HTMLElement>(
    `[data-block-id="${CSS.escape(next.blockId)}"][data-slot="docblocks/block-content"]`
  );
  if (targetEl === null) return { owned: true, moved: false };
  const targetPos = locatePosition(targetEl, next.offset);
  applyDomSelection(anchorPos.node, anchorPos.offset, targetPos.node, targetPos.offset);
  return { owned: true, moved: true };
}

export { extendRangeFocusEnd, extendRangeFocusEndVertical };
