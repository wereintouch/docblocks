/** The viewport store's per-item / per-line subscriptions: the narrow
 * selector hooks over the store's slices (the re-render contract — the
 * pointermove re-renders only the touched items / lines, the resting ones
 * stand their stable EMPTY stand). The value's cache (the ref) stands the
 * selector's purity (the same value object over the same inputs — a built
 * object per call would stand the re-render loop). */
import { useStore } from "zustand";

import { useRef } from "react";

import type { Box } from "../geometry";
import type { EndpointDrag, EndpointPreview, MovePreview } from "./models";
import { useCanvasViewportStore } from "./viewport-store";
import type { CanvasSession } from "./viewport-store";

/** The move preview's no-op stand (the stable object: the selector's
 * bail-out over the untouched items — a resting item re-renders no frame). */
const EMPTY_MOVE_DELTA = { dx: 0, dy: 0 };

/** The line's no-op session (the stable object: a line whose endpoints
 * the preview does not touch re-renders no frame of the drag). */
const EMPTY_LINE_SESSION: CanvasSession = {
  movePreview: null,
  resizePreview: null,
  endpointDrag: null,
  endpointPreview: null,
};

/** The preview's no-op stand (the stable object: the label chips'
 * midpoint's cache bails over the untouched lines). */
const EMPTY_PREVIEWS: CanvasSession = EMPTY_LINE_SESSION;

/**
 * The per-item move preview's delta (canvas px): the stable zero stand
 * while the item is not in the in-flight move set, the live offset over
 * the dragged items. The pointermove re-renders ONLY the moved items —
 * the resting 5000 stand their memo. The value's cache (the ref): the
 * selector stands pure (the same value object over the same dx / dy — a
 * built object per call would stand the re-render loop).
 */
function useMovePreviewDelta(id: string): { dx: number; dy: number } {
  const store = useCanvasViewportStore();
  const cacheRef = useRef<{ dx: number; dy: number; value: { dx: number; dy: number } } | null>(null);
  return useStore(store, (s) => {
    const preview = s.movePreview;
    if (preview === null || !preview.idSet.has(id)) return EMPTY_MOVE_DELTA;
    const cache = cacheRef.current;
    if (cache !== null && cache.dx === preview.dx && cache.dy === preview.dy) return cache.value;
    const value = { dx: preview.dx, dy: preview.dy };
    cacheRef.current = { dx: preview.dx, dy: preview.dy, value };
    return value;
  });
}

/** The per-item resize preview's box (the live box over the resized
 * item, the stable null stand over the rest). */
function useResizePreviewBox(id: string): Box | null {
  const store = useCanvasViewportStore();
  return useStore(store, (s) => (s.resizePreview !== null && s.resizePreview.id === id ? s.resizePreview.box : null));
}

/** The per-item keyboard focus's stand (the canvas view's arrow
 * navigation): the point boolean over the focused item only. */
function useKbFocus(id: string): boolean {
  const store = useCanvasViewportStore();
  return useStore(store, (s) => s.kbFocusId === id);
}

/**
 * The per-line canvas session: the stable EMPTY stand while the in-flight
 * previews touch NEITHER of the line's endpoint blocks (the line's
 * memo holds — no re-route, no re-render, the frame), the live session
 * over the touched lines (the endpoints' resolution follows the preview
 * mid-drag). `startBlockId` / `endBlockId` stand the endpoint's block ref
 * (null over the free points). The stand's cache (the ref): the selector
 * stands pure over the same field references (the stored previews stand
 * stable objects between the store's writes — a built object per call
 * would stand the re-render loop).
 */
