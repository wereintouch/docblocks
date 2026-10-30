/** The canvas viewport's wheel gesture: the pointer mode pans (the 1:1
 * screen px, zoom-blind; the content stands opposite to the wheel's delta,
 * the shift's horizontal axis), the hand mode and the active tools zoom at
 * the cursor (the point under the pointer stands fixed), and the pinch
 * (ctrl/cmd) zooms everywhere — the CONTINUOUS stand (the zoom scales by
 * the delta, the smooth reaction, no step threshold). The native
 * non-passive listener (React's onWheel is passive at the root — the
 * preventDefault would not stand) consumes EVERY wheel on EVERY path — the
 * pan and the zoom are the viewport's transform (view state, no data), so
 * the page / the enclosing container never scrolls from a canvas wheel (the
 * zero-delta wheel is a no-op for the viewport but must still not chain to
 * the page's scrollbar). The step zoom's delta accumulates to the threshold
 * (the mouse's notch, the trackpad's small events). */
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import type { CanvasViewportState } from "../../canvas";
import { WHEEL_ZOOM_DELTA } from "./constants";
import { wheelGesture, wheelPanDeltas } from "./utils";

function useCanvasWheel(
  containerRef: RefObject<HTMLDivElement | null>,
  viewportRef: RefObject<CanvasViewportState>
): void {
  // The wheel's delta accumulator (the zoom step crosses the threshold —
  // the remainder stands over to the next event, the trackpad's momentum
  // feel).
  const wheelDeltaRef = useRef(0);
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const onWheel = (event: WheelEvent) => {
      // Consume the wheel on every path (the pan, the zoom, and the
      // zero-delta no-op alike) — the page / the container never scrolls
      // from a canvas wheel (the preventDefault stands before the gesture
      // branch, so no path leaks to the page's scroll chain).
      event.preventDefault();
      const viewport = viewportRef.current;
      if (
        wheelGesture(viewport.mode, viewport.activeTool, {
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        }) === "zoom"
      ) {
        const rect = container.getBoundingClientRect();
        const point = {
          x: event.clientX - (rect.left + rect.width / 2),
          y: event.clientY - (rect.top + rect.height / 2),
        };
        // The pinch: the continuous zoom (the smooth stand — the discrete
        // step's threshold stood the jerk).
        if (event.ctrlKey || event.metaKey) {
          viewport.pinchAt(point, event.deltaY);
          return;
        }
        wheelDeltaRef.current += event.deltaY;
        if (Math.abs(wheelDeltaRef.current) < WHEEL_ZOOM_DELTA) return;
        const direction = wheelDeltaRef.current > 0 ? -1 : 1;
        wheelDeltaRef.current = 0;
        viewport.zoomAt(point, direction);
        return;
      }
      const deltas = wheelPanDeltas(event.deltaX, event.deltaY, event.shiftKey);
      if (deltas.dx === 0 && deltas.dy === 0) return;
      viewport.setPan({ x: viewport.pan.x + deltas.dx, y: viewport.pan.y + deltas.dy });
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);
}

export { useCanvasWheel };
