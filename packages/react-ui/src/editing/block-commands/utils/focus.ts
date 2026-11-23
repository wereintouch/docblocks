/**
 * The DOM-only side of the block gestures: the focus/caret seats scheduled
 * for the frame after a structural gesture. The doc is untouched here —
 * the gestures' doc writes live in `./commands`; these helpers only move
 * the browser focus and selection into the (possibly remounted) inner
 * editables.
 */
import type { BlockId } from "docblocks-core";

import { editorRootOf, locatePosition } from "../../dom-offset";
import { setWriterAnchorHint } from "../../selection-mapping";

/**
 * Stand a DOM selection over (base, focus) — across the contenteditable
 * boundary included: the selection is built as one document-ordered Range
 * and added whole. The engine's `setBaseAndExtent` / `extend` cannot put an
 * endpoint in ANOTHER editable — the webkit clamps the far endpoint to the
 * anchor's own editable (the call stands, the range does not cross); the
 * Range's endpoints are faithful across the boundary. The anchor/focus
 * READ-BACK may still be clamped in that engine — the mapping's stand
 * (`selection-mapping`'s cross-editable branch) reads the range there.
 * The direction's read-back stands the range's (the anchor reads as the
 * range's start): the core model is document-ordered, so the direction
 * carries no behavior — except the writer's anchor's hint (the backward
 * cross seat's stand): the base stands the selection's anchor (the
 * gesture's fixed end), and the addRange's read-back flips the anchor to
 * the range's start (the far end), so the intended anchor (the base, the
 * range's end's stand) is recorded over the seat's endpoints for the
 * mapping's reverse's stand (the extension's chain reads the anchor from
 * the view's direction then, not the DOM's read-back).
 */
function applyDomSelection(baseNode: Node, baseOffset: number, focusNode: Node, focusOffset: number): void {
  const selection = window.getSelection();
  if (selection === null) return;
  // The document order, stated explicitly: a backward set is not
  // normalized by the engines (the later start collapses the range to
  // itself), so the order is resolved up front over a probe range.
  const baseProbe = document.createRange();
  baseProbe.setStart(baseNode, baseOffset);
  baseProbe.collapse(true);
  const focusProbe = document.createRange();
  focusProbe.setStart(focusNode, focusOffset);
  focusProbe.collapse(true);
  const baseFirst = baseProbe.compareBoundaryPoints(Range.END_TO_START, focusProbe) <= 0;
  const range = document.createRange();
  if (baseFirst) {
    range.setStart(baseNode, baseOffset);
    range.setEnd(focusNode, focusOffset);
  } else {
    range.setStart(focusNode, focusOffset);
    range.setEnd(baseNode, baseOffset);
  }
  selection.removeAllRanges();
  selection.addRange(range);
  // The backward seat's writer's hint (the anchor's identity's stand):
  // the intended anchor is the base (the range's end), the read-back's
  // anchor stands the range's start — the mapping honors the hint over
  // the exact-match seat (the extension's chain reads the direction from
  // the view's reverse then).
  if (!baseFirst) {
    const root = editorRootOf(baseNode) ?? editorRootOf(focusNode);
    if (root !== null) {
      setWriterAnchorHint(root, baseNode, baseOffset, focusNode, focusOffset, baseNode, baseOffset);
    }
  }
}

/**
 * Re-base the browser's selection anchor at (anchorNode, anchorOffset) and
 * put the focus end at the flat offset in the target block (DOM-only: the
 * doc is untouched). The browser's shift+arrow cannot cross a contenteditable
 * boundary, so this is the edge extension a cross-block selection is
 * composed from (a collapsed caret extends from itself); the
 * selectionchange mapping then updates the view selection. The DOM focus is
 * left where it stands — the browser re-focuses the anchor's editable after
 * a cross-boundary selection anyway, and the gestures read the DOM
 * selection, not the focus. A no-op when the target element is not rendered.
 */
function extendSelectionTo(anchorNode: Node, anchorOffset: number, blockId: BlockId, offset: number): void {
  const scope = editorRootOf(anchorNode);
  const el = scope.querySelector<HTMLElement>(
    `[data-block-id="${CSS.escape(blockId)}"][data-slot="docblocks/block-content"]`
  );
  if (el === null) return;
  const target = locatePosition(el, offset);
  applyDomSelection(anchorNode, anchorOffset, target.node, target.offset);
}

export { focusCaretIn, focusCaretInElement, focusCellActivation } from "./focus-caret";
export { reseatHistorySelection, restoreSelectionIn } from "./focus-restore";
export { applyDomSelection, extendSelectionTo };
