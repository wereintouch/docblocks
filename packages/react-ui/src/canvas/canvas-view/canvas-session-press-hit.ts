/** The canvas surface's block-selection press: the hit resolver's target
 * (the top-most press zone at the world point) stands the selection, or the
 * additive toggle over the shift, and the move's session over the items.
 * The resolver answers from the geometry, so an object under another one is
 * reachable and the bands keep their screen-px reach at any zoom. The
 * connector stands its own press contract: the line carries no geometry, so
 * the press selects it without a move session (the double-click's label
 * edit keeps the line's own target). */
import type { PointerEvent as ReactPointerEvent } from "react";

import { screenToCanvas } from "../../canvas";
import type { CanvasSessionContext } from "./canvas-session-context";
import { pressHitAt } from "./hit-stack";
import { toggleCanvasSelection } from "./utils";

function surfacePress(ctx: CanvasSessionContext, event: ReactPointerEvent<HTMLDivElement>): boolean {
  const world = screenToCanvas(ctx.centerRelativePoint(event), ctx.viewport.zoom, ctx.viewport.pan);
  const candidate = pressHitAt(ctx.doc, world, ctx.viewport.zoom);
  if (candidate === null) return false;
  const id = candidate.id;
  if (event.shiftKey) {
    // The shift toggle (no move session — the selection stands; the focus
    // parks on the container so the keys reach the view).
    ctx.containerRef.current?.focus();
    if (ctx.selection.view !== null) toggleCanvasSelection(ctx.selection.view, id);
    return true;
  }
  const sel = ctx.selection.view?.get();
  const ids = sel?.kind === "blocks" && sel.ids.includes(id) ? sel.ids : [id];
  ctx.selection.view?.set({ kind: "blocks", ids, anchorId: id });
  ctx.containerRef.current?.focus();
  if (candidate.type === "connector") return true;
  event.preventDefault();
  ctx.viewport.beginMove(ids, event.clientX, event.clientY);
  event.currentTarget.setPointerCapture?.(event.pointerId);
  return true;
}

export { surfacePress };
