/**
 * The frame-scheduled caret seats (the `./focus`'s siblings): the focus
 * into a block's inner editable at the flat offset, the exact element's
 * seat, and the table cell's activation-layer focus.
 */
import type { BlockId } from "docblocks-core";

import { restoreSelection } from "../../dom-offset";

/** Run `fn` in the next animation frame (setTimeout where frames do not exist). */
function afterFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
  else setTimeout(fn, 0);
}

/**
 * The live scope of a caret/selection seat. The captured editor root may
 * have been replaced by the very gesture that scheduled the seat (a
 * structural move remounts the subtree, and the captured element detaches):
 * a detached scope finds nothing, so the document is the fallback (the
 * caller's uniqueness / connectedness guards still apply).
 */
function liveScope(scope: ParentNode): ParentNode {
  return scope instanceof Element && !scope.isConnected ? document : scope;
}

/**
 * Move the browser caret into a block's inner editable at the flat offset
 * (DOM-only: the doc is untouched). Schedule it for the frame after a
 * structural gesture (the element must be rendered); `scope` confines the
 * lookup to one editor root (a page can render the same doc in several).
 */
function focusCaretIn(blockId: BlockId, offset: number, scope: ParentNode = document, guard?: () => boolean): void {
  afterFrame(() => {
    // The frame-time guard (the caller's validity check): the frame's
    // window may have outlived the seat's reason (a competing reseat or
    // the user's gesture since the schedule) — the guard's veto skips
    // the seat instead of clobbering the live state.
    if (guard !== undefined && !guard()) return;
    // The original's inner stands the id's query (the frame's window's
    // inert copy stands the same id over the copy — the frame's view-back
    // order stands it first in the DOM); the window-content's exclusion
    // picks the original. The gesture outlived its editor: a stale
    // restore would clobber the live selection.
    const el =
      Array.from(
        liveScope(scope).querySelectorAll<HTMLElement>(
          `[data-block-id="${CSS.escape(blockId)}"][data-slot="docblocks/block-content"]`
        )
      ).find((candidate) => !candidate.closest('[data-slot="docblocks/frame-window-content"]')) ?? null;
    if (el === null || !el.isConnected) return;
    el.focus();
    restoreSelection(el, offset, null);
  });
}

/**
 * The caret's seat into the EXACT editable element at the flat offset
 * (the focusCaretIn's parity — the frame waits the caller's re-render's
 * commit). The exact element's stand over the id's query: the canvas's
 * frame windows render the block's inert copies over the same id (the
 * query stands the copy — the frame's view-back order stands it first in
 * the DOM), so the caller passes the hit's element (the elementFromPoint's
 * resolution — the pointer-events-none's copy stands no hit).
 */
function focusCaretInElement(el: HTMLElement, offset: number): void {
  afterFrame(() => {
    if (!el.isConnected) return;
    el.focus();
    restoreSelection(el, offset, null);
  });
}

/**
 * Focus the empty-cell activation layer of a table cell: the local
 * editable that holds the caret while the cell holds no blocks (the first
 * input materializes the paragraph). The layer is not a doc block, so the
 * seat is a plain focus of the element (the caret lands at the start of
 * the empty layer). Like focusCaretIn the query is scoped to one editor
 * root.
 */
function focusCellActivation(cellId: BlockId, scope: ParentNode = document): void {
  afterFrame(() => {
    const root = liveScope(scope);
    const cell = root.querySelector<HTMLElement>(
      `[data-slot="docblocks/table-cell"][data-block-id="${CSS.escape(cellId)}"]`
    );
    const activation = cell?.querySelector<HTMLElement>('[data-slot="docblocks/cell-activation"]');
    if (activation == null || !activation.isConnected) return;
    activation.focus();
  });
}

export { focusCaretIn, focusCaretInElement, focusCellActivation, liveScope };
