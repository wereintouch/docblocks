/** The canvas container's press branches (the pointerdown's second half)
 * that stand on the DOM target: the editing surfaces (the caret, the page
 * miniature's two-click contract), the resize handles, the page card's move
 * (the scrollbar's strip guard), the container's interior (the innermost
 * group's stand), the screen chip's press, and the marquee's fallback. The
 * block selection itself stands the hit resolver (the geometry's answer —
 * `surfacePress`). Each branch returns whether the press was handled. */
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
  // The editing surface keeps the caret (the shape's inline text edit, the
  // canvas-text's edit session, the label's input); the page miniature's
  // content stands its own two-click contract (the first press starts the
  // card's move, the press over the already selected card seats the caret).
  // The non-editing presses of a canvas-text stand the hit resolver's
  // selection (the shape's press contract — the drag moves the block).
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

/** The title chip's press (the screen layer's chip — the container / frame
 * title's own target, outside the box so the item's DOM press never sees
 * it): the item's press contract — the shift toggles the additive
 * selection without a move, a press over a block among the current
 * multi-selection keeps the whole selection (the unit is what moves),
 * otherwise the chip's block stands alone; the move session begins, the
 * focus parks on the container, and the pointer capture stands (the
 * release commits the move). The press is swallowed: the branches below
 * the item's (the container's interior) must not stand a second
 * selection. */
function chipPress(ctx: CanvasSessionContext, event: ReactPointerEvent<HTMLDivElement>, id: BlockId): boolean {
  event.stopPropagation();
  if (event.button !== 0) return false;
  // The read-only stand (view / published): the chip is inert.
  if (ctx.viewMode) return false;
  event.preventDefault();
  if (event.shiftKey) {
    ctx.containerRef.current?.focus();
    if (ctx.selection.view !== null) toggleCanvasSelection(ctx.selection.view, id);
    return true;
  }
  const sel = ctx.selection.view?.get();
  const ids = sel?.kind === "blocks" && sel.ids.includes(id) ? sel.ids : [id];
  ctx.selection.view?.set({ kind: "blocks", ids, anchorId: id });
  ctx.containerRef.current?.focus();
  ctx.viewport.beginMove(ids, event.clientX, event.clientY);
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

export { chipPress, containerInteriorPress, editingSurfacePress, handlePress, marqueePress, pageCardPress };
