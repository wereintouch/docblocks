/** The cross-drag's seating: the text position under the pointer (the
 *  WebKit caret-range API with the geometric fallback) and the DOM
 *  selection from the drag anchor to it. */
import type { BlockId, Doc } from "docblocks-core";

import { applyDomSelection } from "../block-commands";
import { locatePosition } from "../dom-offset";
import type { DragPosition } from "./models";

/**
 * The DOM selection from the drag anchor to the pointer position. Chromium
 * degenerates a reverse cross-editable selection whose base stands at
 * offset 0 (the base seats "before" the editable's content, and the range
 * collapses): that one case is seated forward instead — the from/to stay
 * correct, only the drag-direction flag is lost.
 */
function seatCrossSelection(anchor: DragPosition, position: DragPosition): void {
  const anchorBefore = (anchor.node.compareDocumentPosition(position.node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  const base = anchorBefore || anchor.offset !== 0 ? anchor : position;
  const focus = base === anchor ? position : anchor;
  applyDomSelection(base.node, base.offset, focus.node, focus.offset);
}

/**
 * The text position under (x, y) inside the editor's own scope: the
 * browser's caret position when the pointer stands in a text inner of
 * THIS editor (a nested sync-embed editor's inners are excluded — a
 * foreign position would seat the DOM selection across the boundary and
 * the mapping would drop the view), otherwise the nearest text edge by
 * geometry (the pointer over a gap, a marker, or a non-text block stands
 * at that block's head or tail by its horizontal position). Null when
 * there is no own-scope text to stand on.
 */
function positionAtPoint(doc: Doc, root: HTMLElement, x: number, y: number): DragPosition | null {
  // The WebKit caret-range API (Chrome / Safari): the exact caret stand
  // (the deprecated mark is nominal — Blink ships it as the WebKit-compat
  // API); the standard caretPositionFromPoint is unused, so the non-WebKit
  // (Firefox) positions stand the geometry fallback below.
  // deprecation-allow: the WebKit caret-range API.
  const caretRange = typeof document.caretRangeFromPoint === "function" ? document.caretRangeFromPoint(x, y) : null;
  if (caretRange !== null) {
    const container =
      caretRange.startContainer instanceof Element
        ? caretRange.startContainer
        : (caretRange.startContainer.parentElement ?? null);
    const inner = container?.closest<HTMLElement>('[data-slot="docblocks/block-content"]') ?? null;
    if (inner !== null && root.contains(inner) && inner.closest('[data-slot="docblocks/editor"]') === root) {
      return {
        blockId: inner.dataset.blockId as BlockId,
        node: caretRange.startContainer,
        offset: caretRange.startOffset,
      };
    }
  }
  // Geometric fallback: the text inner with the smallest vertical
  // distance to the pointer (a pointer inside a box has distance zero);
  // the head when the pointer stands in its left quarter, the tail
  // otherwise.
  let best: { el: HTMLElement; distance: number } | null = null;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-slot="docblocks/block-content"]'))) {
    // Own scope only (a nested editor's inners are not candidates).
    if (el.closest('[data-slot="docblocks/editor"]') !== root) continue;
    const box = el.getBoundingClientRect();
    if (box.height === 0) continue;
    const distance = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
    if (best === null || distance < best.distance) best = { el, distance };
  }
  if (best === null) return null;
  const box = best.el.getBoundingClientRect();
  const blockId = best.el.dataset.blockId as BlockId;
  const atHead = x < box.left + Math.max(8, box.width / 4);
  const offset = atHead ? 0 : doc.getTextLength(blockId);
  const position = locatePosition(best.el, offset);
  return { blockId, node: position.node, offset: position.offset };
}

export { positionAtPoint, seatCrossSelection };
