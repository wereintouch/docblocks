import { BLOCK_REGISTRY } from "docblocks-core";
import type { Block, BlockId, Doc, TextRun } from "docblocks-core";

import { editorRootOf, locatePosition, logicalTextOf, restoreSelection } from "./dom-offset";

/**
 * Block-level gestures: Enter (split), Backspace (merge), Tab (nest),
 * Shift+Tab (outdent). Each gesture issues its doc commands inside one
 * `doc.transact` — one undo step, one wire update. The doc is the source
 * of truth: a gesture never writes the DOM back; the store rebuilds it,
 * and the focus/caret move is a DOM-only effect scheduled for the next
 * frame (the new block must be rendered first).
 */

/** The flattened text of the runs. */
function textOf(runs: TextRun[]): string {
  return runs.reduce((text, run) => text + run.text, "");
}

/**
 * The runs of a block snapshot: `content` is omitted from a snapshot when
 * the runs are empty, so an absent field and an empty list are the same.
 */
function runsOf(block: Block): TextRun[] {
  return "content" in block ? (block.content ?? []) : [];
}

/**
 * The parent id of a block: the single block whose children hold it. A
 * document scan — gestures are user-driven and v1 documents are small.
 */
function findParentId(doc: Doc, id: BlockId): BlockId | null {
  const blocks = doc.toJSON().blocks;
  for (const [parentId, block] of Object.entries(blocks)) {
    if ("children" in block && block.children !== undefined && block.children.includes(id)) return parentId;
  }
  return null;
}

/** Inserts a block of the same type and attrs as `block`, right after `after` under `parent`. */
function insertSameTypeAfter(doc: Doc, block: Block, parent: BlockId, after: BlockId): BlockId {
  switch (block.type) {
    case "heading":
      return doc.insertBlock("heading", { level: block.attrs.level }, { parent, after });
    case "list-item":
      return doc.insertBlock(
        "list-item",
        { list: block.attrs.list, ...(block.attrs.checked !== undefined ? { checked: block.attrs.checked } : {}) },
        { parent, after }
      );
    case "callout":
      return doc.insertBlock(
        "callout",
        block.attrs?.variant !== undefined ? { variant: block.attrs.variant } : undefined,
        { parent, after }
      );
    case "code":
      return doc.insertBlock(
        "code",
        block.attrs?.language !== undefined ? { language: block.attrs.language } : undefined,
        { parent, after }
      );
    case "latex":
      return doc.insertBlock("latex", { display: block.attrs.display }, { parent, after });
    case "canvas-text":
      return doc.insertBlock("canvas-text", block.attrs !== undefined ? { ...block.attrs } : undefined, {
        parent,
        after,
      });
    default:
      return doc.insertBlock("paragraph", undefined, { parent, after });
  }
}

/**
 * Copies the runs covering flattened offsets [from, to) into `targetId`
 * at `targetPos`, reapplying each run's marks (a plain-text copy would
 * silently drop them).
 */
function copyRunsRange(
  doc: Doc,
  runs: TextRun[],
  from: number,
  to: number,
  targetId: BlockId,
  targetPos: number
): void {
  let pos = 0;
  let cursor = targetPos;
  for (const run of runs) {
    const start = pos;
    pos += run.text.length;
    if (pos <= from || start >= to) continue;
    const piece = run.text.slice(Math.max(0, from - start), Math.min(run.text.length, to - start));
    if (piece === "") continue;
    doc.insertText(targetId, cursor, piece, run.marks);
    cursor += piece.length;
  }
}

/**
 * The exit point of an empty list item: the paragraph lands after the
 * outermost list-item ancestor, under that ancestor's parent (a
 * top-level empty item exits to a paragraph after itself).
 */
/**
 * The paragraph placement of a list exit: climb while the item's parent is
 * itself a list item (a paragraph cannot be a list-item child), and land
 * right after the outermost item in the chain, under that item's parent.
 */
function listExitPoint(doc: Doc, id: BlockId, parentId: BlockId): { parent: BlockId; after: BlockId } {
  let after = id;
  let parent = parentId;
  for (;;) {
    const parentBlock = doc.getBlock(parent);
    if (parentBlock === null || parentBlock.type !== "list-item") break;
    const grandParentId = findParentId(doc, parent);
    if (grandParentId === null) break;
    after = parent;
    parent = grandParentId;
  }
  return { parent, after };
}

/**
 * Enter at a caret in a text block: split the block at the caret offset.
 *
 * Empty block: paragraph / heading / callout / code / latex insert a new
 * paragraph after and keep the empty block; an empty list item exits the
 * list (it is removed and a paragraph is inserted at the exit point).
 * Non-empty: a block of the same type and attrs is inserted right after,
 * the tail text (with marks) moves there, and the tail is deleted. One
 * transact — one undo step.
 *
 * Returns the id of the block that receives the caret; null for a no-op
 * (missing block or offset out of range).
 */
