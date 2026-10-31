/** The canvas view's keyboard handlers: the mode switch (M), the group
 * hotkeys (Ctrl/Cmd+G / +Shift+G), the canvas clipboard (Ctrl/Cmd+C/V),
 * the arrow-key nudge, the canvas items' keyboard navigation (the arrows
 * over the selection's absence) + the Enter's selection, the canvas items'
 * delete (Delete/Backspace), the tools' cancel (Escape), and the held
 * space (the temporary pan). The
 * app-level hotkeys win over the editing surfaces (the isEditingSurface
 * guard keeps the text's own shortcuts). */
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

import type { BlockId, Doc } from "docblocks-core";

import {
  NUDGE_KEYS,
  copyCanvasItems,
  dissolveGroup,
  findParentSurface,
  firstSurface,
  makeGroup,
  nudgeDelta,
  nudgeGate,
  nudgeSelection,
  pasteCanvasItems,
  placeDragBox,
  screenToCanvas,
} from "../../canvas";
import type { CanvasViewportState } from "../../canvas";
import type { SelectionRef } from "../../editor-provider";
import type { EditorStore } from "../../state";
import type { CanvasPointerSession } from "./models";

interface CanvasKeysDeps {
  containerRef: RefObject<HTMLDivElement | null>;
  viewport: CanvasViewportState;
  sessionRef: RefObject<CanvasPointerSession | null>;
  selection: SelectionRef;
  doc: Doc;
  store: EditorStore;
  lastPointerRef: RefObject<{ x: number; y: number } | null>;
  setSpacePan: (value: boolean) => void;
  rootBlockId: BlockId;
  isEditingSurface: (target: EventTarget | null) => boolean;
}

