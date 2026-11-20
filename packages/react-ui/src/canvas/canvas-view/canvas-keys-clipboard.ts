/** The canvas view's clipboard hotkeys (Ctrl/Cmd+C / +V): the copy stands
 * the selection's canvas items (the selection stays), the paste lands the
 * copy at the pointer over the target surface and seats the selection on the
 * pasted (the core's SelectionView restores the selection over the undo /
 * redo). The app-level hotkeys win over the editing surfaces (the caller
 * guards the text inners' own copy / paste). */
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

import type { Doc } from "docblocks-core";

import { copyCanvasItems, findParentSurface, firstSurface, pasteCanvasItems, screenToCanvas } from "../../canvas";
import type { CanvasViewportState } from "../../canvas";
import type { SelectionRef } from "../../editor-provider";
import type { EditorStore } from "../../state";

interface CanvasClipboardDeps {
  viewport: CanvasViewportState;
  selection: SelectionRef;
  doc: Doc;
  store: EditorStore;
  containerRef: RefObject<HTMLDivElement | null>;
  lastPointerRef: RefObject<{ x: number; y: number } | null>;
}

/** The copy / paste's handler: true when the key was consumed. */
function handleCanvasClipboard(deps: CanvasClipboardDeps, event: ReactKeyboardEvent<HTMLDivElement>): boolean {
  const { viewport, selection, doc, store, containerRef, lastPointerRef } = deps;
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return false;
  const modKey = event.key.toLowerCase();
  if (modKey === "c") {
    const sel = selection.view?.get();
    if (sel?.kind !== "blocks" || sel.ids.length === 0) return false;
    const clipboard = copyCanvasItems(doc, sel.ids);
    if (clipboard === null) return false; // the non-copiable selection stands nothing
    event.preventDefault();
    event.stopPropagation();
    store.getState().setCanvasClipboard(clipboard);
    return true;
  }
  if (modKey !== "v") return false;
  const clipboard = store.getState().canvasClipboard;
  if (clipboard === null) return false;
  const sel = selection.view?.get();
  event.preventDefault();
  event.stopPropagation();
  // The paste's target surface: the selection's first item's surface, the
  // doc's first surface over no canvas selection (the paste stands the
  // canvas even over the page's selection). The surface-less stand creates
  // the surface in its own transact — reachable only when every surface was
  // removed between the copy and the paste (the copy implies a surface
  // stood).
  const surface = sel?.kind === "blocks" && sel.ids.length > 0 ? findParentSurface(doc, sel.ids[0]!) : null;
  const target = surface !== null ? surface : firstSurface(doc);
  // The pointer's world position (the last pointer's stand over the paste's
  // own zoom / pan; the viewport center over no pointer).
  const pointer = lastPointerRef.current ?? { x: 0, y: 0 };
  const center = screenToCanvas(pointer, viewport.zoom, viewport.pan);
  const pasted = pasteCanvasItems(doc, clipboard, target, center);
  if (pasted !== null && pasted.length > 0) {
    // The pasted block: the core's SelectionView restores the selection over
    // the undo / redo (each captured edit snapshots the selection it started
    // from — the paste's undo stands the previous selection back, the redo
    // re-seats the pasted).
    selection.view?.set({ kind: "blocks", ids: pasted, anchorId: pasted[0]! });
    containerRef.current?.focus();
  }
  return true;
}

export { handleCanvasClipboard };
export type { CanvasClipboardDeps };
