/** The canvas content's DOUBLE-CLICK handler: the ghost text block (the
 * empty canvas's default-mode entry), the canvas-text's edit entry (the
 * shape's text entry's parity), the shape's text inline edit, the
 * connector's LABEL inline edit, the container's / the frame's TITLE
 * inline edit, and the page miniature's blank body's selection clear.
 * The press's pointer capture retargets the dblclick to the container —
 * the event's target is the container, not the item — so each entry
 * stands the point's element (the elementFromPoint's hit test through the
 * world's transform, the target's element as the fallback). */
import type { MouseEvent as ReactMouseEvent } from "react";

import type { BlockId } from "docblocks-core";

import { screenToCanvas } from "../../canvas";
import { focusCaretInElement } from "../../editing/block-commands";
import type { CanvasSessionContext } from "./canvas-session-context";
import { pressHitAt } from "./hit-stack";

/** The container's / the frame's TITLE chip (the inline edit's dblclick's target). */
const TITLE_CHIP_SELECTOR = "[data-slot='docblocks/group-title'], [data-slot='docblocks/frame-title']";

/** The point's element (the elementFromPoint's hit — the capture-retargeting's stand) with the event's target as the fallback (elementFromPoint stands null where it cannot resolve the point — the jsdom / the inert surface's stand; the event's target is the press's element then). */
function pointElementOf(event: ReactMouseEvent<HTMLDivElement>): Element | null {
  return (
    (typeof document.elementFromPoint === "function"
      ? document.elementFromPoint(event.clientX, event.clientY)
      : null) ?? (event.target instanceof Element ? event.target : null)
  );
}

/** The title chip's double-click: the title's inline edit (the chip's own
 * target — the chip stands in the screen layer outside the box, so the
 * container's double-click handler never sees it). Only the chip itself
 * enters the edit: the inline edit's input and the set-title menu keep
 * their native double-click (the word selection). The edit needs a title
 * (the empty title stands no editor); the read-only stand keeps the chip
 * inert. The event never reaches the container's entries (the ghost text,
 * the inline edits) — the chip stands outside the item's wrapper. */
function chipDoubleClick(ctx: CanvasSessionContext, id: BlockId, event: ReactMouseEvent<HTMLDivElement>): void {
  // The inline edit's input keeps its native double-click (the word
  // selection): the press's pointer capture retargets the chip's own
  // double-click to the seat, so the input is the only stand that needs
  // the default.
  const onEditInput = event.target instanceof Element && event.target.closest("input") !== null;
  event.stopPropagation();
  if (onEditInput) return;
  event.preventDefault();
  if (ctx.viewMode) return;
  const block = ctx.doc.getBlock(id);
  if (block === null || (block.type !== "group" && block.type !== "frame")) return;
  if ((block.attrs?.title ?? "") === "") return;
  ctx.viewport.setShapeTextEditing(id);
}

