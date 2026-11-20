/** The editor root's page-flow mousedown guard (the span model's native
 *  selection suppression) and the triple press's whole-block select — the
 *  module-level capture listeners, off over the read-only stand. */
import { useEffect } from "react";
import type { RefObject } from "react";

import type { BlockId, Doc } from "docblocks-core";

import { locatePosition } from "../dom-offset";
import { isPageSurfaceInner } from "../page-surface";

/**
 * The page flow's mousedown guard (the span model): the page container is
 * one shared editable, and over it the browser's native selection gesture
 * (the mousedown's default) outruns the user-select none (the editable's
 * selection stands over the grid's cells' display, the header's chrome,
 * the figure's frame — the drag's text's selection). The default is
 * suppressed over the island's chrome (the press's handlers own the
 * gesture); the controls (their focus stand) and the islands' own editables
 * (the cells' inners — the native editing stands, the word/line's select
 * over them) keep their defaults. The page's text inners stand the
 * session's own guard (the single press's suppression, the multi-click's
 * native word/line's select).
 */
function usePageMousedownGuard(rootRef: RefObject<HTMLElement | null>, readOnly: boolean): void {
  useEffect(() => {
    if (readOnly) return;
    const guard = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root === null || event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target === null || !root.contains(target)) return;
      if (document.activeElement instanceof HTMLIFrameElement) return;
      if (target.closest('[data-slot="docblocks/page"]') === null) return;
      const control = target.closest("input, textarea, select, button");
      if (control !== null) return;
      const island = target.closest('[contenteditable="false"]');
      const editable = target.closest('[contenteditable="true"]');
      if (island !== null && editable !== null && island.contains(editable)) return;
      // The focus over the island's own editable or form control (the
      // cell's input's draft, the cell's inner): the default's suppression
      // would keep the focus (the blur's commit stands no), so the default
      // runs (the blur's commit, the native editing over the cell's own
      // editable). The island's focusable chrome (the table's focus) is
      // not the island's editable: its nearest editable is the shared page
      // container, and the default's suppression stands over it.
      const active = document.activeElement;
      const activeIsland = active instanceof HTMLElement ? active.closest('[contenteditable="false"]') : null;
      const activeEditable = active instanceof HTMLElement ? active.closest('[contenteditable="true"]') : null;
      if (
        active instanceof HTMLElement &&
        (active.matches("input, textarea") ||
          (activeIsland !== null && activeEditable !== null && activeIsland.contains(activeEditable)))
      )
        return;
      // The island's chrome (the grid's cells' display, the table's
      // frame, the header's chrome): the native selection's gesture
      // stands no — over the shared editable the user-select none loses.
      if (island === null && editable instanceof HTMLElement && isPageSurfaceInner(editable)) return; // the page's text inner: the session's guard stands
      event.preventDefault();
      // The focus's park (the keys' reach): the suppressed default dropped
      // the browser's focus move; a focus standing outside the editor
      // would leave the keys landing on nothing (the detached's button
      // over the menu's close). The editor root takes it (a non-editable
      // focus does not touch the selection).
      const a = document.activeElement;
      if (a === null || !root.contains(a)) root.focus();
    };
    window.addEventListener("mousedown", guard, true);
    return () => window.removeEventListener("mousedown", guard, true);
  }, [rootRef, readOnly]);
}

/**
 * The triple press's whole-block select: the browser's "paragraph" select
 * of a pre-wrap block stands at one visual line (the soft-break lines), so
 * a detail-3 press inside a text inner is suppressed and the editor stands
 * the whole-block selection (all the soft-break lines) itself — a
 * permanent capture listener, independent of the session (the real
 * pointer's third press starts no session: the pointer's detail stands 3
 * and the session guard returns).
 */
function useTripleSelect(rootRef: RefObject<HTMLElement | null>, doc: Doc, readOnly: boolean): void {
  useEffect(() => {
    if (readOnly) return;
    const triple = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root === null || event.button !== 0 || event.detail < 3) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target === null || !root.contains(target)) return;
      const inner = target.closest<HTMLElement>('[data-slot="docblocks/block-content"]');
      if (inner === null || inner.closest('[data-slot="docblocks/editor"]') !== root) return;
      // The iframe's focus stand (the mousedown's tear-down's parity):
      // the default's suppression would keep the document's focus in the
      // frame (the seat's no-stand over the unfocused document), so the
      // browser's native paragraph's select + the focus's move stand.
      if (document.activeElement instanceof HTMLIFrameElement) return;
      const blockId = inner.dataset.blockId as BlockId;
      const head = locatePosition(inner, 0);
      const tail = locatePosition(inner, doc.getTextLength(blockId));
      event.preventDefault();
      window.getSelection()?.setBaseAndExtent(head.node, head.offset, tail.node, tail.offset);
    };
    window.addEventListener("mousedown", triple, true);
    return () => window.removeEventListener("mousedown", triple, true);
  }, [rootRef, doc, readOnly]);
}

export { usePageMousedownGuard, useTripleSelect };
