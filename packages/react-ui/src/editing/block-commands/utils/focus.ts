/**
 * The DOM-only side of the block gestures: the focus/caret seats scheduled
 * for the frame after a structural gesture. The doc is untouched here —
 * the gestures' doc writes live in `./commands`; these helpers only move
 * the browser focus and selection into the (possibly remounted) inner
 * editables.
 */
import type { BlockId, Doc } from "docblocks-core";

import { editorRootOf, locatePosition, logicalTextOf, restoreSelection } from "../../dom-offset";
import { findParentId } from "./commands";

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
function focusCaretIn(blockId: BlockId, offset: number, scope: ParentNode = document): void {
  afterFrame(() => {
    const el = liveScope(scope).querySelector<HTMLElement>(
      `[data-block-id="${blockId}"][data-slot="docblocks/block-content"]`
    );
    // The gesture outlived its editor: a stale restore would clobber the live selection.
    if (el === null || !el.isConnected) return;
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
    const cell = root.querySelector<HTMLElement>(`[data-slot="docblocks/table-cell"][data-block-id="${cellId}"]`);
    const activation = cell?.querySelector<HTMLElement>('[data-slot="docblocks/cell-activation"]');
    if (activation == null || !activation.isConnected) return;
    activation.focus();
  });
}

/** The parent block id per the DOM: the wrapper above the block's own wrapper; null at the doc root. */
function domParentBlockIdOf(el: HTMLElement): BlockId | null {
  const ownWrapper = el.parentElement?.closest<HTMLElement>("[data-block-id]");
  return ownWrapper?.parentElement?.closest<HTMLElement>("[data-block-id]")?.dataset.blockId ?? null;
}

/**
 * Whether the candidate inner is the SURVIVOR of the remount, not a framer
 * exit clone. On a wrapper-tag swap (list-item in/out) the exit clone
 * renders the block's NEW type at the OLD position: the clone's list-item
 * wrapper stands in a bare framer positioning div (never the list group),
 * and a non-list block's clone is an li — a wrong wrapper tag for the new
 * type. The survivor stands in its real structural parent.
 */
function isSurvivorInner(el: HTMLElement, blockType: string): boolean {
  const wrapper = el.parentElement;
  if (blockType === "list-item") {
    return wrapper?.tagName === "LI" && wrapper.parentElement?.matches('[data-slot="docblocks/list"]') === true;
  }
  return wrapper?.tagName === "DIV";
}

/** Whether the DOM selection's endpoints sit in (or on) the element. */
function seatedIn(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (sel === null || sel.rangeCount === 0) return false;
  const inOrOn = (node: Node | null): boolean => node !== null && (node === el || el.contains(node));
  return inOrOn(sel.anchorNode) && inOrOn(sel.focusNode);
}

/**
 * Restore a text range (a caret when `to` is null) inside a block's inner
 * editable after a structural gesture (a Tab/Shift+Tab indent, a list-type
 * swap) that remounts the block's subtree: the old editable is gone and
 * the DOM selection cleared with it.
 *
 * The re-seat watches the DOM for the remount instead of racing it: a
 * MutationObserver (microtask-driven, so it fires even while the page's
 * frames are throttled) re-attempts the seat on every mutation until the
 * selection stands in the survivor inner. The survivor is the candidate
 * that is not the gesture's own pre-gesture element (the motion view's
 * exit clone), whose DOM parent matches the doc's current parent (a clone
 * lingers at the OLD position), whose wrapper matches the block's type
 * (see isSurvivorInner), and whose text is seeded (the store-driven
 * commit seeds it). A live selection inside another block's editable is
 * the user's and stops the watch — it is never clobbered. The offsets are
 * the gesture's pre-move ones: a structural gesture never edits the
 * block's text, so they remain valid. `scope` confines the lookup to one
 * editor root (a page can render the same doc in several).
 */
const RESTORE_DEADLINE_MS = 600;

function restoreSelectionIn(
  doc: Doc,
  blockId: BlockId,
  from: number,
  to: number | null,
  scope: ParentNode = document,
  exclude: HTMLElement | null = null
): void {
  const selector = `[data-block-id="${blockId}"][data-slot="docblocks/block-content"]`;
  const json = doc.toJSON();
  // A top-level block's doc parent is the root block; in the DOM its parent
  // wrapper is absent, so normalize to null (domParentBlockIdOf's domain).
  // The same normalization stands for a frame: its nested page renders in
  // its own editor root (no frame wrapper in the DOM).
  const rawParent = findParentId(doc, blockId);
  const rawParentType = rawParent === null ? null : (json.blocks[rawParent]?.type ?? null);
  const expectedParent = rawParent === null || rawParent === json.id || rawParentType === "frame" ? null : rawParent;
  const blockType = json.blocks[blockId]?.type ?? "";
  let observer: MutationObserver | null = null;
  const deadlineTimer = window.setTimeout(stop, RESTORE_DEADLINE_MS);

  function stop(): void {
    window.clearTimeout(deadlineTimer);
    observer?.disconnect();
  }

  /** One seat attempt: stop when the selection stands or is the user's. */
  function attempt(): void {
    const inners = Array.from(liveScope(scope).querySelectorAll<HTMLElement>(selector))
      .filter((el) => el.isConnected)
      .filter((el) => el !== exclude)
      // The DOM parent check is the cell/frame scoping: a top-level block's
      // expected parent is null (no page-context wrapper in the DOM — the
      // nesting is the indent attr, not a wrapper), so the check is skipped
      // then (the id + survivor-tag + seeded-text filters stand).
      .filter((el) => expectedParent === null || domParentBlockIdOf(el) === expectedParent)
      .filter((el) => isSurvivorInner(el, blockType))
      .filter((el) => logicalTextOf(el) === doc.getText(blockId));
    const el = inners.length === 1 ? (inners[0] as HTMLElement) : null;
    if (el !== null && seatedIn(el)) {
      // The selection may stand in the rebuilt inner while the focus is
      // stranded elsewhere (the remount takes the focus, not the seat):
      // focus lands the caret.
      el.focus();
      stop();
      return;
    }
    // A live selection inside ANOTHER block's editable is the user's: a
    // deliberate move — stop and never clobber it.
    const node = window.getSelection()?.anchorNode ?? null;
    const anchorEl = node instanceof Element ? node : (node?.parentElement ?? null);
    const host = anchorEl?.closest<HTMLElement>('[data-slot="docblocks/block-content"]') ?? null;
    if (host !== null && host.dataset.blockId !== blockId && host !== el) {
      stop();
      return;
    }
    if (el !== null) {
      el.focus();
      restoreSelection(el, from, to);
    }
  }

  // Fast path: the remount may already be committed (a synchronous flush).
  attempt();
  observer = new MutationObserver(attempt);
  observer.observe(liveScope(scope), { childList: true, subtree: true });
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
  const domSelection = window.getSelection();
  if (domSelection === null) return;
  const scope = editorRootOf(anchorNode);
  const el = scope.querySelector<HTMLElement>(`[data-block-id="${blockId}"][data-slot="docblocks/block-content"]`);
  if (el === null) return;
  const target = locatePosition(el, offset);
  domSelection.setBaseAndExtent(anchorNode, anchorOffset, target.node, target.offset);
}

export { extendSelectionTo, focusCaretIn, focusCellActivation, restoreSelectionIn };