function useLineSession(id: string, startBlockId: string | null, endBlockId: string | null): CanvasSession {
  const store = useCanvasViewportStore();
  const cacheRef = useRef<{
    mv: MovePreview | null;
    rp: { id: string; box: Box } | null;
    ed: EndpointDrag | null;
    ep: EndpointPreview | null;
    value: CanvasSession;
  } | null>(null);
  return useStore(store, (s) => {
    const mv = s.movePreview;
    const rp = s.resizePreview;
    const ed = s.connectorEndpoint;
    const ep = s.connectorEndpointPreview;
    const cache = cacheRef.current;
    if (cache !== null && cache.mv === mv && cache.rp === rp && cache.ed === ed && cache.ep === ep) {
      return cache.value;
    }
    const mvTouches =
      mv !== null &&
      ((startBlockId !== null && mv.idSet.has(startBlockId)) || (endBlockId !== null && mv.idSet.has(endBlockId)));
    const rpTouches = rp !== null && (rp.id === startBlockId || rp.id === endBlockId);
    const edTouches = ed !== null && ed.connectorId === id;
    const value =
      !mvTouches && !rpTouches && !edTouches
        ? EMPTY_LINE_SESSION
        : {
            movePreview: mvTouches ? mv : null,
            resizePreview: rpTouches ? rp : null,
            endpointDrag: edTouches ? ed : null,
            endpointPreview: edTouches ? ep : null,
          };
    cacheRef.current = { mv, rp, ed, ep, value };
    return value;
  });
}

/** The preview's stand for the label chips (the lines' re-draw's inputs):
 * the stable EMPTY stand while no session stands, the live previews over
 * the in-flight gesture. The stand's cache (the ref): the selector stands
 * pure over the same field references (the line's session's parity). */
function useChipsPreviews(): CanvasSession {
  const store = useCanvasViewportStore();
  const cacheRef = useRef<{
    mv: MovePreview | null;
    rp: { id: string; box: Box } | null;
    ed: EndpointDrag | null;
    ep: EndpointPreview | null;
    value: CanvasSession;
  } | null>(null);
  return useStore(store, (s) => {
    const mv = s.movePreview;
    const rp = s.resizePreview;
    const ed = s.connectorEndpoint;
    const ep = s.connectorEndpointPreview;
    const cache = cacheRef.current;
    if (cache !== null && cache.mv === mv && cache.rp === rp && cache.ed === ed && cache.ep === ep) {
      return cache.value;
    }
    const value =
      mv === null && rp === null && ed === null
        ? EMPTY_PREVIEWS
        : {
            movePreview: mv,
            resizePreview: rp,
            endpointDrag: ed,
            endpointPreview: ep,
          };
    cacheRef.current = { mv, rp, ed, ep, value };
    return value;
  });
}

/** The ports' visibility stand (the connector's tool active or the
 * endpoint's drag in flight): the point boolean (the surface re-renders
 * only on the tool's press / release, not over the pointermove). */
function useShowPorts(): boolean {
  const store = useCanvasViewportStore();
  return useStore(store, (s) => s.activeTool === "connector" || s.connectorEndpoint !== null);
}

/**
 * The endpoint's live snap within the surface's own children (the edge
 * snap over a sibling of THIS surface): the stable null stand over the
 * surfaces that hold no snap target — the endpoint's drag re-renders ONLY
 * the owning surface's dots (the other surfaces' copies stand inert).
 */
function usePortSnap(
  children: readonly string[]
): { blockId: string; port: "north" | "east" | "south" | "west"; t: number } | null {
  const store = useCanvasViewportStore();
  return useStore(store, (s) => {
    const drag = s.connectorEndpointPreview?.snap ?? null;
    if (drag !== null && children.includes(drag.blockId)) return drag;
    const hover = s.connectorHoverSnap;
    if (hover !== null && children.includes(hover.blockId)) return hover;
    const pending = s.connectorPreview?.snap ?? null;
    if (pending !== null && children.includes(pending.blockId)) return pending;
    return null;
  });
}

export {
  EMPTY_LINE_SESSION,
  EMPTY_MOVE_DELTA,
  EMPTY_PREVIEWS,
  useChipsPreviews,
  useKbFocus,
  useLineSession,
  useMovePreviewDelta,
  usePortSnap,
  useResizePreviewBox,
  useShowPorts,
};
