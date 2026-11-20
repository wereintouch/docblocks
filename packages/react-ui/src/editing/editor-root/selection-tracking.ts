/** The editor root's `selectionchange` mapping: the DOM selection → the
 *  core Selection view (the editing stand's tracking). */
import { useEffect } from "react";
import type { RefObject } from "react";

import type { Doc } from "docblocks-core";

import type { SelectionRef } from "../../editor-provider";
import { containerCaretNeedsReseat, reseatContainerCaret } from "../page-surface";
import { domSelectionInEditable, mapDomSelection, selectionsEqual } from "../selection-mapping";

/**
 * Track the DOM selection into the view. The read-only stand (view /
 * published) stands no tracking: the mapping's editing path is off there
 * (the view mode's native range is mapped at copy time instead).
 */
function useSelectionTracking(
  doc: Doc,
  rootRef: RefObject<HTMLDivElement | null>,
  selectionRef: SelectionRef,
  viewMode: boolean
): void {
  useEffect(() => {
    if (viewMode) return;
    const onSelectionChange = () => {
      const root = rootRef.current;
      const view = selectionRef.view;
      if (root === null || view === null) return;
      // The page container's own caret (the transient stand over a gap
      // click / a remount residue): re-seat it into the nearest block's
      // edge before the mapping reads it (the reseat's own selectionchange
      // stands the mapping over the seated caret). Skipped over a `blocks`
      // view (the blocks selection's caret is parked, not a stranded one —
      // the reseat's inner landing would hand the mapping a text view
      // clobbering the blocks' stand).
      const pageContainer = root.querySelector<HTMLElement>("[data-slot='docblocks/page']");
      const pageSelection = window.getSelection();
      // The history's reseat window (the undo/redo's remount) owns the
      // post-remount carets: the container's re-seat must not race it
      // (its edge seat lands at the block's start while the history's
      // seat is the pre-gesture's, and the late transient would clobber
      // the corrected seat).
      if (
        pageContainer !== null &&
        view.get().kind !== "blocks" &&
        Date.now() >= selectionRef.reseatUntil.current &&
        pageSelection !== null &&
        pageSelection.isCollapsed &&
        containerCaretNeedsReseat(pageContainer, pageSelection.anchorNode)
      ) {
        reseatContainerCaret(pageContainer, root, doc);
        return;
      }
      const next = mapDomSelection(root, window.getSelection(), doc);
      const current = view.get();
      // A `blocks` view (the gutter / canvas selection) has no DOM
      // expression: a selection settling outside the editables (the canvas
      // chrome, the stale residue, a `none` mapping) cannot express it, so
      // the mapping never clobbers a blocks view there. A caret inside an
      // editable still wins (the page's gutter→text click); a gutter
      // selection is cleared by the explicit paths (Escape, a new
      // selection, the delete), not by the background click.
      if (current.kind === "blocks" && !domSelectionInEditable(window.getSelection())) return;
      // The canvas view's page miniature (the two-click contract): the
      // blocks (card) selection stands over the caret the second press
      // plants (the caret is the editing path, not a selection clobber).
      const anchorNode = window.getSelection()?.anchorNode ?? null;
      const anchorHost = anchorNode instanceof Element ? anchorNode : (anchorNode?.parentElement ?? null);
      if (anchorHost?.closest('[data-slot="docblocks/page-card"]') !== null) return;
      // The history reseat's window: the undo/redo's inverse may remount the
      // block, and the engine's selection stands the remount's transient
      // loss (the selectionchange over the commit reads the residue — the
      // none's stand, the engine's anchor's wander over the wrapper's
      // blocks' stand), not the user's clear. The window suppresses the
      // residue's non-text mapping (the user's clear stands the explicit
      // paths: the Escape, the editor's outside's focus, the gutter's
      // click's own set).
      if (next.kind !== "text" && Date.now() < selectionRef.reseatUntil.current) return;
      // The history reseat's window suppresses the remount's transient text
      // mapping too: the remount collapses the DOM selection to an
      // element-position anchor (the inner's edge, the row) that maps as a
      // text caret at the block's start and would clobber the restored
      // seat. A text-node anchor is a live seat (the user's or the
      // reseat's own) and stands.
      if (next.kind === "text" && Date.now() < selectionRef.reseatUntil.current) {
        const anchor = window.getSelection()?.anchorNode ?? null;
        if (anchor === null || anchor.nodeType !== Node.TEXT_NODE) return;
      }
      // The view emits even on no-op sets — only push a real change.
      if (!selectionsEqual(next, view.get())) view.set(next);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [doc, selectionRef, viewMode]);
}

export { useSelectionTracking };
