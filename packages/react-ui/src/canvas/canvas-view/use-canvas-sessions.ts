/** The canvas view's pointer sessions: the press (the selection's toggle,
 * the tool's begin), the drag (the move / the resize / the marquee / the
 * pen / the place / the connector endpoint), the release (the commit / the
 * cancel), the chrome's mouse-down (the dock's drag), and the session's
 * drop. The handlers stand on the shared context (the refs + the deps +
 * the stand helpers) — the press's branches over the tools / the items,
 * the release's commits, and the double-click's entries stand in their
 * own modules (one gesture phase, one file). The editing-surface guard is
 * passed in (the keyboard hook shares it). */
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import { placeDragBox, screenToCanvas, snapAnySurfaceEdge } from "../../canvas";
import { createCanvasSessionContext } from "./canvas-session-context";
import type { CanvasSessionContext, CanvasSessionDeps } from "./canvas-session-context";
import { createContentDoubleClick } from "./canvas-session-dblclick";
import {
  connectorHitPress,
  containerInteriorPress,
  editingSurfacePress,
  handlePress,
  itemPress,
  marqueePress,
  pageCardPress,
} from "./canvas-session-press-items";
import { beginEndpointDrag, connectorToolPress, panPress, penPress, toolPress } from "./canvas-session-press-tools";
import { createReleaseHandlers } from "./canvas-session-release";
import { isShapeTool } from "./utils";

/** The container's pointerdown's orchestrator: the guards (the button, the
 * DOM containment over the portaled chrome, the read-only's stand), then
 * the tool's press branches (the active tool wins over the surface), then
 * the items' press branches (the handles / the hit path / the items / the
 * card / the container's interior), and the marquee's fallback. */
function onPointerDownOf(ctx: CanvasSessionContext, event: ReactPointerEvent<HTMLDivElement>): void {
  if (event.button !== 0) return;
  // The DOM containment guard: React's synthetic events bubble through
  // the FIBER tree, not the DOM tree — the portaled popover content
  // (the shape toolbar's palettes) stands in `document.body`, but its
  // pointer presses reach this handler through the component chain
  // (target = the portaled element). A press outside the container's
  // DOM subtree belongs to the portal content, not to the canvas.
  if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
  if (ctx.isChrome(event.target)) return;
  // The read-only stand (view / published): the sessions' stands off
  // (the selection / move / resize / place / connector's paths — the
  // pan's mode's and the space's hold's entries stand off with the
  // dock's / the hotkey's stands; the wheel's pan / zoom keep their
  // own parity over the read-only's stand).
  if (ctx.viewMode && !(ctx.viewport.mode === "pan" || ctx.spacePan)) return;
  const point = ctx.centerRelativePoint(event);

  // The active tool wins over the surface it lands on (the explicit
  // placement intent: a shape / stroke / connector placed over the page
  // miniature or a canvas-text inner stands on top of it).
  if (penPress(ctx, event, point)) return;
  if (toolPress(ctx, event, point)) return;
  if (connectorToolPress(ctx, event, point)) return;
  // The pan (the dock's hand, the held space) wins over the editing
  // surfaces it lands on (the hand's contract: a grab anywhere pans).
  if (panPress(ctx, event)) return;
  if (editingSurfacePress(ctx, event)) return;
  if (handlePress(ctx, event)) return;
  if (connectorHitPress(ctx, event)) return;
  if (itemPress(ctx, event)) return;
  if (pageCardPress(ctx, event)) return;
  if (containerInteriorPress(ctx, event, point)) return;
  // The container's EMPTY-interior press stood nothing: the marquee.
  marqueePress(ctx, event, point);
}