function useCanvasKeys({
  containerRef,
  viewport,
  sessionRef,
  selection,
  doc,
  store,
  lastPointerRef,
  setSpacePan,
  rootBlockId,
  isEditingSurface,
}: CanvasKeysDeps): {
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onKeyUp: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
} {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // The same DOM-containment rule as the pointer handler: React's
    // synthetic events bubble through the fiber tree, so a key from a
    // portaled element (the shape toolbar's palette content, tabIndex
    // -1) reaches this handler with a target the container does not
    // contain — and would delete the selection (Delete / Backspace).
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    // The M key: the select mode (the mode's keyboard switch — the dock's
    // button icon shows the current mode, the hand is the pan). The app
    // level hotkey wins over the editing surfaces (the "m" stands no
    // character over the text); the live caret (the editing state) stands
    // the view — the focus parks on the container (the undo hotkey reach).
    if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.isContentEditable) {
        window.getSelection()?.removeAllRanges();
        active.blur();
        containerRef.current?.focus();
      }
      viewport.setMode("default");
      return;
    }
    if (isEditingSurface(event.target)) return;
    // The place session's shift: the 1:1 constraint's live toggle (the
    // preview re-stands from the session's last point over the new shift
    // state — the constraint stands / drops without a mouse move; the
    // release's commit stands the same box, the no-jump contract).
    if (event.key === "Shift") {
      const session = sessionRef.current;
      if (session !== null && session.kind === "place") {
        const box = placeDragBox(session.start, session.lastPoint, event.shiftKey);
        viewport.setPlacePreview({
          kind: session.tool === "container" ? "container" : "shape",
          variant: session.tool === "container" ? "rect" : session.tool,
          ...box,
        });
      }
      return;
    }
    // The group's hotkeys: Ctrl/Cmd+G
    // groups the multi selection (one transact — the makeGroup's null is
    // the no-op: the ineligible selection stands nothing),
    // Ctrl/Cmd+Shift+G dissolves the selected group (the members stand
    // where they are). The app-level hotkeys win over the editing surfaces
    // (the isEditingSurface guard above keeps the text's own shortcuts).
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
      const sel = selection.view?.get();
      if (sel?.kind !== "blocks") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        if (sel.ids.length !== 1) return;
        const id = sel.ids[0]!;
        if (dissolveGroup(doc, id)) selection.view?.set({ kind: "none" });
        return;
      }
      if (sel.ids.length < 2) return;
      const created = makeGroup(doc, sel.ids);
      if (created !== null) {
        // The group stands alone selected (its outline takes over the
        // selection's affordance; the members' selection stands no
        // summary box over the outline).
        selection.view?.set({ kind: "blocks", ids: [created], anchorId: created });
      }
      return;
    }
    // The canvas clipboard's hotkeys:
    // Ctrl/Cmd+C copies the selection's canvas items (the selection
    // stands — the copy clears nothing), Ctrl/Cmd+V pastes at the pointer
    // (the selection seats on the pasted; the snapshot stands the
    // undo/redo's selection contract). The app-level hotkeys win over the
    // editing surfaces (the isEditingSurface guard above keeps the
    // text's own copy / paste).
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
      const modKey = event.key.toLowerCase();
      if (modKey === "c") {
        const sel = selection.view?.get();
        if (sel?.kind !== "blocks" || sel.ids.length === 0) return;
        const clipboard = copyCanvasItems(doc, sel.ids);
        if (clipboard === null) return; // the non-copiable selection stands nothing
        event.preventDefault();
        event.stopPropagation();
        store.getState().setCanvasClipboard(clipboard);
        return;
      }
      if (modKey === "v") {
        const clipboard = store.getState().canvasClipboard;
        if (clipboard === null) return;
        const sel = selection.view?.get();
        event.preventDefault();
        event.stopPropagation();
        // The paste's target surface: the selection's first item's
        // surface, the doc's first surface over no canvas selection (the
        // paste stands the canvas even over the page's selection). The
        // surface-less stand creates the surface in its own transact (a
        // reachable only when every surface was removed between the copy
        // and the paste — the copy implies a surface stood).
        const surface = sel?.kind === "blocks" && sel.ids.length > 0 ? findParentSurface(doc, sel.ids[0]!) : null;
        const target = surface !== null ? surface : firstSurface(doc);
        // The pointer's world position (the last pointer's stand over the
        // paste's own zoom / pan; the viewport center over no pointer).
        const pointer = lastPointerRef.current ?? { x: 0, y: 0 };
        const center = screenToCanvas(pointer, viewport.zoom, viewport.pan);
        const pasted = pasteCanvasItems(doc, clipboard, target, center);
        if (pasted !== null && pasted.length > 0) {
          // The paste seats the selection on the pasted : the core's SelectionView restores the selection
          // over the undo / redo (each captured edit snapshots the selection
          // it started from — the paste's undo stands the previous
          // selection back, the redo re-seats the pasted).
          selection.view?.set({ kind: "blocks", ids: pasted, anchorId: pasted[0]! });
          containerRef.current?.focus();
        }
        return;
      }
    }
    // The arrow-key nudge: over the
    // canvas's blocks selection and no in-flight gesture — each press is
    // a real move (one setGeometry per item in one transact: one undo
    // step, one wire update; the selection stands on the same items).
    // The key stands over the container's own focus only (the hotkey's
    // context — the selection's hotkeys park there): the view's own
    // controls (the toolbar's width selector, the dock, the zoom) keep
    // their own arrows. The in-flight gestures own the keys (the move /
    // resize sessions, the pan / marquee / pen / placement, the endpoint
    // drag, the tool's pick); the page view and the editing surfaces keep
    // their own arrows (the isEditingSurface guard above). The key stands
    // swallowed — the page never scrolls over the arrows.
    if (
      (NUDGE_KEYS as readonly string[]).includes(event.key) &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      event.target === event.currentTarget
    ) {
      const sel = selection.view?.get();
      if (sel?.kind === "blocks" && sel.ids.length > 0) {
        if (
          nudgeGate(
            {
              move: viewport.moveSession,
              resize: viewport.resizeSession,
              pan: sessionRef.current !== null,
              endpoint: viewport.connectorEndpoint !== null,
              marquee: viewport.marquee !== null,
              pen: viewport.penPoints.length > 0,
              place: viewport.placePreview !== null,
              tool: viewport.activeTool !== null,
              pending: viewport.pendingConnector !== null || viewport.pendingFree !== null,
            },
            sel
          )
        ) {
          const delta = nudgeDelta(event.key, event.shiftKey);
          if (delta !== null) {
            event.preventDefault();
            event.stopPropagation();
            nudgeSelection(doc, sel.ids, delta.dx, delta.dy);
          }
        }
        return;
      }
      // The selection stands none: the arrows move the keyboard focus over
      // the canvas items (the DOM's paint order, the wrap stand) — the
      // Enter selects the focused item, the selection's arrows stand the
      // nudge over it.
      const items = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>("[data-slot='docblocks/canvas-item']")
      )
        .map((el) => el.dataset.blockId)
        .filter((id): id is string => id !== undefined);
      if (items.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
      const current = viewport.kbFocusId;
      const idx = current !== null ? items.indexOf(current) : forward ? -1 : 0;
      viewport.setKbFocusId(items[(idx + (forward ? 1 : -1) + items.length) % items.length] ?? null);
      return;
    }
    // The Enter: the keyboard selection (the kb-focused item stands the
    // shared blocks selection — the pointer click's parity). The key stands
    // over the container's own focus (the hotkey's context — the view's own
    // controls keep their own Enter).
    if (
      event.key === "Enter" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      event.target === event.currentTarget
    ) {
      const id = viewport.kbFocusId;
      if (id === null || doc.getBlock(id) === null) return;
      event.preventDefault();
      event.stopPropagation();
      selection.view?.set({ kind: "blocks", ids: [id], anchorId: id });
      return;
    }
    // The canvas items' delete (the page's removeBlocksSelection path
    // stands the root's page sequence — the canvas items are not in it).
    // A mixed selection bubbles to the editor root's handler.
    if ((event.key === "Delete" || event.key === "Backspace") && deleteCanvasSelection()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      event.key === "Escape" &&
      (viewport.activeTool !== null || viewport.pendingConnector !== null || viewport.pendingFree !== null)
    ) {
      // The canvas tools' cancel (the page's Escape clears the selection —
      // the tool cancels first, the selection stands).
      event.stopPropagation();
      viewport.setActiveTool(null);
      viewport.setPendingStand(null);
      viewport.setPenPoints([]);
      viewport.setPlacePreview(null);
      viewport.setConnectorPreview(null);
      sessionRef.current = null;
      return;
    }
    if (event.key === "Escape" && viewport.movePreview !== null) {
      // The in-flight move's cancel: the preview is dropped, nothing is
      // written, the selection stands.
      event.stopPropagation();
      viewport.cancelMove();
      return;
    }
    if (event.key === "Escape" && viewport.connectorEndpoint !== null) {
      // The in-flight endpoint drag's cancel (the same contract as the
      // move's: the preview is dropped, nothing is written).
      event.stopPropagation();
      viewport.cancelConnectorEndpoint();
      return;
    }
    if (event.key === "Escape" && viewport.resizePreview !== null) {
      // The in-flight resize's cancel (the same contract as the
      // move's: the preview is dropped, nothing is written).
      event.stopPropagation();
      viewport.cancelResize();
      return;
    }
    if (event.key === " " && !event.repeat) {
      // The held space: the temporary pan (Miro's hand).
      setSpacePan(true);
    }
  };

  // The pure-canvas selection delete: every selected id is a direct
  // surface child → one transact of removeBlock (the core cascades a
  // frame's nested content). Returns false for a non-canvas selection
  // (the page path owns it).
  const deleteCanvasSelection = (): boolean => {
    const sel = selection.view?.get();
    if (sel?.kind !== "blocks" || sel.ids.length === 0) return false;
    const surfaceChildren: BlockId[][] = [];
    for (const childId of doc.getChildren(rootBlockId)) {
      if (doc.getBlock(childId)?.type === "surface") surfaceChildren.push(doc.getChildren(childId));
    }
    if (!sel.ids.every((id) => surfaceChildren.some((list) => list.includes(id)))) return false;
    const ids = [...sel.ids];
    doc.transact(() => {
      for (const id of ids) {
        if (doc.getBlock(id) === null) continue; // a previous cascade took it
        doc.removeBlock(id);
      }
    });
    selection.view?.set({ kind: "none" });
    containerRef.current?.focus();
    return true;
  };

  const onKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === " ") {
      setSpacePan(false);
      return;
    }
    // The place session's shift's release: the 1:1 constraint's live drop
    // (the preview re-stands free over the session's last point — the
    // same contract as the keydown's stand, the no-jump on release).
    if (event.key === "Shift") {
      const session = sessionRef.current;
      if (session !== null && session.kind === "place") {
        const box = placeDragBox(session.start, session.lastPoint, event.shiftKey);
        viewport.setPlacePreview({
          kind: session.tool === "container" ? "container" : "shape",
          variant: session.tool === "container" ? "rect" : session.tool,
          ...box,
        });
      }
      return;
    }
  };

  return { onKeyDown, onKeyUp };
}

export { useCanvasKeys };
