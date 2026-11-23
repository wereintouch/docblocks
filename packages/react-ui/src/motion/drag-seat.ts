/** The drag-reorder's text seat: the user's selection captured before the
 * drag (the release's restore input), the release's click guard (a moved
 * drag's browser click is a drop, not a click), and the seat's restore
 * over the release (or the root's focus park). */
import type { RefObject } from "react";

import type { BlockId } from "docblocks-core";

import { caretOffsetIn, restoreSelection, textBlockOfNode } from "../editing/dom-offset";

/** The release's click guard's window (the moved drag's browser click's lifetime). */
const RELEASE_CLICK_GUARD_MS = 2000;

type PreDragSeat = {
  blockId: BlockId;
  from: number;
  to: number | null;
};

/** The user's text seat over the drag start (the release's restore input). */
function capturePreDragSeat(): PreDragSeat | null {
  const selection = window.getSelection();
  let seat: PreDragSeat | null = null;
  if (selection !== null && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const anchorInner = textBlockOfNode(range.startContainer);
    const focusInner = textBlockOfNode(range.endContainer);
    // One inner only: a cross-inner range is the cross-drag's own
    // gesture contract, not a drag-reorder's restore target.
    if (anchorInner !== null && anchorInner === focusInner) {
      const blockId = anchorInner.dataset.blockId;
      if (blockId !== undefined) {
        const from = caretOffsetIn(anchorInner, range.startContainer, range.startOffset);
        const to = selection.isCollapsed ? null : caretOffsetIn(anchorInner, range.endContainer, range.endOffset);
        seat = { blockId, from, to };
      }
    }
  }
  return seat;
}

/**
 * The release's click guard (armed at the drag's START, not the end —
 * the browser fires the release's click before framer delivers onDragEnd,
 * so a guard installed at the end misses it): it lets a plain click
 * through (no drag move ran) and suppresses the release of a moved drag
 * over non-text chrome: the click's default would collapse the document's
 * selection to the drop point (the caret's jump out of the user's text
 * block), and the gutter's handler would stand a residual blocks
 * selection (the row's highlight) over a gesture that is a drop, not a
 * click. A release over a text inner is not suppressed (the native
 * click's caret seat there is the user's drop gesture, and the restore's
 * guard keeps it).
 */
function installReleaseClickGuard(moved: RefObject<boolean>): void {
  const suppress = (click: Event) => {
    if (!moved.current) return;
    const target = click.target instanceof Element ? click.target : null;
    if (target !== null && target.closest('[data-slot="docblocks/block-content"]') !== null) return;
    moved.current = false;
    click.preventDefault();
    click.stopPropagation();
  };
  window.addEventListener("click", suppress, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", suppress, true), RELEASE_CLICK_GUARD_MS);
}

/**
 * The seat's restore over the release: the focus stands over the
 * selection's write (a focus after the write would reseat the caret over
 * it). The seat's block vanished over the drag (a peer's delete) — the
 * root's focus park stands.
 */
function restoreDragSeat(root: HTMLDivElement | null, seat: PreDragSeat): void {
  const scope = root ?? document;
  const inner =
    Array.from(
      scope.querySelectorAll<HTMLElement>(
        `[data-block-id="${CSS.escape(seat.blockId)}"][data-slot="docblocks/block-content"]`
      )
    ).find((candidate) => !candidate.closest('[data-slot="docblocks/frame-window-content"]')) ?? null;
  if (inner !== null && inner.isConnected) {
    inner.focus();
    restoreSelection(inner, seat.from, seat.to);
  } else {
    root?.focus({ preventScroll: true });
  }
}

export { capturePreDragSeat, installReleaseClickGuard, restoreDragSeat };
export type { PreDragSeat };