function createContentDoubleClick(ctx: CanvasSessionContext): (event: ReactMouseEvent<HTMLDivElement>) => void {
  return (event: ReactMouseEvent<HTMLDivElement>): void => {
    // The read-only stand (view / published): the double press's entry's
    // stand (the ghost's text's, the canvas-text's edit's, the shape's
    // text's, the label's) stands off.
    if (ctx.viewMode) return;
    // The ghost text block's entry (the double-click on the EMPTY canvas —
    // the default mode with no active tool): the focused contenteditable
    // stands at the point (the world's space — the ghost's component's
    // render) with the blinking caret; nothing is written until the
    // first input. The point's element stands the capture-retargeting
    // (the dblclick's target may be the container) and the guards: the
    // canvas's own content with no stand of its own (no page card, no
    // item, no line's hit path, no title chip), no chrome, no ghost
    // re-entry.
    if (ctx.viewport.mode === "default" && ctx.viewport.activeTool === null) {
      const dblElement = pointElementOf(event);
      if (
        dblElement instanceof Element &&
        event.currentTarget.contains(dblElement) &&
        dblElement.closest('[data-slot="docblocks/canvas-chrome"]') === null &&
        dblElement.closest('[data-slot="docblocks/canvas-text-ghost"]') === null &&
        dblElement.closest('[data-slot="docblocks/canvas-item"]') === null &&
        dblElement.closest('[data-slot="docblocks/page-card"]') === null &&
        dblElement.closest("[data-connector-hit]") === null &&
        dblElement.closest(TITLE_CHIP_SELECTOR) === null
      ) {
        event.preventDefault();
        ctx.viewport.setPendingText(
          screenToCanvas(ctx.centerRelativePoint(event), ctx.viewport.zoom, ctx.viewport.pan)
        );
        return;
      }
    }
    // The canvas-text's double-click (the shape's text entry's parity):
    // the single press stands the selection (no caret — the press's
    // contract), the dblclick enters the edit: the item's selection +
    // the caret at the point's offset (the caret-position API's offset
    // over the inner, the start stand over the unresolved point). The
    // capture-retargeting stand: the press's pointer capture retargets
    // the dblclick to THIS container, so the item stands the point's
    // element (the target's element as the fallback — the inert stand).
    const canvasTextDblElement = pointElementOf(event);
    const canvasTextDblItem =
      canvasTextDblElement instanceof Element
        ? canvasTextDblElement.closest<HTMLElement>('[data-slot="docblocks/canvas-item"]')
        : null;
    const canvasTextDblId = canvasTextDblItem?.getAttribute("data-block-id") ?? null;
    if (canvasTextDblId !== null && ctx.blocks[canvasTextDblId]?.type === "canvas-text") {
      event.preventDefault();
      const sel = ctx.selection.view?.get();
      const ids = sel?.kind === "blocks" && sel.ids.includes(canvasTextDblId) ? sel.ids : [canvasTextDblId];
      ctx.selection.view?.set({ kind: "blocks", ids, anchorId: canvasTextDblId });
      const inner = canvasTextDblItem?.querySelector<HTMLElement>("[data-slot='docblocks/block-content']") ?? null;
      let offset = 0;
      if (inner !== null) {
        // The caret-position API's stand (the jsdom's null stand — the
        // caret's start over the unresolved point; the nullish check
        // stands the jsdom's undefined stand over the method).
        const pointCaret = document.caretPositionFromPoint?.(event.clientX, event.clientY);
        if (pointCaret != null && inner.contains(pointCaret.offsetNode)) {
          offset = pointCaret.offset;
        } else {
          const range = document.caretRangeFromPoint?.(event.clientX, event.clientY); // deprecation-allow: the Firefox caret-offset fallback (Chrome/Safari stand caretPositionFromPoint)
          if (range != null && inner.contains(range.startContainer)) {
            const pre = document.createRange();
            pre.selectNodeContents(inner);
            pre.setEnd(range.startContainer, range.startOffset);
            offset = pre.toString().length;
          }
        }
      }
      // The edit session's open (the inner's contentEditable's stand —
      // the stray focus's stand over the inert inner), then the caret's
      // seat over the EXACT inner (the elementFromPoint's hit — the
      // frame's window's inert copy stands the same id over the id's
      // query, the pointer-events-none's copy stands no hit). The
      // session's re-render commits before the frame's focus (the inner's
      // editable's stand by the seat's moment).
      ctx.viewport.setCanvasTextEditing(canvasTextDblId);
      if (inner !== null) {
        focusCaretInElement(inner, offset);
      }
      return;
    }
    // The line's double-click stands the label's edit: the press resolver's
    // top candidate (the line's stroke band along its rendered route, the
    // paint order's stand — a figure over the line takes its own entries
    // first). One geometry stands the press and the label's entry alike.
    const labelWorld = screenToCanvas(ctx.centerRelativePoint(event), ctx.viewport.zoom, ctx.viewport.pan);
    const labelCandidate = pressHitAt(ctx.doc, labelWorld, ctx.viewport.zoom);
    if (labelCandidate !== null && labelCandidate.type === "connector") {
      ctx.viewport.setConnectorLabelEditing(labelCandidate.id);
      return;
    }
    // The container's / the frame's TITLE inline edit (the chip's
    // double-click): the same capture-retargeting stand as the shape's text
    // — the press's pointer capture retargets the dblclick to THIS
    // container, so the chip is found through the point's element (the
    // chip's item id stands the inline-edit id).
    const titleChipFromTarget =
      event.target instanceof Element ? event.target.closest<HTMLElement>(TITLE_CHIP_SELECTOR) : null;
    let titleChip = titleChipFromTarget;
    if (titleChip === null && typeof document.elementFromPoint === "function") {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      titleChip = element instanceof Element ? element.closest<HTMLElement>(TITLE_CHIP_SELECTOR) : null;
    }
    if (titleChip !== null) {
      // The chip carries its own block id (the screen layer's chip stands
      // outside the item's wrapper; the in-item copies keep standing
      // inside it).
      const itemId =
        titleChip.getAttribute("data-block-id") ??
        titleChip.closest<HTMLElement>("[data-slot='docblocks/canvas-item']")?.getAttribute("data-block-id") ??
        null;
      if (itemId !== null) ctx.viewport.setShapeTextEditing(itemId);
      return;
    }
    // The page miniature's blank body (no block under the point): a
    // double-click stands no selection. The single-press select stands (the
    // move session's affordance), but the dblclick clears it — the empty
    // area stands nothing. The card's content keeps its contracts (the
    // two-click caret, the block's own gestures). The point's element stands
    // the capture-retargeting (the dblclick's target may be the container).
    if (typeof document.elementFromPoint === "function") {
      const dblElement = document.elementFromPoint(event.clientX, event.clientY);
      if (
        dblElement instanceof Element &&
        dblElement.closest('[data-slot="docblocks/page-card"]') !== null &&
        dblElement.closest('[data-slot="docblocks/block"]') === null
      ) {
        ctx.selection.view?.set({ kind: "none" });
        return;
      }
    }
    // A retargeted event stands the target's closest first (the bubbling
    // path); the capture-retargeted one (the target IS the container)
    // falls to the point's element (the hit test through the world's
    // transform).
    const fromTarget =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-slot='docblocks/shape-text-target']")
        : null;
    const element = fromTarget !== null ? fromTarget : document.elementFromPoint(event.clientX, event.clientY);
    const target = element instanceof Element ? element.closest("[data-slot='docblocks/shape-text-target']") : null;
    if (target === null) return;
    const id =
      target.closest<HTMLElement>("[data-slot='docblocks/canvas-item']")?.getAttribute("data-block-id") ?? null;
    if (id !== null) ctx.viewport.setShapeTextEditing(id);
  };
}

export { chipDoubleClick, createContentDoubleClick };
