/**
 * The embed's pan/zoom view's state (the gesture's stand): the view over
 * the block's persisted attrs (the reload's restore, the null idiom's
 * identity), the write's debounce over the gesture's bursts (the wire's
 * precision's rounding, the no-op's no-write), the peer's adopt over the
 * wire (the clamp's stand over the current wrapper), the wheel's gesture
 * (the `ctrl` / `cmd`'s zoom at the cursor, the plain's vertical pan), and
 * the modifier's drag-pan (the `space` / `alt`'s hold — the iframe yields
 * its pointer events then, so an unmodified drag reaches the iframe's own
 * interaction).
 */
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import type { BlockId, EmbedBlock as EmbedBlockType } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { clamp } from "../shared/utils";
import {
  EMBED_MAX_SCALE,
  EMBED_MIN_SCALE,
  EMBED_PERSIST_DEBOUNCE_MS,
  EMBED_VIEW_IDENTITY,
  EMBED_WHEEL_ZOOM,
  EMBED_ZOOM_STEP,
  clampEmbedPan,
  roundViewValue,
  viewOfAttrs,
  zoomAtPoint,
} from "./embed-view";
import type { EmbedView } from "./embed-view";

interface UseEmbedViewArgs {
  id: BlockId;
  block: EmbedBlockType;
  /** The wrapper's ref (the wheel's + the pan's geometry stand on its rect). */
  wrapperRef: RefObject<HTMLDivElement | null>;
}

interface UseEmbedViewResult {
  view: EmbedView;
  atIdentity: boolean;
  panModifier: boolean;
  panSession: RefObject<{ pointerId: number; lastX: number; lastY: number } | null>;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  endPan: (event: ReactPointerEvent) => void;
}