function useCanvasSessions(deps: CanvasSessionDeps) {
  const ctx = createCanvasSessionContext(deps);
  const { onPointerUp, dropCanvasSessions, onPointerCancel } = createReleaseHandlers(ctx);
  const onContentDoubleClick = createContentDoubleClick(ctx);

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The pointer's stand for the paste's seat (any tool / the drag's
    // capture — the position is the cursor's, always current).
    ctx.lastPointerRef.current = ctx.centerRelativePoint(event);
    // The connector's pending preview: the dashed line follows the cursor
    // (the hover of the two-click pick and the press-drag draw — the
    // button-less hover update runs before the buttons guard below). The
    // end stands the endpoint drag's snap (the stick to the port / the
    // continuous edge within the radius — the badge's parity); before the
    // stand the hover snap stands the press's stand point.
    if (ctx.viewport.activeTool === "connector") {
      const canvasPoint = screenToCanvas(ctx.centerRelativePoint(event), ctx.viewport.zoom, ctx.viewport.pan);
      const hasStand = ctx.viewport.pendingConnector !== null || ctx.viewport.pendingFree !== null;
      if (hasStand) {
        ctx.viewport.setConnectorPreview({ point: canvasPoint, snap: snapAnySurfaceEdge(ctx.doc, canvasPoint) });
      } else {
        ctx.viewport.setConnectorHoverSnap(snapAnySurfaceEdge(ctx.doc, canvasPoint));
      }
    }

    // The release can be lost (the pointer leaves the window mid-drag
    // and the capture is dropped without a pointerup / pointercancel):
    // a button-less move then stands over a surviving session and the
    // world chases the cursor (the next release would commit a stale
    // geometry). A button-less move drops every standing session; a
    // real drag carries the primary button.
    if ((event.buttons & 1) === 0) {
      dropCanvasSessions();
      return;
    }

    // The move / resize sessions (item / page-card / handle
    // press) run without a container session; the feeders are no-ops
    // while none is open. The connector endpoint drag feeds the live
    // re-draw (the preview point in the surface-local space).
    ctx.viewport.moveDrag(event.clientX, event.clientY);
    ctx.viewport.resizeDrag(event.clientX, event.clientY, event.shiftKey);
    if (ctx.viewport.connectorEndpoint !== null) {
      ctx.viewport.moveConnectorEndpoint(ctx.centerRelativePoint(event));
    }
    const session = ctx.sessionRef.current;
    if (session === null) return;
    const point = ctx.centerRelativePoint(event);

    if (session.kind === "pan") {
      ctx.viewport.setPan({
        x: session.startPanX + (event.clientX - session.startClientX),
        y: session.startPanY + (event.clientY - session.startClientY),
      });
    } else if (session.kind === "marquee") {
      const start = ctx.viewport.marquee?.start ?? point;
      ctx.viewport.setMarquee({ start, end: point });
    } else if (session.kind === "place") {
      // The drag-to-size preview: the box is the drag's extent (the
      // marquee's math), the center anchor is the drag's midpoint; the shift
      // stands the 1:1 square (the live constraint — the release's commit
      // stands the same box, the preview's stand is the commit's stand). The
      // The container's and the frame's preview stand the dashed box (the
      // container's visual parity).
      const current = screenToCanvas(point, ctx.viewport.zoom, ctx.viewport.pan);
      session.lastPoint = current;
      const box = placeDragBox(session.start, current, event.shiftKey);
      ctx.viewport.setPlacePreview({
        kind: isShapeTool(session.tool) ? "shape" : "container",
        variant: isShapeTool(session.tool) ? session.tool : "rect",
        ...box,
      });
    } else if (session.kind === "pen") {
      session.points.push(screenToCanvas(point, ctx.viewport.zoom, ctx.viewport.pan));
      ctx.viewport.setPenPoints([...session.points]);
    }
  };

  // The page miniature's two-click contract (the compatibility
  // mousedown): the first press over the page's content starts the card's
  // move session — the mousedown's default (the caret / the focus move)
  // stands no more. The flag stands until the release (the second press
  // stands no session, so its mousedown keeps the default).
  const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (ctx.cardPressRef.current) {
      event.preventDefault();
    }
  };

  return {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => onPointerDownOf(ctx, event),
    onPointerMove,
    onPointerUp,
    onMouseDown,
    onPointerCancel,
    dropCanvasSessions,
    beginEndpointDrag: (
      connectorId: string,
      which: "start" | "end",
      pointerId: number,
      clientX: number,
      clientY: number
    ) => beginEndpointDrag(ctx, connectorId, which, pointerId, clientX, clientY),
    onContentDoubleClick,
  };
}

export { useCanvasSessions };