function splitAt(doc: Doc, id: BlockId, parentId: BlockId, offset: number): BlockId | null {
  const block = doc.getBlock(id);
  if (block === null || !BLOCK_REGISTRY[block.type].content) return null;
  const runs = runsOf(block);
  const text = textOf(runs);
  if (offset < 0 || offset > text.length) return null;

  let focusId: BlockId | null = null;
  doc.transact(() => {
    if (text === "") {
      if (block.type === "list-item") {
        const exit = listExitPoint(doc, id, parentId);
        // The paragraph lands before the item is removed: the exit point is
        // an existing sibling and must still hold when the insert resolves.
        focusId = doc.insertBlock("paragraph", undefined, { parent: exit.parent, after: exit.after });
        doc.removeBlock(id);
        return;
      }
      focusId = doc.insertBlock("paragraph", undefined, { parent: parentId, after: id });
      return;
    }
    focusId = insertSameTypeAfter(doc, block, parentId, id);
    copyRunsRange(doc, runs, offset, text.length, focusId, 0);
    doc.deleteText(id, offset, text.length);
  });
  return focusId;
}

/**
 * Backspace at offset 0: merge the block with its previous sibling.
 *
 * Previous is a text block: the block's runs (with marks) are appended to
 * the previous block's end and the block is removed. Previous is
 * non-text (divider, image, ...): the previous block is removed only.
 *
 * Returns the surviving block and the caret offset (the join point); null
 * for a no-op (no previous sibling, or the block has children — merging
 * a container is a structural merge, not a v1 gesture).
 */
function mergeWithPrevious(doc: Doc, id: BlockId, parentId: BlockId): { blockId: BlockId; offset: number } | null {
  const block = doc.getBlock(id);
  if (block === null || !BLOCK_REGISTRY[block.type].content) return null;
  if ("children" in block && (block.children?.length ?? 0) > 0) return null;
  const siblings = doc.getChildren(parentId);
  const index = siblings.indexOf(id);
  if (index <= 0) return null;
  const prevId = siblings[index - 1];
  if (prevId === undefined) return null;
  const prev = doc.getBlock(prevId);
  if (prev === null) return null;
  const runs = runsOf(block);
  const prevLength = BLOCK_REGISTRY[prev.type].content ? textOf(runsOf(prev)).length : 0;

  let result: { blockId: BlockId; offset: number } | null = null;
  doc.transact(() => {
    if (BLOCK_REGISTRY[prev.type].content) {
      copyRunsRange(doc, runs, 0, textOf(runs).length, prevId, prevLength);
      doc.removeBlock(id);
      result = { blockId: prevId, offset: prevLength };
    } else {
      doc.removeBlock(prevId);
      result = { blockId: id, offset: 0 };
    }
  });
  return result;
}

/**
 * Tab in a text block: nest under the previous sibling when it is a
 * registry container whose children set accepts this block's type (a
 * list item nests under a list item; the page set nests under any text
 * container). True when the block moved (one moveBlock in one transact).
 */
function nestIntoPrevious(doc: Doc, id: BlockId, parentId: BlockId): boolean {
  const block = doc.getBlock(id);
  if (block === null) return false;
  const siblings = doc.getChildren(parentId);
  const index = siblings.indexOf(id);
  if (index <= 0) return false;
  const prevId = siblings[index - 1];
  if (prevId === undefined) return false;
  const prev = doc.getBlock(prevId);
  if (prev === null) return false;
  const allowed = BLOCK_REGISTRY[prev.type].childrenTypes;
  if (allowed === undefined || !allowed.includes(block.type)) return false;
  doc.transact(() => {
    doc.moveBlock(id, prevId, doc.getChildren(prevId).length);
  });
  return true;
}

/**
 * Shift+Tab in a text block whose parent is a container: outdent to right
 * after the parent (the top level — the parent is the root — has no
 * outdent target). True when the block moved (one moveBlock in one
 * transact).
 */
function outdentFrom(doc: Doc, id: BlockId, parentId: BlockId): boolean {
  if (parentId === doc.meta.id) return false;
  const parent = doc.getBlock(parentId);
  if (parent === null || BLOCK_REGISTRY[parent.type].children !== true) return false;
  const block = doc.getBlock(id);
  if (block === null) return false;
  const grandParentId = findParentId(doc, parentId);
  if (grandParentId === null) return false;
  const grandParent = doc.getBlock(grandParentId);
  if (grandParent === null) return false;
  const allowed = BLOCK_REGISTRY[grandParent.type].childrenTypes;
  if (allowed === undefined || !allowed.includes(block.type)) return false;
  const grandChildren = doc.getChildren(grandParentId);
  const parentIndex = grandChildren.indexOf(parentId);
  if (parentIndex === -1) return false;
  doc.transact(() => {
    doc.moveBlock(id, grandParentId, parentIndex + 1);
  });
  return true;
}

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
 * editable after a structural gesture (a Tab/Shift+Tab move, a list-type
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
  const rawParent = findParentId(doc, blockId);
  const expectedParent = rawParent === json.id ? null : rawParent;
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
      .filter((el) => domParentBlockIdOf(el) === expectedParent)
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

export {
  extendSelectionTo,
  focusCaretIn,
  mergeWithPrevious,
  nestIntoPrevious,
  outdentFrom,
  restoreSelectionIn,
  splitAt,
};
