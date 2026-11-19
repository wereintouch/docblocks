/** The canvas surface's block-selection press: the hit resolver's target
 * (the top-most press zone at the world point) stands the selection, or the
 * additive toggle over the shift, and the move's session over the items.
 * The resolver answers from the geometry, so an object under another one is
 * reachable and the bands keep their screen-px reach at any zoom. The
 * connector stands its own press contract: the line carries no geometry, so
 * the press selects it without a move session (the double-click's label
 * edit keeps the line's own target).
 *
 * The press also feeds the drill-down: the Alt press steps to the next
 * candidate of the stack under the point (the stack's top when the current
 * candidate stands outside it), and a repeat plain press inside the
 * session's radius and window steps the same way — so objects covered by
 * another one stay reachable. The double-click's own entries win over the
 * plain repeat over an inline-editable target (the text blocks): the
 * second press inside the double-click's interval stands the editor's.
 */
import type { PointerEvent as ReactPointerEvent } from "react";

import { screenToCanvas } from "../../canvas";
import {
  CYCLE_PRESS_GAP_MS,
  CYCLE_RADIUS_PX,
  CYCLE_RADIUS_TOUCH_PX,
  CYCLE_WINDOW_PLAIN_MS,
  CYCLE_WRAP,
} from "./canvas-hit-config";
import type { CanvasSessionContext } from "./canvas-session-context";
import { hitStackAt, pressHitAt } from "./hit-stack";
import type { HitCandidate } from "./hit-stack";
import { toggleCanvasSelection } from "./utils";

/** The inline-editable target (the double-click's own entry): the
 * canvas-text and the shape that carries the inline text. */
function inlineEditable(ctx: CanvasSessionContext, candidate: HitCandidate): boolean {
  if (candidate.type === "canvas-text") return true;
  if (candidate.type !== "shape") return false;
  const block = ctx.doc.getBlock(candidate.id);
  return block !== null && block.type === "shape" && (block.attrs?.text ?? "") !== "";
}

/** The step's target index: the next candidate, wrapping to the top over the
 * last one (the stack's order is the drill-down's sequence). */
function nextIndexOf(index: number, length: number): number {
  return CYCLE_WRAP ? (index + 1) % length : Math.min(index + 1, length - 1);
}

/** The press that stands the editor's entry, not the drill-down: a double
 * click (`detail`'s count) or a second press inside the double-click's
 * interval over an inline-editable target. */
function editorWins(ctx: CanvasSessionContext, event: ReactPointerEvent<HTMLDivElement>): boolean {
  const candidate = pressHitAt(
    ctx.doc,
    screenToCanvas(ctx.centerRelativePoint(event), ctx.viewport.zoom, ctx.viewport.pan),
    ctx.viewport.zoom
  );
  if (candidate === null || !inlineEditable(ctx, candidate)) return false;
  const cycle = ctx.viewport.cycle;
  const rapid = cycle !== null && Date.now() - cycle.at <= CYCLE_PRESS_GAP_MS;
  return event.detail >= 2 || rapid;
}

/** The cycle's step: the candidate stands alone selected (the multi
 * selection's replacement), the session's anchor and its indicator stand at
 * the press point. Returns the candidate — the press then stands the move
 * session over it like any other item press (the drag moves it; a press
 * without a move is the step only). */
function stepCycle(
  ctx: CanvasSessionContext,
  stack: HitCandidate[],
  index: number,
  point: { x: number; y: number },
  event: ReactPointerEvent<HTMLDivElement>
): HitCandidate | null {
  const candidate = stack[index];
  if (candidate === undefined) return null;
  event.preventDefault();
  ctx.containerRef.current?.focus();
  ctx.selection.view?.set({ kind: "blocks", ids: [candidate.id], anchorId: candidate.id });
  const now = Date.now();
  ctx.viewport.setCycle({
    anchor: point,
    at: now,
    zoom: ctx.viewport.zoom,
    panX: ctx.viewport.pan.x,
    panY: ctx.viewport.pan.y,
    pointerType: event.pointerType,
  });
  ctx.viewport.setCycleIndicator({ point, index: index + 1, count: stack.length, nonce: now });
  return candidate;
}

/** The press's close over the item: the move session's begin and the pointer
 * capture (the connector carries no geometry — the press stops at the
 * selection). */
