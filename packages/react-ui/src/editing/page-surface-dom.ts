/**
 * The page surface's DOM stand: the surface inner's lookup and the caret's
 * re-seat over the pure page-container positions. The dispatch (./page-surface)
 * reads these over the container-targeted events.
 */
import type { BlockId, Doc } from "docblocks-core";

import { focusCaretIn } from "./block-commands";

/**
 * Whether the inner is a PAGE-SURFACE text block of its own editor scope:
 * not inside a contenteditable="false" island of the same scope (the
 * island's cells stand their own focused inner). An island OUTSIDE the
 * inner's editor root (the sync-embed's wrapper around the nested
 * editor) is not a boundary for that scope.
 */
function isPageSurfaceInner(inner: HTMLElement): boolean {
  const island = inner.closest('[contenteditable="false"]');
  if (island === null) return true;
  const scope = inner.closest('[data-slot="docblocks/editor"]');
  return scope === null || scope.contains(island) === false;
}

/**
 * The page-surface inner (if any) that contains the selection's anchor:
 * the dispatch target over the container-targeted event.
 */
function surfaceInnerOf(container: HTMLElement, anchorNode: Node | null): HTMLElement | null {
  if (anchorNode === null) return null;
  const host = anchorNode.nodeType === Node.ELEMENT_NODE ? (anchorNode as Element) : (anchorNode.parentElement ?? null);
  const inner = host?.closest<HTMLElement>('[data-slot="docblocks/block-content"]') ?? null;
  if (inner === null || !container.contains(inner) || isPageSurfaceInner(inner) === false) return null;
  return inner;
}

/**
 * The page-surface inners of one container in DOM order (the reseat's
 * candidates).
 */
function surfaceInnersOf(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-slot="docblocks/block-content"]')).filter((inner) =>
    isPageSurfaceInner(inner)
  );
}

/**
 * Re-seat a caret stranded at a pure page-container position (between
 * the block rows — the transient the browser's auto-seat leaves over
 * some gesture paths) into the nearest block's edge: the preceding
 * block's end or the following block's start, by the vertical distance
 * (the caret's y over the range's rect, the gap's midline when the
 * rect is degenerate). One DOM selection write (the next
 * selectionchange's mapping reads the seated caret).
 */
function reseatContainerCaret(container: HTMLElement, scope: ParentNode, doc: Doc): void {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (surfaceInnerOf(container, range.startContainer) !== null) return; // already inside a block
  const inners = surfaceInnersOf(container);
  let previous: HTMLElement | null = null;
  let following: HTMLElement | null = null;
  // The order over the anchor's own position (the compareDocumentPosition
  // flags stand the containment over a container's anchor, whose children
  // are all "following" descendants): the inner's start boundary versus
  // the caret's point.
  for (const inner of inners) {
    const innerStart = document.createRange();
    innerStart.setStart(inner, 0);
    innerStart.collapse(true);
    if (range.compareBoundaryPoints(Range.END_TO_START, innerStart) === -1) {
      if (following === null) following = inner;
    } else if (previous === null || previous !== inner) {
      previous = inner;
    }
  }
  if (previous === null && following === null) return;

  let caretY: number | null = null;
  const caretRect = range.getBoundingClientRect();
  if (caretRect.height > 0) {
    caretY = caretRect.top + caretRect.height / 2;
  } else if (previous !== null && following !== null) {
    const previousBottom = previous.getBoundingClientRect().bottom;
    const followingTop = following.getBoundingClientRect().top;
    caretY = (previousBottom + followingTop) / 2;
  }

  // The nearer edge wins (the document-order end / start by default when
  // the caret's y is not measurable).
  let target: HTMLElement | null = previous;
  if (previous !== null && following !== null && caretY !== null) {
    const previousBottom = previous.getBoundingClientRect().bottom;
    const followingTop = following.getBoundingClientRect().top;
    if (Math.abs(followingTop - caretY) < Math.abs(caretY - previousBottom)) {
      target = following;
    }
  } else if (previous === null) {
    target = following;
  }
  if (target === null) return;
  // The seat offset: the preceding block's end over its doc text length
  // (the source of truth — the inner's DOM text may lag a remote change),
  // the following block's start.
  const targetId = target.dataset.blockId as BlockId;
  // The frame-time guard (the seat's validity stands at the frame, not at
  // the schedule): the re-seat's frame may outlive the transient (a
  // competing reseat — the undo/redo's history seat — or the user's own
  // gesture since the selectionchange). A selection that has since stood
  // in a block's inner / a form control / an isolated surface is no
  // longer the stranded container's caret: the edge seat would clobber
  // it (the history's pre-gesture seat over the remount's residue).
  focusCaretIn(targetId, target === previous ? doc.getTextLength(targetId) : 0, scope, () => {
    const anchor = window.getSelection()?.anchorNode ?? null;
    return containerCaretNeedsReseat(container, anchor);
  });
}

/**
 * Whether the caret's anchor sits in a pure page-container position that
 * needs the re-seat: inside the container's own editable flow (its
 * nearest contenteditable is the container) and not inside a page-surface
 * inner (a block's text inner is a valid caret seat, not a transient).
 */
function containerCaretNeedsReseat(container: HTMLElement, anchorNode: Node | null): boolean {
  if (anchorNode === null || container.contains(anchorNode) === false) return false;
  const host = anchorNode.nodeType === Node.ELEMENT_NODE ? (anchorNode as Element) : (anchorNode.parentElement ?? null);
  // A form control's focus (the code caption's input, the hex's field) is
  // a genuine landing: the controls live inside the container but own
  // their own caret.
  if (host?.matches("input, textarea") === true) return false;
  // The form control's focus's residue: while a control inside the
  // container holds the focus, the browser's document selection stands a
  // collapsed caret at a container position (the control's own caret is
  // the input's, the document's selection is the residue). The residue's
  // reseat stands the steal (the seat's focus's move blurs the control —
  // the empty line's unmount's stand — and the seat re-schedules over the
  // next frame's selectionchange: the caption's focus's war's loop). The
  // control's landing stands the no-reseat's parity.
  const active = document.activeElement;
  if (active instanceof HTMLElement && container.contains(active) && active.matches("input, textarea")) return false;
  // A collapsed selection inside an isolated surface (a
  // contenteditable=false island: the database grid's cells, the table's
  // chrome) is that island's own pointer state (the grid's cell selection,
  // the edit session's open): the reseat must not steal it into the page
  // text — the steal takes the island's focus with it (the grid's cell
  // input blurs, its session commits and closes over the press).
  if (host?.closest('[contenteditable="false"]') !== null) return false;
  const editable = host?.closest<HTMLElement>('[contenteditable="true"]') ?? null;
  if (editable !== container) return false;
  return surfaceInnerOf(container, anchorNode) === null;
}

/**
 * Park the editor root's focus over the anchor's editor instance: the
 * selection keys' reach when the focus stands outside the editor (the
 * gutter's click, the drag's release). A focus already inside the editor
 * stands as is (no selection change, the keys bubble from it to the root).
 */
function parkEditorFocus(anchor: HTMLElement): void {
  const root = anchor.closest<HTMLElement>('[data-slot="docblocks/editor"]');
  if (root === null) return;
  const active = document.activeElement;
  if (active !== null && root.contains(active)) return;
  root.focus();
}

export { containerCaretNeedsReseat, isPageSurfaceInner, parkEditorFocus, reseatContainerCaret, surfaceInnerOf };