function useEmbedView({ id, block, wrapperRef }: UseEmbedViewArgs): UseEmbedViewResult {
  const { doc } = useEditorContext();
  // The view stands the block's persisted attrs (the reload's restore), the
  // null idiom's identity over the absent / the cleared attrs.
  const [view, setView] = useState<EmbedView>(() => viewOfAttrs(block.attrs.zoom, block.attrs.panX, block.attrs.panY));
  const viewRef = useRef(view);
  viewRef.current = view;
  // The pan modifier (space / alt) held: the iframe yields its pointer events
  // to the wrapper so a modifier + drag pans (an unmodified drag reaches the
  // iframe's own interaction).
  const [panModifier, setPanModifier] = useState(false);
  const panSession = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);

  // Track the pan modifier (space / alt) on the window: the iframe stands
  // `pointer-events: none` while it is held, so the wrapper's pointer session
  // stands for the pan.
  useEffect(() => {
    const isPanModifier = (event: KeyboardEvent) => event.code === "Space" || event.key === "Alt";
    const onKeyDown = (event: KeyboardEvent) => {
      if (isPanModifier(event)) setPanModifier(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (isPanModifier(event)) setPanModifier(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // The wheel: `ctrl`/`cmd` zooms at the cursor, a plain wheel pans vertically
  // (content opposite to the delta). A non-passive listener so the default
  // (the page scroll) is suppressed only when the view actually changes.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const onWheel = (event: WheelEvent) => {
      const current = viewRef.current;
      const rect = wrapper.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      let next = current;
      if (event.ctrlKey || event.metaKey) {
        const nextScale = clamp(
          current.scale * Math.exp(-event.deltaY * EMBED_WHEEL_ZOOM),
          EMBED_MIN_SCALE,
          EMBED_MAX_SCALE
        );
        if (nextScale !== current.scale) {
          const zoomed = zoomAtPoint(current, cx, cy, nextScale);
          next = { scale: nextScale, ...clampEmbedPan(nextScale, zoomed.x, zoomed.y, rect.width, rect.height) };
        }
      } else {
        const { y } = clampEmbedPan(current.scale, current.x, current.y - event.deltaY, rect.width, rect.height);
        if (y !== current.y) next = { ...current, y };
      }
      if (next === current) return;
      event.preventDefault();
      setView(next);
    };
    wrapper.addEventListener("wheel", onWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", onWheel);
  }, []);

  /** The toolbar's center-anchored zoom (the wrapper's center stands fixed). */
  const zoomBy = (step: number) => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const rect = wrapper.getBoundingClientRect();
    setView((v) => {
      const nextScale = clamp(v.scale * step, EMBED_MIN_SCALE, EMBED_MAX_SCALE);
      if (nextScale === v.scale) return v;
      const zoomed = zoomAtPoint(v, rect.width / 2, rect.height / 2, nextScale);
      return { scale: nextScale, ...clampEmbedPan(nextScale, zoomed.x, zoomed.y, rect.width, rect.height) };
    });
  };

  const zoomIn = () => zoomBy(EMBED_ZOOM_STEP);
  const zoomOut = () => zoomBy(1 / EMBED_ZOOM_STEP);

  const resetView = () => setView(EMBED_VIEW_IDENTITY);
  const atIdentity = view.scale === EMBED_VIEW_IDENTITY.scale && view.x === 0 && view.y === 0;

  /**
   * The persisted view's write (the debounce over the gesture's bursts): the
   * non-identity view stands the block's attrs (the zoom / panX / panY — the
   * null idiom: the identity parts stand `null`, the reader's restore), so
   * the reload / the new tab's embed stands the same view. The values stand
   * the wire's precision (the 1%'s zoom, the 0.1 px's pan — the rounding's
   * guard over the floating-point's residue). The no-op stand: a view equal
   * to the block's own attrs writes nothing (no updatedAt's stamp, no wire
   * update).
   */
  useEffect(() => {
    const zoom = roundViewValue(view.scale, 2);
    const x = roundViewValue(view.x, 1);
    const y = roundViewValue(view.y, 1);
    if (zoom === (block.attrs.zoom ?? 1) && x === (block.attrs.panX ?? 0) && y === (block.attrs.panY ?? 0)) {
      return;
    }
    const timer = window.setTimeout(() => {
      doc.updateBlock(id, { zoom: zoom === 1 ? null : zoom, panX: x === 0 ? null : x, panY: y === 0 ? null : y });
    }, EMBED_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [view, block.attrs, doc, id]);

  /**
   * The remote's stand: the panes share the persisted view over the wire — a
   * pane's peer lands a view different from the local's (the block's attrs
   * stand the peer's write), so the local's view adopts it. Own writes land
   * equal to the local's view and stand no adopt. The adopt clamps the
   * restored pan to the current wrapper (a stale pan over a narrower pane's
   * clip must not blank the embed).
   */
  useEffect(() => {
    const scale = block.attrs.zoom ?? 1;
    const x = block.attrs.panX ?? 0;
    const y = block.attrs.panY ?? 0;
    const v = viewRef.current;
    if (scale === v.scale && x === v.x && y === v.y) return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    const clamped =
      rect === undefined || rect.width === 0 || rect.height === 0
        ? { x, y }
        : clampEmbedPan(scale, x, y, rect.width, rect.height);
    setView({ scale, x: clamped.x, y: clamped.y });
  }, [block.attrs]);

  // The modifier drag-pan: the wrapper's pointerdown stands only when the
  // modifier is held (the iframe yields then) and the target is not the
  // toolbar (its buttons keep their own click).
  const onPointerDown = (event: ReactPointerEvent) => {
    if (!panModifier || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button") !== null) return;
    event.preventDefault();
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    wrapper.setPointerCapture(event.pointerId);
    panSession.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const session = panSession.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    const dx = event.clientX - session.lastX;
    const dy = event.clientY - session.lastY;
    session.lastX = event.clientX;
    session.lastY = event.clientY;
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const rect = wrapper.getBoundingClientRect();
    setView((v) => ({ scale: v.scale, ...clampEmbedPan(v.scale, v.x + dx, v.y + dy, rect.width, rect.height) }));
  };

  const endPan = (event: ReactPointerEvent) => {
    const session = panSession.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    wrapperRef.current?.releasePointerCapture(event.pointerId);
    panSession.current = null;
  };

  return {
    view,
    atIdentity,
    panModifier,
    panSession,
    zoomIn,
    zoomOut,
    resetView,
    onPointerDown,
    onPointerMove,
    endPan,
  };
}

export { useEmbedView };
export type { UseEmbedViewResult };
