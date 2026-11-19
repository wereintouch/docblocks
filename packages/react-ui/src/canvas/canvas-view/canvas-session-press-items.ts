/** The canvas container's ITEM press branches (the pointerdown's second
 * half): the editing surfaces (the canvas-text's shape-press contract, the
 * page miniature's caret), the resize handles, the connector's hit path,
 * the canvas items (the group-aware selection + the move's begin), the
 * page card's move (the scrollbar's strip guard), the container's
 * interior (the innermost group's stand), and the marquee's fallback.
 * Each branch returns whether the press was handled. */
import type { PointerEvent as ReactPointerEvent } from "react";

import type { BlockId } from "docblocks-core";

import { screenToCanvas } from "../../canvas";
import type { ResizeHandle } from "../../canvas";
import { effectiveGeometry } from "../geometry";
import type { CanvasSessionContext } from "./canvas-session-context";
import { SCROLLBAR_GUARD_PX } from "./constants";
import { toggleCanvasSelection } from "./utils";

/** The editing surfaces' press: the canvas-text stands the SHAPE's press contract (the drag-to-move's parity — the single press selects the block, the shift press toggles the additive selection), the page miniature's content keeps the caret (the non-editing card areas move the root). */
function editingSurfacePress(ctx: CanvasSessionContext, event: ReactPointerEvent<HTMLDivElement>): boolean {
  if (!ctx.isEditingSurface(event.target)) return false;
  // The editing surfaces outside the page miniature keep the plain
  // caret press (the frame's content, the shape's inline text edit);
  // the page miniature's content and the canvas-text's inner stand
  // their own contracts. The canvas-text stands the SHAPE's press
  // contract (the drag-to-move's parity): the single press selects
  // the block (the one-item selection + the move session — the drag
  // moves it, no caret — the caret stands only on the double-click),
  // the shift press toggles the additive selection.
  const canvasTextItem =
    event.target instanceof Element ? event.target.closest<HTMLElement>('[data-slot="docblocks/canvas-item"]') : null;
  const canvasTextId = canvasTextItem?.getAttribute("data-block-id") ?? null;
  if (canvasTextId !== null && ctx.blocks[canvasTextId]?.type === "canvas-text") {
    if (event.shiftKey) {
      // The shift toggle (the item's parity — no move session):
      // the focus parks on the container (the keys reach the view).
      ctx.containerRef.current?.focus();
      if (ctx.selection.view !== null) toggleCanvasSelection(ctx.selection.view, canvasTextId);
      return true;
    }
    const sel = ctx.selection.view?.get();
    const ids = sel?.kind === "blocks" && sel.ids.includes(canvasTextId) ? sel.ids : [canvasTextId];
    event.preventDefault();
    ctx.containerRef.current?.focus();
    ctx.selection.view?.set({ kind: "blocks", ids, anchorId: canvasTextId });
    ctx.viewport.beginMove(ids, event.clientX, event.clientY);
    // The compatibility mousedown's preventDefault's stand (the press
    // suppresses the mousedown's default — the caret / the native text
    // selection stand off over the press).
    ctx.cardPressRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    return true;
  }
  if (ctx.isPageCard(event.target) && !event.shiftKey) {
    const sel = ctx.selection.view?.get();
    if (sel?.kind === "blocks" && sel.ids.includes(ctx.rootBlockId)) return true; // the caret
    event.preventDefault();
    ctx.containerRef.current?.focus();
    ctx.selection.view?.set({ kind: "blocks", ids: [ctx.rootBlockId], anchorId: ctx.rootBlockId });
    ctx.viewport.beginMove([ctx.rootBlockId], event.clientX, event.clientY);
    ctx.cardPressRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    return true;
  }
  return true;
}

