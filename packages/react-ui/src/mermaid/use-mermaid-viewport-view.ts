/** The mermaid viewport's view state: the persisted view's restore, the
 *  geometry's settle (the load-time fit / the pan's re-clamp), the zoom's
 *  controls, and the view's persist / remote adopt (the panes' shared
 *  stand over the wire). */
import { useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { BlockId, CodeBlock, Doc } from "docblocks-core";

import { clamp } from "../shared/utils";
import {
  VIEWPORT_IDENTITY,
  VIEWPORT_MAX_SCALE,
  VIEWPORT_MIN_SCALE,
  VIEWPORT_PERSIST_DEBOUNCE_MS,
  VIEWPORT_ZOOM_STEP,
  clampPan,
  measureContent,
  roundViewValue,
  viewOfAttrs,
  zoomAtPoint,
} from "./mermaid-viewport-view";
import type { ViewportView } from "./mermaid-viewport-view";

function useMermaidViewportView({
  id,
  block,
  doc,
  wrapperRef,
  layerRef,
}: {
  id: BlockId;
  block: CodeBlock;
  doc: Doc;
  wrapperRef: RefObject<HTMLDivElement | null>;
  layerRef: RefObject<HTMLDivElement | null>;
}): {
  view: ViewportView;
  setView: Dispatch<SetStateAction<ViewportView>>;
  viewRef: RefObject<ViewportView>;
  explicitViewRef: RefObject<boolean>;
  markExplicit: () => void;
  clampView: (next: ViewportView) => ViewportView;
  fitView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  atIdentity: boolean;
} {
  // The view stands the block's persisted attrs (the reload's restore),
  // the null idiom's identity over the absent / the cleared attrs.
  const [view, setView] = useState<ViewportView>(() =>
    viewOfAttrs(block.attrs?.zoom, block.attrs?.panX, block.attrs?.panY)
  );
  const viewRef = useRef(view);
  viewRef.current = view;
  // The explicit-view stand: the persisted attrs at the mount (the
  // reload's restore) or an explicit gesture (and the peer's adopted
  // write) stand the user's view — the load-time default (the fit) stands
  // only while nothing explicit has happened.
  const explicitViewRef = useRef(block.attrs?.zoom != null || block.attrs?.panX != null || block.attrs?.panY != null);
  // The persist gate: only an explicit gesture writes the view back (the
  // mount's default / the adopt / the re-clamp stand the canonical's
  // no-write — a default's write would leave a garbage pan behind).
  const persistGateRef = useRef(false);

  /** The explicit gesture's stand: the view is the user's (the load-time fit stops re-applying) and the write-back opens. */
  const markExplicit = () => {
    explicitViewRef.current = true;
    persistGateRef.current = true;
  };

  /** The fit's view over the measured's boxes (the scale's min, the no-upscale's cap, the centering). */
  const fitViewOf = (): ViewportView | null => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const content = measureContent(layerRef.current);
    if (rect === undefined || rect.width <= 0 || rect.height <= 0 || content.w <= 0 || content.h <= 0) return null;
    const scale = clamp(
      Math.min(rect.width / content.w, rect.height / content.h, 1),
      VIEWPORT_MIN_SCALE,
      VIEWPORT_MAX_SCALE
    );
    return { scale, x: (rect.width - content.w * scale) / 2, y: (rect.height - content.h * scale) / 2 };
  };

  /** The clamped view over the measured's boxes (the gesture's helper). */
  const clampView = (next: ViewportView): ViewportView => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const content = measureContent(layerRef.current);
    return {
      scale: next.scale,
      ...clampPan(next.scale, next.x, next.y, rect?.width ?? 0, rect?.height ?? 0, content.w, content.h),
    };
  };

  /**
   * The geometry's stand: the mount's wrapper / layer boxes are not final
   * (the page's layout settles post-mount) and the diagram's svg lands
   * AFTER the mount (mermaid renders async), so the mount-time measure
   * reads the loading skeleton's box. Over the settled boxes:
   * - no explicit view yet (nothing persisted, no gesture): the load-time
   *   default stands — the FIT (the whole diagram in the frame, centered,
   *   capped at 100%);
   * - an explicit view stands (the reload's restore, a gesture, a peer's
   *   write): the pan re-clamps into the box (the view never lands
   *   unclamped).
   * The observer stands both when the boxes change (the svg's appearance,
   * the consumer's re-layout) and on its initial observe; none of it
   * touches the wire (see the persist gate).
   */
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const layer = layerRef.current;
    if (wrapper === null || layer === null) return;
    // The environment without the observer (jsdom — no layout): the unit
    // tests drive the geometry explicitly.
    if (typeof ResizeObserver === "undefined") return;
    const settle = () => {
      const current = viewRef.current;
      const next = explicitViewRef.current ? clampView(current) : fitViewOf();
      if (next === null) return;
      if (next.scale === current.scale && next.x === current.x && next.y === current.y) return;
      setView(next);
    };
    const observer = new ResizeObserver(settle);
    observer.observe(wrapper);
    observer.observe(layer);
    return () => observer.disconnect();
    // The observer reads the live state over the refs (the mount's stand).
  }, []);

  /** The toolbar's center-anchored zoom (the wrapper's center stands fixed). */
  const zoomBy = (step: number) => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const rect = wrapper.getBoundingClientRect();
    const content = measureContent(layerRef.current);
    markExplicit();
    setView((v) => {
      const nextScale = clamp(v.scale * step, VIEWPORT_MIN_SCALE, VIEWPORT_MAX_SCALE);
      if (nextScale === v.scale) return v;
      const zoomed = zoomAtPoint(v, rect.width / 2, rect.height / 2, nextScale);
      return {
        scale: nextScale,
        ...clampPan(nextScale, zoomed.x, zoomed.y, rect.width, rect.height, content.w, content.h),
      };
    });
  };

  const zoomIn = () => zoomBy(VIEWPORT_ZOOM_STEP);
  const zoomOut = () => zoomBy(1 / VIEWPORT_ZOOM_STEP);

  const resetView = () => {
    markExplicit();
    setView(clampView(VIEWPORT_IDENTITY));
  };
  // The identity's canonical's stand (the clamped's parity): the sub-
  // wrapper content's centering's offset is the identity's canonical's
  // coordinate, so the raw's identity must not stand the reset's
  // disabled's false over the clamped's reset.
  const atIdentity = (() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const content = measureContent(layerRef.current);
    const clamped = clampPan(VIEWPORT_IDENTITY.scale, 0, 0, rect?.width ?? 0, rect?.height ?? 0, content.w, content.h);
    return view.scale === VIEWPORT_IDENTITY.scale && view.x === clamped.x && view.y === clamped.y;
  })();

  /**
   * The fit's stand (the load-time default and the toolbar's restore for
   * the large diagram): the scale's min over the width / height's ratio,
   * capped at 1 (the small diagram's stand the natural's size — no
   * upscaling), centered over the visible viewport's box (the clipped
   * stand included). The no-content's stand (the error / loading's
   * states): the no-op. The button's press stands the explicit view (the
   * persisted write follows).
   */
  const fitView = () => {
    const next = fitViewOf();
    if (next === null) return;
    markExplicit();
    setView(next);
  };

  /**
   * The persisted view's write (the debounce over the gesture's bursts):
   * the non-identity view stands the block's attrs (the null idiom: the
   * identity parts stand `null`, the reader's restore), so the reload's /
   * the new tab's diagram stands the same view. The canonical's stand:
   * the write stands the clamped view (the centering's offset over the
   * sub-wrapper content's stand the canonical's coordinate — the peer's
   * adopt's clamped read stands the no-write parity over it: a raw
   * identity's persist stands the peer's re-centering's write-back over
   * the wire, the reset's no-restore's stand). The no-op stand: a view
   * equal to the block's own attrs writes nothing (no updatedAt's stamp,
   * no wire update).
   */
  useEffect(() => {
    // Only an explicit gesture writes the view back: the load-time fit,
    // the adopt of a peer's write, and the geometry's re-clamp stand no
    // write (a default's persist would leave a garbage pan behind).
    if (!persistGateRef.current) return;
    persistGateRef.current = false;
    const clamped = clampView(view);
    const zoom = roundViewValue(clamped.scale, 2);
    const x = roundViewValue(clamped.x, 1);
    const y = roundViewValue(clamped.y, 1);
    // The canonical's no-op's stand: the view's canonical stands the
    // attrs' canonical (the attrs' raw stand clamped to the same wrapper
    // — the mount's normalization's no-write's parity: a peer's mount's
    // canonical's write must not stand over the local's view's write
    // over the wire — the zoom's lost's race's no-stand).
    const attrs = block.attrs ?? {};
    const canonical = clampView({
      scale: attrs.zoom ?? 1,
      x: attrs.panX ?? 0,
      y: attrs.panY ?? 0,
    });
    if (
      zoom === roundViewValue(canonical.scale, 2) &&
      x === roundViewValue(canonical.x, 1) &&
      y === roundViewValue(canonical.y, 1)
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      doc.updateBlock(id, { zoom: zoom === 1 ? null : zoom, panX: x === 0 ? null : x, panY: y === 0 ? null : y });
    }, VIEWPORT_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [view, block.attrs, doc, id]);

  /**
   * The remote's stand: the panes share the persisted view over the wire —
   * a pane's peer lands a view different from the local's (the block's
   * attrs stand the peer's write), so the local's view adopts it. Own
   * writes land equal to the local's view and stand no adopt. The adopt
   * clamps the restored pan to the current wrapper (a stale pan over a
   * narrower pane's clip must not blank the diagram; the clamp's
   * centering over the sub-wrapper content's stand the canonical's
   * coordinate the persist writes — the mount's stand included: the
   * initial raw's view clamps to its canonical's stand).
   */
  useEffect(() => {
    const target = {
      scale: block.attrs?.zoom ?? 1,
      x: block.attrs?.panX ?? 0,
      y: block.attrs?.panY ?? 0,
    };
    const persisted = block.attrs?.zoom != null || block.attrs?.panX != null || block.attrs?.panY != null;
    const clamped = clampView(target);
    const v = viewRef.current;
    if (clamped.scale === v.scale && clamped.x === v.x && clamped.y === v.y) return;
    // The adopted view is an explicit one (the peer's gesture or the
    // reload's restore): the load-time fit stops re-applying.
    if (persisted) explicitViewRef.current = true;
    setView(clamped);
  }, [block.attrs]);

  return {
    view,
    setView,
    viewRef,
    explicitViewRef,
    markExplicit,
    clampView,
    fitView,
    zoomIn,
    zoomOut,
    resetView,
    atIdentity,
  };
}

export { useMermaidViewportView };
