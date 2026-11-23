/** The mermaid viewport's pan: the wheel's zoom / pan (the non-passive
 *  listener) and the left-button's drag-pan over the diagram's area. */
import { useEffect, useRef } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { clamp } from "../shared/utils";
import {
  VIEWPORT_MAX_SCALE,
  VIEWPORT_MIN_SCALE,
  VIEWPORT_WHEEL_ZOOM,
  clampPan,
  measureContent,
  zoomAtPoint,
} from "./mermaid-viewport-view";
import type { ViewportView } from "./mermaid-viewport-view";

function useMermaidPan({
  wrapperRef,
  layerRef,
  viewRef,
  clampView,
  markExplicit,
  setView,
}: {
  wrapperRef: RefObject<HTMLDivElement | null>;
  layerRef: RefObject<HTMLDivElement | null>;
  viewRef: RefObject<ViewportView>;
  clampView: (next: ViewportView) => ViewportView;
  markExplicit: () => void;
  setView: Dispatch<SetStateAction<ViewportView>>;
}): {
  panSession: RefObject<{ pointerId: number; lastX: number; lastY: number } | null>;
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  endPan: (event: React.PointerEvent) => void;
} {
  // The pan's session (the left-button's drag over the diagram's area —
  // the diagram's content is non-interactive, so the unmodified drag
  // stands the pan; the toolbar's / the handle's targets keep theirs).
  const panSession = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);

  // The wheel: `ctrl`/`cmd` zooms at the cursor, a plain wheel pans
  // vertically (content opposite to the delta). A non-passive listener so
  // the default (the page scroll) is suppressed only when the view
  // actually changes.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const onWheel = (event: WheelEvent) => {
      const current = viewRef.current;
      const rect = wrapper.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      let next: ViewportView | null = null;
      if (event.ctrlKey || event.metaKey) {
        const nextScale = clamp(
          current.scale * Math.exp(-event.deltaY * VIEWPORT_WHEEL_ZOOM),
          VIEWPORT_MIN_SCALE,
          VIEWPORT_MAX_SCALE
        );
        if (nextScale !== current.scale) {
          next = clampView({ ...zoomAtPoint(current, cx, cy, nextScale), scale: nextScale });
        }
      } else {
        const content = measureContent(layerRef.current);
        const clamped = clampPan(
          current.scale,
          current.x,
          current.y - event.deltaY,
          rect.width,
          rect.height,
          content.w,
          content.h
        );
        if (clamped.y !== current.y) next = { ...current, ...clamped };
      }
      if (next === null) return;
      event.preventDefault();
      markExplicit();
      setView(next);
    };
    wrapper.addEventListener("wheel", onWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", onWheel);
    // The listener reads the live state over the refs (the mount's stand).
  }, []);

  // The drag-pan: the left button over the diagram's area (the toolbar's
  // buttons / the resize's handle keep their own pointer's stands).
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button") !== null || target.closest('[data-slot="docblocks/mermaid-resize"]') !== null) return;
    event.preventDefault();
    wrapperRef.current?.setPointerCapture(event.pointerId);
    panSession.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const session = panSession.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    const dx = event.clientX - session.lastX;
    const dy = event.clientY - session.lastY;
    session.lastX = event.clientX;
    session.lastY = event.clientY;
    markExplicit();
    setView((v) => clampView({ scale: v.scale, x: v.x + dx, y: v.y + dy }));
  };

  const endPan = (event: React.PointerEvent) => {
    const session = panSession.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    wrapperRef.current?.releasePointerCapture(event.pointerId);
    panSession.current = null;
  };

  return { panSession, onPointerDown, onPointerMove, endPan };
}

export { useMermaidPan };
