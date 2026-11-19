/** The canvas viewport's fit's stand: the content's union box (the page
 * miniature + the surface items + the connector's free points) centered
 * at the viewport's center at the smallest zoom that fits both axes
 * (the 25%–400% clamp). The empty canvas stands the no-op (the zoom and
 * the pan keep). The doc's own read stands in the gesture (the handler
 * is the chrome's memo input — the stable callback reads the live doc,
 * not a render closure). The entry's stand: the stored state's restore
 * (the viewport's init — no stand flash) or the fit (the no-stored-state's
 * first visit — the container's rect is the mount's read). The stale
 * stored state's stand (the off-document's pan's stand): the restored
 * viewport's rect over the content's box — the empty's intersection
 * stands the fit, the partial's intersection stands the restore's
 * stand. */
import { useCallback, useEffect, useRef } from "react";

import type { Doc } from "docblocks-core";

import { canvasContentBox, fitView } from "../../canvas";
import { rectsIntersect } from "../viewport";
import type { CanvasViewportState } from "../viewport";
import { visibleWorldRectOf } from "./culling";

function useCanvasFit(
  doc: Doc,
  containerRef: { current: HTMLDivElement | null },
  storedViewport: { zoom: number; pan: { x: number; y: number } } | null,
  viewport: CanvasViewportState & { setZoom: (zoom: number) => void; setPan: (pan: { x: number; y: number }) => void }
): () => void {
  // The latest viewport (the gesture's live read — the callback stands
  // the stable identity, the zoom / pan's writes stand the current state).
  const viewportRef = useRef(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  });

  const onFit = useCallback(() => {
    const container = containerRef.current;
    if (container === null) return;
    const rect = container.getBoundingClientRect();
    const content = canvasContentBox(doc);
    if (content === null) return;
    const stand = fitView(content, { width: rect.width, height: rect.height });
    if (stand === null) return;
    const live = viewportRef.current;
    live.setZoom(stand.zoom);
    live.setPan(stand.pan);
  }, [doc, containerRef]);

  useEffect(() => {
    if (storedViewport === null) {
      onFit();
      return;
    }
    // The stale stored state's stand (the off-document's pan's stand —
    // the pan / the container's size's / the content's drift over the
    // storage's window): the restored viewport's rect (the margin's
    // zero stand — the visible's stand, not the cull's band's) over the
    // content's box. The empty's intersection stands the fit (the
    // off-document's pan's stand), the partial's intersection stands
    // the restore (the user's stand is kept). The
    // empty canvas's stand (no content) stands the restore (the fit's
    // no-op's parity — nothing to fit over).
    const container = containerRef.current;
    if (container === null) return;
    const rect = container.getBoundingClientRect();
    const content = canvasContentBox(doc);
    if (content === null) return;
    const visible = visibleWorldRectOf(storedViewport.zoom, storedViewport.pan, {
      width: rect.width,
      height: rect.height,
    }, 0);
    if (visible === null) return;
    const contentRect = {
      left: content.x - content.w / 2,
      top: content.y - content.h / 2,
      width: content.w,
      height: content.h,
    };
    if (!rectsIntersect(visible, contentRect)) onFit();
  }, [onFit, storedViewport, doc, containerRef]);

  return onFit;
}

export { useCanvasFit };
