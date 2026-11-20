/** The canvas container's TOOL press branches (the pointerdown's first
 * half): the active tool wins over the surface it lands on (the pen's
 * stroke, the shape / container's drag-to-size and the click's place, the
 * connector's endpoint stand), and the pan's mode (the dock's hand, the
 * held space) wins over the editing surfaces. Each branch returns whether
 * the press was handled (the orchestrator falls through to the items'
 * press branches otherwise). */
import type { PointerEvent as ReactPointerEvent } from "react";

import { connectorPressStand, screenToCanvas, snapAnySurfaceEdge } from "../../canvas";
import type { CanvasSessionContext } from "./canvas-session-context";
import { isPlaceTool } from "./utils";

/** The endpoint handle's press: the container keeps the pointer (the release outside the window would otherwise stand the session open — the card-press capture's contract). The endpoint drag's release commit reads the session, not the release target (the capture retargets the pointerup to the container — unlike the connector pick's release, the drag's commit stands off the target). */
function beginEndpointDrag(
  ctx: CanvasSessionContext,
  connectorId: string,
  which: "start" | "end",
  pointerId: number,
  clientX: number,
  clientY: number
): void {
  const container = ctx.containerRef.current;
  if (container === null) return;
  container.setPointerCapture?.(pointerId);
  const rect = container.getBoundingClientRect();
  ctx.viewport.beginConnectorEndpoint(
    connectorId,
    which,
    {
      x: clientX - rect.left - rect.width / 2,
      y: clientY - rect.top - rect.height / 2,
    },
    clientX,
    clientY
  );
}

/** The pen's press: the live stroke's begin (the first point is the press's canvas point). */
function penPress(
  ctx: CanvasSessionContext,
  event: ReactPointerEvent<HTMLDivElement>,
  point: { x: number; y: number }
): boolean {
  if (ctx.viewport.activeTool !== "pen") return false;
  ctx.sessionRef.current = { kind: "pen", points: [screenToCanvas(point, ctx.viewport.zoom, ctx.viewport.pan)] };
  // The compatibility mousedown's preventDefault's stand (the press
  // suppresses the mousedown's default — the caret / the native text
  // selection stand off over the press: a selection drag over the
  // surface's text would take the gesture over and cancel the pointer
  // sequence over the live stroke). The focus parks on the container
  // (the preventDefault drops the default focus move — the keydown
  // reach stands over the gesture).
  ctx.cardPressRef.current = true;
  ctx.containerRef.current?.focus();
  event.currentTarget.setPointerCapture?.(event.pointerId);
  return true;
}

/** The place / click tools' press (the non-connector active tools): the shape / container's drag-to-size begins the session (no commit yet), the drag stands the preview (the marquee's gesture), the release commits the dragged size (a click stands the default-size place); the click-to-place tools (the text — the non-place tools) land the block at the click point (the center anchor) and reset the tool. */
function toolPress(
  ctx: CanvasSessionContext,
  event: ReactPointerEvent<HTMLDivElement>,
  point: { x: number; y: number }
): boolean {
  if (ctx.viewport.activeTool === null || ctx.viewport.activeTool === "connector") return false;
  const tool = ctx.viewport.activeTool;
  if (isPlaceTool(tool)) {
    // The shape's drag-to-size: the press starts the session (no
    // commit yet), the drag stands the preview (the marquee's
    // gesture), the release commits the dragged size (a click stands
    // the default-size place).
    const start = screenToCanvas(point, ctx.viewport.zoom, ctx.viewport.pan);
    ctx.sessionRef.current = {
      kind: "place",
      tool,
      start,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastPoint: start,
    };
    // The compatibility mousedown's preventDefault's stand (the press
    // suppresses the mousedown's default — the caret / the native text
    // selection stand off over the press: a selection drag over the
    // surface's text — the page miniature's content, the shape's text
    // overlay — would take the gesture over and cancel the pointer
    // sequence over the live place preview). The focus parks on the
    // container (the preventDefault drops the default focus move — the
    // keydown reach stands over the gesture: the shift's live toggle
    // over the standing drag).
    ctx.cardPressRef.current = true;
    ctx.containerRef.current?.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    return true;
  }
  // The click-to-place tools (the text — the non-place tools): the
  // block lands at the click point (the center anchor), the tool
  // resets.
  ctx.viewport.onPlace(screenToCanvas(point, ctx.viewport.zoom, ctx.viewport.pan));
  return true;
}

