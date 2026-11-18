// The diagram's viewport: the mermaid preview's pan/zoom + the resizable
// height (the embed's persisted-view's idiom over the diagram's stand).
// The view stands the code block's `zoom` / `panX` / `panY` attrs (the
// null idiom: null / absent = the identity) and the stretched height
// stands the `height` attr (null / absent = the diagram's natural's
// height) — the reload restores the view and the panes share it over the
// wire (a pane's gesture writes over the doc, the others adopt it). The
// observing gestures (the wheel, the drag-pan, the toolbar) stand over
// every mode; the resize's handle stands the editing surface's gate.
import { useTranslation } from "react-i18next";

import { useEffect, useRef, useState } from "react";

import type { BlockId, CodeBlock } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { Button } from "../shared/ui/Button";
import { Maximize, Minus, Plus, RotateCcw } from "../shared/ui/icons";
import { clamp, preventDefault } from "../shared/utils";

/** The zoom range (the min / max scale). */
const VIEWPORT_MIN_SCALE = 0.25;
const VIEWPORT_MAX_SCALE = 4;
/** The toolbar's multiplicative zoom step (per in / out press). */
const VIEWPORT_ZOOM_STEP = 1.2;
/** The wheel's continuous zoom factor (the exponential of the delta, the canvas pinch idiom). */
const VIEWPORT_WHEEL_ZOOM = 0.002;
/** The view's persist debounce (the gesture's bursts stand one doc write per rest). */
const VIEWPORT_PERSIST_DEBOUNCE_MS = 250;
/** The height's minimum (px): the toolbar's usable area's stand (the non-CSS environment's parity). */
const VIEWPORT_MIN_HEIGHT = 160;
/** The resize handle's key step (px per arrow press). */
const VIEWPORT_RESIZE_KEY_STEP = 16;

interface ViewportView {
  scale: number;
  x: number;
  y: number;
}

/** The identity view: the diagram at its natural size, no pan. */
const VIEWPORT_IDENTITY: ViewportView = { scale: 1, x: 0, y: 0 };

/** The view over the block's persisted attrs (the null idiom's restore). */
function viewOfAttrs(
  zoom: number | null | undefined,
  panX: number | null | undefined,
  panY: number | null | undefined
): ViewportView {
  return { scale: zoom ?? 1, x: panX ?? 0, y: panY ?? 0 };
}

/**
 * The view's wire stand: the gesture's floating-point's residue must not
 * stand a non-identity's persist (the zoom-out/in's round-trip lands the
 * 0.9999…'s "identity"). The zoom's round to the label's 1%'s precision,
 * the pan's to the 0.1 px (the sub-pixel's residue stands the identity).
 */
function roundViewValue(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** The diagram's natural size (the transform's no-op's stand — the
 *  transform never affects the layout). The svg's box (the diagram's
 *  true extent) over the layer's box (the no-svg's stand — the error /
 *  the loading's states). */
function measureContent(layer: HTMLElement | null): { w: number; h: number } {
  if (layer === null) return { w: 0, h: 0 };
  const svg = layer.querySelector("svg");
  const w = svg !== null ? svg.clientWidth || layer.clientWidth : layer.clientWidth;
  const h = svg !== null ? svg.clientHeight || layer.clientHeight : layer.clientHeight;
  return { w, h };
}

/**
 * Clamp the pan against the scaled diagram's overflow over the wrapper:
 * the rendered diagram bigger than the wrapper bounds the pan (the
 * diagram's edge reaches the wrapper's edge at most), smaller centers it.
 */
function clampPan(
  scale: number,
  x: number,
  y: number,
  wrapW: number,
  wrapH: number,
  contentW: number,
  contentH: number
): { x: number; y: number } {
  if (wrapW <= 0 || wrapH <= 0) return { x, y };
  const cw = contentW > 0 ? contentW : wrapW;
  const ch = contentH > 0 ? contentH : wrapH;
  const rx = cw * scale;
  const ry = ch * scale;
  return {
    x: rx > wrapW ? clamp(x, wrapW - rx, 0) : (wrapW - rx) / 2,
    y: ry > wrapH ? clamp(y, wrapH - ry, 0) : (wrapH - ry) / 2,
  };
}