/** The resize handles' press (the single-selection overlay): the press starts the session (the pan mode / the held space stand before this — space+drag over a handle pans). The press is prevented (the same contract as the pan / page-card branches): the compatibility mousedown's default stands no caret / native text selection — the resize drag over the shape's text overlay (or the page card's editable content under the item) stands no selection. The focus parks on the container (the preventDefault drops the default focus change — the keydown reach stands). */
function handlePress(ctx: CanvasSessionContext, event: ReactPointerEvent<HTMLDivElement>): boolean {
  const handle =
    event.target instanceof Element
      ? (event.target.closest<HTMLElement>('[data-slot="docblocks/canvas-handle"]') ?? null)
      : null;
  if (handle === null || ctx.handleTarget === null) return false;
  event.preventDefault();
  ctx.containerRef.current?.focus();
  const resizeHandle = handle.dataset.handle as ResizeHandle | undefined;
  if (resizeHandle !== undefined)
    ctx.viewport.beginResize(ctx.handleTarget.id, resizeHandle, event.clientX, event.clientY);
  event.currentTarget.setPointerCapture?.(event.pointerId);
  return true;
}

/** The connector's hit path's press (the wide transparent stroke): the press stands the line's press, not the item's — the line stands inside the connector's own canvas-item wrapper (the z-order's paint stand), so the hit check stands BEFORE the item's (a capture-less select: the connectors carry no geometry — the line follows the endpoint blocks, and the capture-less press keeps the line's double-click on the hit path — the label's inline edit's entry). */
function connectorHitPress(ctx: CanvasSessionContext, event: ReactPointerEvent<HTMLDivElement>): boolean {
  const connectorHit =
    event.target instanceof Element ? event.target.closest<SVGElement>("[data-connector-hit]") : null;
  if (connectorHit === null) return false;
  const id = connectorHit.getAttribute("data-connector-hit");
  if (id !== null) {
    if (event.shiftKey) {
      // The shift toggle (the same contract as the item's: no move —
      // the connectors carry no geometry at all).
      ctx.containerRef.current?.focus();
      if (ctx.selection.view !== null) toggleCanvasSelection(ctx.selection.view, id);
      return true;
    }
    const sel = ctx.selection.view?.get();
    const ids = sel?.kind === "blocks" && sel.ids.includes(id) ? sel.ids : [id];
    ctx.selection.view?.set({ kind: "blocks", ids, anchorId: id });
    ctx.containerRef.current?.focus();
  }
  return true;
}

/** The canvas item's press: the group-aware selection (an item inside the current block selection keeps the group — the group is what moves; otherwise it stands alone) + the move's begin. The check stands BEFORE the page-card guard: an item paints over the card, so a press on it is an item press (not a card press). The press is prevented (the same contract as the pan / page-card / handle branches): the move drag over the page card's editable content under the pointer stands no native text selection; the focus parks on the container. */
function itemPress(ctx: CanvasSessionContext, event: ReactPointerEvent<HTMLDivElement>): boolean {
  const item =
    event.target instanceof Element ? event.target.closest<HTMLElement>('[data-slot="docblocks/canvas-item"]') : null;
  if (item === null) return false;
  const id = item.getAttribute("data-block-id");
  if (id === null) return false;
  if (event.shiftKey) {
    // The shift toggle (no move session — the selection stands; the
    // focus parks on the container so the keys reach the view).
    ctx.containerRef.current?.focus();
    if (ctx.selection.view !== null) toggleCanvasSelection(ctx.selection.view, id);
    return true;
  }
  const sel = ctx.selection.view?.get();
  const ids = sel?.kind === "blocks" && sel.ids.includes(id) ? sel.ids : [id];
  ctx.selection.view?.set({ kind: "blocks", ids, anchorId: id });
  event.preventDefault();
  ctx.containerRef.current?.focus();
  ctx.viewport.beginMove(ids, event.clientX, event.clientY);
  event.currentTarget.setPointerCapture?.(event.pointerId);
  return true;
}

