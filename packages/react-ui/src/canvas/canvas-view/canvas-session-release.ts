/** The canvas pointer's RELEASE handlers: the pointerup's commits (the
 * connector endpoint's drag, the connector's press-drag, the place's
 * dragged box / the click's default size, the pen's stroke, the
 * marquee's selection), and the session's drop (the pointer cancel, the
 * lost capture, the button-less move over a surviving session). */
import type { PointerEvent as ReactPointerEvent } from "react";

import type { BlockId } from "docblocks-core";

import { MOVE_THRESHOLD_PX, marqueeRect, penStroke, placeDragBox, rectsIntersect, screenToCanvas } from "../../canvas";
import type { CanvasSessionContext } from "./canvas-session-context";

interface CanvasReleaseHandlers {
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  dropCanvasSessions: () => void;
  onPointerCancel: () => void;
}

/** The release handlers (the pointerup's commits + the session's drop + the pointer cancel). The OS / browser takeover (a pointer cancel, a lost capture, a button-less move over a surviving session) drops every in-flight session: the move's preview would otherwise stand until the next release, and that release would commit a stale setGeometry. The no-session calls are no-ops (the state stays, no re-render). */
function createReleaseHandlers(ctx: CanvasSessionContext): CanvasReleaseHandlers {
  const dropCanvasSessions = () => {
    // The no-session no-op: a button-less mouse move over the idle
    // canvas must not write state (no re-render) — the setX calls stand
    // fresh values (a new array for the pen points). The slices stand the
    // LIVE store state (not the render closure — a deferred re-render's
    // stale preview must not stand the idle drop's writes).
    const live = ctx.viewport.store.getState();
    if (
      ctx.sessionRef.current === null &&
      live.movePreview === null &&
      live.resizePreview === null &&
      live.marquee === null &&
      live.penPoints.length === 0 &&
      live.placePreview === null &&
      live.connectorEndpoint === null
    ) {
      return;
    }
    ctx.sessionRef.current = null;
    ctx.viewport.setPlacePreview(null);
    ctx.viewport.cancelMove();
    ctx.viewport.cancelResize();
    ctx.viewport.cancelConnectorEndpoint();
    ctx.viewport.setMarquee(null);
    ctx.viewport.setPenPoints([]);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    ctx.cardPressRef.current = false;

    // The connector endpoint's drag release: the commit (the port snap
    // or the free point; one updateBlock) or the no-op (a press-release
    // under the threshold).
    if (ctx.viewport.connectorEndpoint !== null) {
      ctx.viewport.endConnectorEndpoint(event.clientX, event.clientY);
      return;
    }

    // The connector's press-drag release: a release over an item stands
    // the second block stand (the port snap reads the release point), a
    // release on the empty canvas commits the FREE second endpoint for a
    // real drag (a sub-threshold press-release cancels the stand). The
    // two-click's second pick stands on the pointerdown instead.
    if (
      ctx.viewport.activeTool === "connector" &&
      (ctx.viewport.pendingConnector !== null || ctx.viewport.pendingFree !== null)
    ) {
      const canvasPoint = screenToCanvas(ctx.centerRelativePoint(event), ctx.viewport.zoom, ctx.viewport.pan);
      const item = ctx.standItemAt(event.target);
      const id = item?.getAttribute("data-block-id") ?? null;
      const standId = id ?? ctx.portBlockAt(canvasPoint);
      if (standId !== null && standId !== ctx.viewport.pendingConnector && standId !== ctx.viewport.pendingSource) {
        ctx.viewport.onConnectorCommit({ blockId: standId }, canvasPoint);
      } else if (standId === null) {
        const press = ctx.connectorPressClientRef.current;
        const dragged =
          press !== null && Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_THRESHOLD_PX;
        if (dragged) {
          ctx.viewport.onConnectorCommit({ free: canvasPoint }, canvasPoint);
        } else {
          ctx.viewport.setPendingStand(null);
          ctx.viewport.setActiveTool(null);
          ctx.viewport.setConnectorPreview(null);
        }
      }
      ctx.connectorPressClientRef.current = null;
      return;
    }

    ctx.viewport.endMove();
    ctx.viewport.endResize();
    const session = ctx.sessionRef.current;
    if (session === null) return;
    ctx.sessionRef.current = null;

    if (session.kind === "place") {
      // The release commits: a sub-threshold drag is the click place (the
      // default size), a real drag lands the dragged box at the drag's
      // midpoint (one transact, the tool resets, the preview drops); the
      // shift stands the same 1:1 box as the preview (the no-jump contract
      // — the preview's stand is the commit's stand).
      const current = screenToCanvas(ctx.centerRelativePoint(event), ctx.viewport.zoom, ctx.viewport.pan);
      if (Math.hypot(event.clientX - session.startClientX, event.clientY - session.startClientY) < MOVE_THRESHOLD_PX) {
        ctx.viewport.onPlace(session.start);
      } else {
        const box = placeDragBox(session.start, current, event.shiftKey);
        ctx.viewport.onPlaceSize(session.tool, { x: box.x, y: box.y }, { w: box.w, h: box.h });
      }
      ctx.viewport.setPlacePreview(null);
      return;
    }

    if (session.kind === "pen") {
      const stroke = penStroke(session.points);
      if (stroke !== null) {
        const first = session.points[0];
        const last = session.points[session.points.length - 1];
        if (
          first !== undefined &&
          last !== undefined &&
          Math.hypot((first.x - last.x) * ctx.viewport.zoom, (first.y - last.y) * ctx.viewport.zoom) >= 3
        ) {
          ctx.viewport.onPen(stroke);
        }
      }
      ctx.viewport.setPenPoints([]);
      ctx.viewport.setActiveTool(null);
      return;
    }

    if (session.kind === "marquee") {
      const additive = session.additive;
      const marquee = ctx.viewport.marquee;
      ctx.viewport.setMarquee(null);
      if (marquee === null || ctx.containerRef.current === null) return;
      const rect = marqueeRect(marquee.start, marquee.end);
      if (rect.width < 3 || rect.height < 3) {
        // A click on the empty canvas (no drag): clear the selection —
        // the additive press (the shift down) keeps it.
        if (additive === false) ctx.selection.view?.set({ kind: "none" });
        return;
      }
      const containerRect = ctx.containerRef.current.getBoundingClientRect();
      const center = { x: containerRect.width / 2, y: containerRect.height / 2 };
      const ids: BlockId[] = [];
      for (const el of ctx.containerRef.current.querySelectorAll<HTMLElement>('[data-slot="docblocks/canvas-item"]')) {
        const id = el.getAttribute("data-block-id");
        // The connector's wrapper is an empty origin box (its line lives
        // in the overlay): it is not marquee-selectable.
        if (id === null || ctx.blocks[id]?.type === "connector") continue;
        const box = el.getBoundingClientRect();
        const itemRect = {
          left: box.left - containerRect.left - center.x,
          top: box.top - containerRect.top - center.y,
          width: box.width,
          height: box.height,
        };
        if (rectsIntersect(rect, itemRect)) ids.push(id);
      }
      if (additive) {
        // The shift-marquee's union: the pre-marquee selection stands first
        // (the marquee extends it — an empty union keeps the selection).
        const sel = ctx.selection.view?.get();
        const base = sel?.kind === "blocks" ? sel.ids : [];
        const merged = [...base, ...ids.filter((id) => !base.includes(id))];
        ctx.selection.view?.set(
          merged.length > 0
            ? {
                kind: "blocks",
                ids: merged,
                anchorId: base.length > 0 && sel?.kind === "blocks" ? sel.anchorId : merged[0]!,
              }
            : { kind: "none" }
        );
      } else {
        ctx.selection.view?.set(ids.length > 0 ? { kind: "blocks", ids, anchorId: ids[0]! } : { kind: "none" });
      }
      // The focus parks on the canvas container (the Delete keydown has to
      // bubble through it — the editor-root focus would skip the container
      // handler).
      ctx.containerRef.current?.focus();
    }
  };

  const onPointerCancel = () => {
    ctx.cardPressRef.current = false;
    dropCanvasSessions();
  };

  return { onPointerUp, dropCanvasSessions, onPointerCancel };
}

export { createReleaseHandlers };
export type { CanvasReleaseHandlers };