function beginItemPress(
  ctx: CanvasSessionContext,
  event: ReactPointerEvent<HTMLDivElement>,
  ids: string[],
  type: HitCandidate["type"]
): void {
  if (type === "connector") return;
  event.preventDefault();
  ctx.viewport.beginMove(ids, event.clientX, event.clientY);
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function surfacePress(ctx: CanvasSessionContext, event: ReactPointerEvent<HTMLDivElement>): boolean {
  const point = ctx.centerRelativePoint(event);
  const world = screenToCanvas(point, ctx.viewport.zoom, ctx.viewport.pan);
  const stack = hitStackAt(ctx.doc, world, ctx.viewport.zoom);
  const sel = ctx.selection.view?.get() ?? null;
  const anchorId = sel?.kind === "blocks" ? sel.anchorId : null;
  const index = anchorId === null ? -1 : stack.findIndex((candidate) => candidate.id === anchorId);

  // The drill-down. The Alt press steps at once (a positional session: no
  // window, the stack is recomputed at the click's point); the plain press
  // steps only inside the session's radius / window, and only while the
  // current candidate still stands in the stack (a new object's press is a
  // plain select, never a step).
  if (stack.length > 0 && !editorWins(ctx, event)) {
    const cycle = ctx.viewport.cycle;
    const radius = event.pointerType === "touch" ? CYCLE_RADIUS_TOUCH_PX : CYCLE_RADIUS_PX;
    const sameSpot = cycle !== null && Math.hypot(point.x - cycle.anchor.x, point.y - cycle.anchor.y) <= radius;
    const sameCamera =
      cycle !== null &&
      cycle.zoom === ctx.viewport.zoom &&
      cycle.panX === ctx.viewport.pan.x &&
      cycle.panY === ctx.viewport.pan.y;
    const inWindow = cycle !== null && Date.now() - cycle.at <= CYCLE_WINDOW_PLAIN_MS;
    if (event.altKey) {
      // The Alt press steps at once (the positional drill-down).
      const stepped = stepCycle(ctx, stack, index === -1 ? 0 : nextIndexOf(index, stack.length), point, event);
      ctx.cycleStepRef.current = null;
      if (stepped !== null) {
        beginItemPress(ctx, event, [stepped.id], stepped.type);
        return true;
      }
    }
    // The plain repeat press stands the step for the RELEASE: a click steps
    // the stack, a drag stands the move of the pressed item instead (the
    // click-then-drag contract must not be eaten by the drill-down).
    if (sameSpot && sameCamera && inWindow && index !== -1 && stack.length > 1) {
      ctx.cycleStepRef.current = {
        ids: stack.map((candidate) => candidate.id),
        index: nextIndexOf(index, stack.length),
        point,
        pointerType: event.pointerType,
      };
    } else {
      ctx.cycleStepRef.current = null;
    }
  }

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
  const ids = sel?.kind === "blocks" && sel.ids.includes(id) ? sel.ids : [id];
  ctx.selection.view?.set({ kind: "blocks", ids, anchorId: id });
  ctx.containerRef.current?.focus();
  // The single press's stand arms the plain repeat's session (the next
  // press over the same spot steps the stack); a drag drops it.
  const now = Date.now();
  ctx.viewport.setCycle({
    anchor: point,
    at: now,
    zoom: ctx.viewport.zoom,
    panX: ctx.viewport.pan.x,
    panY: ctx.viewport.pan.y,
    pointerType: event.pointerType,
  });
  beginItemPress(ctx, event, ids, candidate.type);
  return true;
}

/** The release's apply of the plain repeat press's step: a click (no drag)
 * steps the drill-down's stack — the candidate stands alone selected, the
 * session's anchor and the indicator stand at the press point. */
function applyPendingCycleStep(ctx: CanvasSessionContext): void {
  const pending = ctx.cycleStepRef.current;
  ctx.cycleStepRef.current = null;
  if (pending === null) return;
  const id = pending.ids[pending.index];
  if (id === undefined) return;
  const selection = (): void => {
    ctx.selection.view?.set({ kind: "blocks", ids: [id], anchorId: id });
  };
  selection();
  const now = Date.now();
  ctx.viewport.setCycle({
    anchor: pending.point,
    at: now,
    zoom: ctx.viewport.zoom,
    panX: ctx.viewport.pan.x,
    panY: ctx.viewport.pan.y,
    pointerType: pending.pointerType,
  });
  ctx.viewport.setCycleIndicator({
    point: pending.point,
    index: pending.index + 1,
    count: pending.ids.length,
    nonce: now,
  });
}

export { applyPendingCycleStep, surfacePress };