/** The page card's press (the non-editing areas): the shift press stands the selection (the additive contract — no root move, no clear); the card's native thin scrollbar strip belongs to the scrollbar drag (the press's strip guard); otherwise the page miniature moves from its non-editing areas (the content keeps the caret) — the one-item selection + move session over the root. */
function pageCardPress(ctx: CanvasSessionContext, event: ReactPointerEvent<HTMLDivElement>): boolean {
  if (!ctx.isPageCard(event.target)) return false;
  if (event.shiftKey) {
    // The shift press stands the selection (the additive contract —
    // no root move, no clear).
    return true;
  }
  // The card's scroll element is the card itself (the consumer
  // data-slot stands on the ScrollArea's root div).
  const card =
    event.target instanceof Element
      ? (event.target.closest('[data-slot="docblocks/page-card"]') as HTMLElement | null)
      : null;
  if (card !== null && card.scrollHeight > card.clientHeight) {
    // The card's native thin scrollbar strip (non-contenteditable):
    // the press belongs to the scrollbar drag, not the card move.
    const rect = card.getBoundingClientRect();
    const inStrip = event.clientX > rect.right - SCROLLBAR_GUARD_PX || event.clientY > rect.bottom - SCROLLBAR_GUARD_PX;
    if (inStrip) return true;
  }
  containerRefFocusSelect(ctx, ctx.rootBlockId);
  ctx.viewport.beginMove([ctx.rootBlockId], event.clientX, event.clientY);
  ctx.cardPressRef.current = true;
  event.currentTarget.setPointerCapture?.(event.pointerId);
  return true;
}

/** The one-item selection's set + the container's focus (the page card / the container interior's press's shared stand). */
function containerRefFocusSelect(ctx: CanvasSessionContext, id: BlockId): void {
  ctx.containerRef.current?.focus();
  ctx.selection.view?.set({ kind: "blocks", ids: [id], anchorId: id });
}

/** The container's EMPTY-interior press: a press that lands on no figure / handle / connector (the branches above caught those) but INSIDE a container's box stands the container (the INNERMOST — the smallest box standing the point, the nesting's deepest) + the move session (the drag moves the container, the border's contract). A press ON a figure still stands the figure (the item's branch) — the interior is pointer-transparent. The marquee stands only off the containers. */
function containerInteriorPress(
  ctx: CanvasSessionContext,
  event: ReactPointerEvent<HTMLDivElement>,
  point: { x: number; y: number }
): boolean {
  const canvasPoint = screenToCanvas(point, ctx.viewport.zoom, ctx.viewport.pan);
  const surfaceOrder = ctx.doc.getChildren(ctx.doc.meta.id);
  let innermost: { id: string; area: number } | null = null;
  for (const surfaceId of surfaceOrder) {
    const surface = ctx.doc.getBlock(surfaceId);
    if (surface === null || surface.type !== "surface") continue;
    for (const childId of ctx.doc.getChildren(surfaceId)) {
      const block = ctx.doc.getBlock(childId);
      if (block === null || block.type !== "group") continue;
      const box = effectiveGeometry(block);
      if (
        canvasPoint.x >= box.x - box.w / 2 &&
        canvasPoint.x <= box.x + box.w / 2 &&
        canvasPoint.y >= box.y - box.h / 2 &&
        canvasPoint.y <= box.y + box.h / 2
      ) {
        const area = box.w * box.h;
        if (innermost === null || area < innermost.area) innermost = { id: childId, area };
      }
    }
  }
  const containerId = innermost?.id ?? null;
  if (containerId === null) return false;
  if (event.shiftKey) {
    ctx.containerRef.current?.focus();
    if (ctx.selection.view !== null) toggleCanvasSelection(ctx.selection.view, containerId);
    return true;
  }
  event.preventDefault();
  containerRefFocusSelect(ctx, containerId);
  ctx.viewport.beginMove([containerId], event.clientX, event.clientY);
  event.currentTarget.setPointerCapture?.(event.pointerId);
  return true;
}

/** The marquee's fallback (the press stood nothing else): the additive press (the shift down) extends the selection's union. */
function marqueePress(
  ctx: CanvasSessionContext,
  event: ReactPointerEvent<HTMLDivElement>,
  point: { x: number; y: number }
): void {
  ctx.sessionRef.current = { kind: "marquee", additive: event.shiftKey };
  ctx.viewport.setMarquee({ start: point, end: point });
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

export {
  connectorHitPress,
  containerInteriorPress,
  editingSurfacePress,
  handlePress,
  itemPress,
  marqueePress,
  pageCardPress,
};
