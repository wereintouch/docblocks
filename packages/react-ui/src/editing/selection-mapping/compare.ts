/**
 * The mapped selections' comparison and the gesture-time sync: the
 * structural equality (the engine's `blocks` chain is derived from
 * from/to, so it is not compared), the gesture's view push, and the
 * "live caret in an editable" guard over the shared page editable.
 */
import type { Selection as CoreSelection, Doc, SelectionView } from "docblocks-core";

import { editableOfNode } from "./blocks-dom";
import { mapDomSelection } from "./mapping";

/**
 * Structural equality over the fields a DOM mapping produces. The
 * engine-maintained `blocks` chain of a text selection is derived from
 * from/to, so it is not compared.
 */
function selectionsEqual(a: CoreSelection, b: CoreSelection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "none") return true;
  if (a.kind === "blocks" && b.kind === "blocks") {
    return a.anchorId === b.anchorId && a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i]);
  }
  if (a.kind === "text" && b.kind === "text") {
    if (a.from.blockId !== b.from.blockId || a.from.offset !== b.from.offset) return false;
    if ((a.to === null) !== (b.to === null)) return false;
    if (a.to !== null && b.to !== null && (a.to.blockId !== b.to.blockId || a.to.offset !== b.to.offset)) {
      return false;
    }
    return a.reverse === b.reverse;
  }
  return false;
}

/**
 * Map the DOM selection to the view at gesture time. The browser does not
 * reliably dispatch `selectionchange` for a cross-boundary selection (and
 * headless dispatch is flaky in general), so every gesture that re-bases
 * the DOM selection pushes the mapping to the view itself; the event-based
 * path then stands as the idempotent backstop.
 */
function syncDomSelection(root: HTMLElement, doc: Doc, view: SelectionView): void {
  const next = mapDomSelection(root, window.getSelection(), doc);
  if (!selectionsEqual(next, view.get())) view.set(next);
}

/**
 * Whether the DOM selection's endpoints stand inside a block's editable
 * (of any editor root): the caret is live in an editable, so the
 * selection's mapping expresses a real edit position. A selection
 * collapsed outside the editables (the chrome, the stale residue) does
 * not — the mapping must not clobber a `blocks` view there. Neither does
 * a caret parked at a pure page-container position (the page's single
 * editable container is an editable, but the caret stands in no block —
 * the reseat's transient, the gutter's focus park).
 */
function domSelectionInEditable(domSelection: Selection | null): boolean {
  // A caret parked at a pure page-container position (the gutter's click
  // focus, a remount's transient) is not a live edit position: the page's
  // single editable container is the editable, but the caret stands in no
  // block, so the mapping must not clobber a `blocks` view there.
  const inText = (node: Node | null): boolean => {
    const editable = editableOfNode(node);
    if (editable === null) return false;
    return editable.getAttribute("data-slot") !== "docblocks/page";
  };
  return inText(domSelection?.anchorNode ?? null) && inText(domSelection?.focusNode ?? null);
}

export { domSelectionInEditable, selectionsEqual, syncDomSelection };
