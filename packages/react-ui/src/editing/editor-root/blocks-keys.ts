/** The blocks (gutter) selection's keys on the editor root: the delete,
 *  the Escape's clear, and the mod+shift+arrow's derived-segment move (the
 *  non-text rows a per-block handler does not own). */
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { BlockId, Doc, SelectionView } from "docblocks-core";

import { entrySequenceParent } from "../../blocks";
import { focusCaretIn, moveSegmentInSequence, removeBlocksSelection, segmentRange } from "../block-commands";

interface BlocksKeysDeps {
  doc: Doc;
  rootBlockId: BlockId;
  root: HTMLElement | null;
  view: SelectionView;
}

/**
 * The blocks selection's keys. A text row's own wrapper handles the same
 * keys earlier on the event path and resets the view to none, so the root
 * sees the non-text rows only — no double fire. True = consumed.
 */
function handleBlocksSelectionKeys(event: ReactKeyboardEvent<HTMLDivElement>, deps: BlocksKeysDeps): boolean {
  const { doc, rootBlockId, root, view } = deps;
  const selection = view.get();
  if (selection.kind !== "blocks") return false;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    // The image's delete is a conversion to an empty plain paragraph in
    // place (the image's attrs drop), and the caret seats there — the
    // block is never removed (a single-image selection; a multi-selection
    // deletes as usual).
    const first = selection.ids[0];
    if (selection.ids.length === 1 && first !== undefined && doc.getBlock(first)?.type === "image") {
      doc.changeBlockType(first, "paragraph");
      // The type change remounts the row (the image figure unmounts and
      // the browser drops the focus to the document): park it on the
      // editor root (the undo hotkey reach) and re-seat the caret in the
      // survivor on the next frame.
      root?.focus();
      focusCaretIn(first, 0, root ?? document);
      return true;
    }
    const caret = removeBlocksSelection(doc, entrySequenceParent(doc, rootBlockId), selection.ids);
    view.set({ kind: "none" });
    if (caret !== null) {
      focusCaretIn(caret.blockId, caret.offset, root ?? document);
      return true;
    }
    // The deleted rows unmount and the browser would drop the focus to the
    // document: park it on the editor root (the undo hotkey reach).
    root?.focus();
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    view.set({ kind: "none" });
    return true;
  }
  // mod+shift+arrow (the single block's derived segment's move): the shared
  // page model's focus parks on the editor root (or stands on the page
  // container), so the key's target stands one of them and the per-block
  // inner's handler (the text row's stand) owns the descent from a wrapper
  // / inner target — the root takes the move only over its own targets (no
  // double fire over the inner's path).
  if (root === null) return false;
  const pageContainer = root.querySelector<HTMLElement>("[data-slot='docblocks/page']");
  const isOwnTarget = event.target === root || event.target === pageContainer;
  if (
    !isOwnTarget ||
    !(event.metaKey || event.ctrlKey) ||
    !event.shiftKey ||
    (event.key !== "ArrowUp" && event.key !== "ArrowDown") ||
    selection.ids.length !== 1 ||
    selection.ids[0] === undefined
  ) {
    return false;
  }
  const id = selection.ids[0];
  const siblings = doc.getChildren(rootBlockId);
  if (!siblings.includes(id)) return false;
  const segment = segmentRange(doc, rootBlockId, id);
  if (segment === null) return false;
  const length = segment.end - segment.start;
  const isSurface = (candidate: BlockId): boolean => doc.getBlock(candidate)?.type === "surface";
  let target: number | null = null;
  if (event.key === "ArrowUp") {
    let i = segment.start - 1;
    while (i >= 0 && isSurface(siblings[i]!)) i -= 1;
    if (i >= 0) target = i;
  } else {
    let j = segment.end;
    while (j < siblings.length && isSurface(siblings[j]!)) j += 1;
    if (j < siblings.length) target = j + 1;
  }
  if (target === null) return false;
  event.preventDefault();
  moveSegmentInSequence(doc, rootBlockId, segment.start, length, target);
  view.set({ kind: "blocks", ids: [id], anchorId: id });
  return true;
}

export { handleBlocksSelectionKeys };