/** The connector tool's press: a press on an item stands the block stand (the two-click's first pick; the press-drag's press on a block), a press off the items stands the FREE stand (the empty-canvas press — the press point is the first endpoint, the release commits). A press with a stand already standing cancels (the second stand commits on the release / the second click). The press's edge snap stands the pressed point — the port ref at the port's stick disk, the free point over the continuous edge (the frozen direction = the snapped side), the plain block ref over the interior (the auto anchor). */
function connectorToolPress(
  ctx: CanvasSessionContext,
  event: ReactPointerEvent<HTMLDivElement>,
  point: { x: number; y: number }
): boolean {
  if (ctx.viewport.activeTool !== "connector") return false;
  const item = ctx.standItemAt(event.target);
  const id = item?.getAttribute("data-block-id") ?? null;
  const hasStand = ctx.viewport.pendingConnector !== null || ctx.viewport.pendingFree !== null;
  const canvasPoint = screenToCanvas(point, ctx.viewport.zoom, ctx.viewport.pan);
  const standId = id ?? ctx.portBlockAt(canvasPoint);
  ctx.connectorPressClientRef.current = { x: event.clientX, y: event.clientY };
  if (standId !== null && standId !== ctx.viewport.pendingConnector && standId !== ctx.viewport.pendingSource) {
    if (!hasStand) {
      // The source stands the self-pair guard (the stand's own block's
      // second press cancels, not commits a degenerate line).
      ctx.viewport.setPendingStand(
        { ...connectorPressStand(ctx.doc, standId, canvasPoint), source: standId },
        canvasPoint
      );
    } else {
      // The second click on a different item: the completion.
      ctx.viewport.onConnectorCommit({ blockId: standId }, canvasPoint);
    }
  } else if (standId === null) {
    if (!hasStand) {
      ctx.viewport.setPendingStand({ free: canvasPoint }, canvasPoint);
    } else {
      // A plain click off the items cancels the stand (the
      // press-drag's release commits the free end instead — the
      // pointerup path keeps the stand open).
      ctx.viewport.setPendingStand(null);
      ctx.viewport.setActiveTool(null);
      ctx.viewport.setConnectorPreview(null);
      ctx.connectorPressClientRef.current = null;
      return true;
    }
  } else {
    // The same block's second press: the cancel.
    ctx.viewport.setPendingStand(null);
    ctx.viewport.setActiveTool(null);
    ctx.viewport.setConnectorPreview(null);
    ctx.connectorPressClientRef.current = null;
    return true;
  }
  ctx.viewport.setConnectorPreview({ point: canvasPoint, snap: snapAnySurfaceEdge(ctx.doc, canvasPoint) });
  // No pointer capture: the two-click's second pick and the
  // press-drag's release read the release TARGET (the item under the
  // cursor) — a capture would retarget the pointerup to the container
  // and the release would stand off the items.
  return true;
}

/** The pan's press (the dock's hand, the held space) wins over the editing surfaces it lands on (the hand's contract: a grab anywhere pans — the press is prevented, so the drag stands no caret / text selection on the surface). */
function panPress(ctx: CanvasSessionContext, event: ReactPointerEvent<HTMLDivElement>): boolean {
  if (ctx.viewport.mode !== "pan" && !ctx.spacePan) return false;
  // The press stands the pan (the surfaces keep no caret / text
  // selection); the focus parks on the container (the preventDefault
  // drops the default focus change — the keydown reach stands).
  event.preventDefault();
  ctx.containerRef.current?.focus();
  ctx.sessionRef.current = {
    kind: "pan",
    startClientX: event.clientX,
    startClientY: event.clientY,
    startPanX: ctx.viewport.pan.x,
    startPanY: ctx.viewport.pan.y,
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  return true;
}

export { beginEndpointDrag, connectorToolPress, panPress, penPress, toolPress };