/** Zoom keeping the screen point `(cx, cy)` fixed: the content under it stands. */
function zoomAtPoint(view: ViewportView, cx: number, cy: number, nextScale: number): ViewportView {
  const factor = nextScale / view.scale;
  return { scale: nextScale, x: cx - (cx - view.x) * factor, y: cy - (cy - view.y) * factor };
}

/**
 * The diagram's viewport over one mermaid code block (the `nested`'s
 * stand — the diagram + the legacy's nested children render inside the
 * transform's layer). The wrapper's height stands the `height` attr
 * (the stretched stand; absent = the natural's auto's stand).
 */
function MermaidViewport({ id, block, children }: { id: BlockId; block: CodeBlock; children: React.ReactNode }) {
  const { t } = useTranslation("blocks");
  const { doc, viewMode } = useEditorContext();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  // The view stands the block's persisted attrs (the reload's restore),
  // the null idiom's identity over the absent / the cleared attrs.
  const [view, setView] = useState<ViewportView>(() =>
    viewOfAttrs(block.attrs?.zoom, block.attrs?.panX, block.attrs?.panY)
  );
  const viewRef = useRef(view);
  viewRef.current = view;
  // The stretched height's stand (the null idiom: null = the natural's
  // auto). The drag updates the state live, the rest's commit stands the
  // doc's write; the peer's write stands the adopt.
  const [height, setHeight] = useState<number | null>(block.attrs?.height ?? null);
  const heightRef = useRef(height);
  heightRef.current = height;
  // The pan's session (the left-button's drag over the diagram's area —
  // the diagram's content is non-interactive, so the unmodified drag
  // stands the pan; the toolbar's / the handle's targets keep theirs).
  const panSession = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  // The resize's session (the drag's start: the pointer's Y, the wrapper's
  // rect's height; the live's last height — the commit's stand). The
  // delta stands from the drag's START (the linear's stand — the
  // embed's parity: a moving session's height re-adds the accumulated
  // delta and super-linearizes the drag).
  const resizeSession = useRef<{ pointerId: number; startY: number; startHeight: number; lastHeight: number } | null>(
    null
  );

  /** The clamped view over the measured's boxes (the gesture's helper). */
  const clampView = (next: ViewportView): ViewportView => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const content = measureContent(layerRef.current);
    return {
      scale: next.scale,
      ...clampPan(next.scale, next.x, next.y, rect?.width ?? 0, rect?.height ?? 0, content.w, content.h),
    };
  };

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
      setView(next);
    };
    wrapper.addEventListener("wheel", onWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", onWheel);
    // The listener reads the live state over the refs (the mount's stand).
  }, []);

  /** The toolbar's center-anchored zoom (the wrapper's center stands fixed). */
  const zoomBy = (step: number) => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const rect = wrapper.getBoundingClientRect();
    const content = measureContent(layerRef.current);
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

  const resetView = () => setView(clampView(VIEWPORT_IDENTITY));
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
   * The fit's stand (the default's restore for the large diagram): the
   * scale's min over the width / height's ratio, capped at 1 (the small
   * diagram's stand the natural's size — no upscaling), centered over the
   * visible viewport's box (the clipped stand included). The no-content's
   * stand (the error / loading's states): the no-op.
   */
  const fitView = () => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const rect = wrapper.getBoundingClientRect();
    const content = measureContent(layerRef.current);
    if (rect.width <= 0 || rect.height <= 0 || content.w <= 0 || content.h <= 0) return;
    const scale = clamp(
      Math.min(rect.width / content.w, rect.height / content.h, 1),
      VIEWPORT_MIN_SCALE,
      VIEWPORT_MAX_SCALE
    );
    setView({ scale, x: (rect.width - content.w * scale) / 2, y: (rect.height - content.h * scale) / 2 });
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
    const clamped = clampView(target);
    const v = viewRef.current;
    if (clamped.scale === v.scale && clamped.x === v.x && clamped.y === v.y) return;
    setView(clamped);
  }, [block.attrs]);

  /** The remote's stand over the height (the panes' shared stand over the
   *  wire — the adopt's parity over the embed's idiom). */
  useEffect(() => {
    const attrHeight = block.attrs?.height ?? null;
    if (attrHeight === heightRef.current) return;
    setHeight(attrHeight);
  }, [block.attrs]);

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
    setView((v) => clampView({ scale: v.scale, x: v.x + dx, y: v.y + dy }));
  };

  const endPan = (event: React.PointerEvent) => {
    const session = panSession.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    wrapperRef.current?.releasePointerCapture(event.pointerId);
    panSession.current = null;
  };

  // The bottom-edge's resize (the stretch's stand): the drag's live's
  // height + the doc's write over the rest (the `height`'s attr; the
  // under-minimum's rest stands the natural's auto's restore).
  const onResizePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    const startHeight = wrapper.getBoundingClientRect().height;
    resizeSession.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight,
      lastHeight: startHeight,
    };
  };

  const onResizePointerMove = (event: React.PointerEvent) => {
    const session = resizeSession.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    const next = Math.max(session.startHeight + (event.clientY - session.startY), VIEWPORT_MIN_HEIGHT);
    session.lastHeight = next;
    setHeight(next);
  };

  const endResize = (event: React.PointerEvent) => {
    const session = resizeSession.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    resizeSession.current = null;
    const committed = Math.round(session.lastHeight);
    const current = block.attrs?.height ?? null;
    if (committed <= VIEWPORT_MIN_HEIGHT) {
      if (current !== null) doc.updateBlock(id, { height: null });
    } else if (committed !== current) {
      doc.updateBlock(id, { height: committed });
    }
  };

  // The keyboard's stand (the slider's idiom): the arrows stretch /
  // shrink over the step (the under-minimum's stand the auto's restore),
  // the commit's rest stands one key press.
  const onResizeKeyDown = (event: React.KeyboardEvent) => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const delta =
      event.key === "ArrowDown" ? VIEWPORT_RESIZE_KEY_STEP : event.key === "ArrowUp" ? -VIEWPORT_RESIZE_KEY_STEP : null;
    if (delta === null) return;
    event.preventDefault();
    const current = Math.max(heightRef.current ?? wrapper.clientHeight, 0);
    const next = Math.max(current + delta, VIEWPORT_MIN_HEIGHT);
    setHeight(next <= VIEWPORT_MIN_HEIGHT ? null : next);
    const value = next <= VIEWPORT_MIN_HEIGHT ? null : next;
    const persisted = block.attrs?.height ?? null;
    if (value === persisted) return;
    doc.updateBlock(id, { height: value });
  };

  return (
    <div
      ref={wrapperRef}
      data-slot="docblocks/mermaid-viewport"
      // The island's boundary: the diagram's content is out of the page's
      // editable flow (the caret and the selection never stand in it).
      contentEditable={false}
      className="group relative mt-(--docblocks-block-spacing) w-full overflow-hidden outline-none"
      style={{
        ...(height !== null ? { height: Math.max(height, VIEWPORT_MIN_HEIGHT) } : {}),
        cursor: panSession.current !== null ? "grabbing" : "grab",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      {/* The transform's layer: the pan/zoom's stand over the diagram's
          natural's size (the transform never affects the layout — the
          wrapper's clip stands the viewport). */}
      <div
        ref={layerRef}
        data-slot="docblocks/mermaid-viewport-layer"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
      {/* The hover / focus reveal (the embed's toolbar's idiom): invisible
          and unclickable unless the wrapper is hovered or a zoom control
          holds the keyboard focus (the wrapper's focus-within). The
          opacity (not the display) hides it, so the controls stay in the
          Tab's path. */}
      <div
        data-slot="docblocks/mermaid-viewport-toolbar"
        className="
          pointer-events-none absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 rounded-(--docblocks-radius)
          border-(length:--docblocks-divider-border-width) border-(--docblocks-divider-border-color)
          bg-(--docblocks-page-card-background) p-0.5 text-(--docblocks-text-color) opacity-0
          shadow-(--docblocks-formatbar-shadow) transition-opacity
          group-focus-within:pointer-events-auto group-focus-within:opacity-100
          group-hover:pointer-events-auto group-hover:opacity-100
        "
      >
        <Button
          data-slot="docblocks/mermaid-zoom-out"
          variant="ghost"
          size="icon"
          aria-label={t("code.diagramZoomOut")}
          className="size-6 cursor-default rounded-sm text-(--docblocks-text-color) disabled:opacity-50"
          disabled={view.scale <= VIEWPORT_MIN_SCALE}
          onMouseDown={preventDefault}
          onClick={zoomOut}
        >
          <Minus className="size-4" />
        </Button>
        <span
          data-slot="docblocks/mermaid-zoom"
          className="min-w-10 px-1 text-center text-xs text-(--docblocks-text-color) tabular-nums"
        >
          {Math.round(view.scale * 100)}%
        </span>
        <Button
          data-slot="docblocks/mermaid-zoom-in"
          variant="ghost"
          size="icon"
          aria-label={t("code.diagramZoomIn")}
          className="size-6 cursor-default rounded-sm text-(--docblocks-text-color) disabled:opacity-50"
          disabled={view.scale >= VIEWPORT_MAX_SCALE}
          onMouseDown={preventDefault}
          onClick={zoomIn}
        >
          <Plus className="size-4" />
        </Button>
        <Button
          data-slot="docblocks/mermaid-fit"
          variant="ghost"
          size="icon"
          aria-label={t("code.diagramFit")}
          className="size-6 cursor-default rounded-sm text-(--docblocks-text-color)"
          onMouseDown={preventDefault}
          onClick={fitView}
        >
          <Maximize className="size-4" />
        </Button>
        <Button
          data-slot="docblocks/mermaid-zoom-reset"
          variant="ghost"
          size="icon"
          aria-label={t("code.diagramZoomReset")}
          className="size-6 cursor-default rounded-sm text-(--docblocks-text-color) disabled:opacity-50"
          disabled={atIdentity}
          onMouseDown={preventDefault}
          onClick={resetView}
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>
      {/* The bottom-edge's resize handle (the stretch's stand): the hover
          / focus's reveal (the grip's bar), the drag's live's height + the
          doc's write over the rest (the `height`'s attr's stand, the
          panes' shared view). The read-only's stand: the handle stands
          absent (the editing surface's gate). */}
      {!viewMode && (
        <div
          data-slot="docblocks/mermaid-resize"
          role="slider"
          aria-orientation="vertical"
          aria-valuemin={VIEWPORT_MIN_HEIGHT}
          aria-valuenow={Math.max(
            height ?? wrapperRef.current?.clientHeight ?? VIEWPORT_MIN_HEIGHT,
            VIEWPORT_MIN_HEIGHT
          )}
          aria-label={t("code.diagramResizeHeight")}
          tabIndex={0}
          className="
            absolute inset-x-0 bottom-0 z-10 flex h-2 cursor-row-resize items-end justify-center opacity-0
            transition-opacity outline-none
            group-focus-within:opacity-100
            group-hover:opacity-100
          "
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onKeyDown={onResizeKeyDown}
        >
          <div className="mb-0.5 h-0.5 w-10 rounded-full bg-(--docblocks-divider-border-color)" />
        </div>
      )}
    </div>
  );
}

export { MermaidViewport };
