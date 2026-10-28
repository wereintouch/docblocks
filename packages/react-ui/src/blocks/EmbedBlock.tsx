import { useEffect, useRef, useState } from "react";

import type { BlockId, EmbedBlock as EmbedBlockType } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { Minus, Plus, RotateCcw } from "../shared/ui/icons";

/**
 * An embed (v1): a plain iframe for every kind — the kind is a renderer hint
 * only (all kinds render as an iframe; per-kind card renderers come later),
 * so an unknown kind (newer data) still renders the same iframe. `src` is a
 * URL, not a blob key: the consumer's blob resolver does not apply. The
 * iframe stands a `sandbox` attribute — the safe default (no
 * `allow-same-origin`, so the embedded content is an opaque origin and cannot
 * read the parent's DOM / state; scripts, forms, and popups still run) or the
 * consumer's `embedSandbox` policy (grant `allow-same-origin` only for trusted
 * origins). The block is not text-editable, so the wrapper carries no gutter
 * handle.
 *
 * Pan/zoom (view state, decision 2026-10-22): the iframe stands a CSS
 * `translate(x, y) scale(s)` transform (the wrapper clips the overflow). The
 * transform is PURE view state — it is not document data, so `toJSON()`, the
 * wire, and the clipboard never see it (each editor instance owns its own
 * view; the two panes pan/zoom independently). The controls:
 *
 * - the hover toolbar (zoom in / out, the percent, reset) — always stands;
 * - the wheel — `ctrl`/`cmd` zooms at the cursor, a plain wheel pans
 *   vertically (content opposite to the delta, the canvas idiom);
 * - the modifier drag — a `space` / `alt`-held pointer drag pans (the iframe
 *   yields its pointer events to the wrapper while the modifier stands, so an
 *   unmodified drag still reaches the iframe's own interaction).
 *
 * A cross-origin iframe swallows the wheel over its own pixels (the browser
 * delivers it to the iframe's document), so the wheel stands over the
 * wrapper's exposed area and via an explicit dispatch; the hover toolbar is
 * the primary control. Zoom scales the iframe's raster — a strong zoom blurs
 * (the price of the generic cross-origin approach, documented).
 */

/** The zoom range (the min / max scale). */
const EMBED_MIN_SCALE = 0.5;
const EMBED_MAX_SCALE = 4;
/** The toolbar's multiplicative zoom step (per in / out press). */
const EMBED_ZOOM_STEP = 1.2;
/** The wheel's continuous zoom factor (the exponential of the delta, the canvas pinch idiom). */
const EMBED_WHEEL_ZOOM = 0.002;

interface EmbedView {
  scale: number;
  x: number;
  y: number;
}

/** The identity view: the iframe at its natural size, filling the wrapper. */
const EMBED_VIEW_IDENTITY: EmbedView = { scale: 1, x: 0, y: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Clamp the pan against the scaled embed's overflow. The embed cannot be
 * dragged past the container: at `scale <= 1` it fits (or is smaller) and
 * stands centered with no pan; above 1 the pan is bounded by the overflow so
 * the iframe's edge reaches the wrapper's edge at most.
 */
function clampEmbedPan(scale: number, x: number, y: number, width: number, height: number): { x: number; y: number } {
  if (scale <= 1) {
    return { x: (width * (1 - scale)) / 2, y: (height * (1 - scale)) / 2 };
  }
  return {
    x: clamp(x, -width * (scale - 1), 0),
    y: clamp(y, -height * (scale - 1), 0),
  };
}

/** Zoom keeping the screen point `(cx, cy)` fixed: the content under it stands. */
function zoomAtPoint(view: EmbedView, cx: number, cy: number, nextScale: number): EmbedView {
  const factor = nextScale / view.scale;
  return { scale: nextScale, x: cx - (cx - view.x) * factor, y: cy - (cy - view.y) * factor };
}

function EmbedBlock({ id, block }: { id: BlockId; block: EmbedBlockType }) {
  const { kind, src, title } = block.attrs;
  // The embed's sandbox: the policy (the consumer's or the safe default) maps
  // the src to the `sandbox` value; `null` stands no sandbox (a fully trusted
  // embed). The default is opaque-origin (no `allow-same-origin`), so the
  // embedded content cannot read the parent's DOM / state.
  const { embedSandbox } = useEditorContext();
  const sandbox = embedSandbox(src);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<EmbedView>(EMBED_VIEW_IDENTITY);
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

  const resetView = () => setView(EMBED_VIEW_IDENTITY);
  const atIdentity = view.scale === EMBED_VIEW_IDENTITY.scale && view.x === 0 && view.y === 0;

  // The modifier drag-pan: the wrapper's pointerdown stands only when the
  // modifier is held (the iframe yields then) and the target is not the
  // toolbar (its buttons keep their own click).
  const onPointerDown = (event: React.PointerEvent) => {
    if (!panModifier || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button") !== null) return;
    event.preventDefault();
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    wrapper.setPointerCapture(event.pointerId);
    panSession.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
  };

  const onPointerMove = (event: React.PointerEvent) => {
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

  const endPan = (event: React.PointerEvent) => {
    const session = panSession.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    wrapperRef.current?.releasePointerCapture(event.pointerId);
    panSession.current = null;
  };

  return (
    <div
      ref={wrapperRef}
      data-slot="docblocks/block"
      data-block-type="embed"
      data-block-id={id}
      data-kind={kind}
      className="
        group relative my-(--docblocks-block-spacing) h-(--docblocks-embed-height) overflow-hidden
        rounded-(--docblocks-radius) border-(length:--docblocks-divider-border-width)
        border-(--docblocks-divider-border-color) outline-none
      "
      style={{ cursor: panModifier ? (panSession.current !== null ? "grabbing" : "grab") : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <iframe
        data-slot="docblocks/embed"
        src={src}
        title={title ?? kind}
        loading="lazy"
        sandbox={sandbox ?? undefined}
        className="block h-full w-full border-0"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transformOrigin: "0 0",
          pointerEvents: panModifier ? "none" : "auto",
        }}
      />
      <div
        data-slot="docblocks/embed-toolbar"
        className="
          absolute top-1.5 right-1.5 z-10 hidden items-center gap-0.5 rounded-(--docblocks-radius)
          border-(length:--docblocks-divider-border-width) border-(--docblocks-divider-border-color)
          bg-(--docblocks-page-card-background) p-0.5 text-(--docblocks-text-color)
          shadow-(--docblocks-formatbar-shadow)
          group-hover:flex
        "
      >
        <button
          type="button"
          data-slot="docblocks/embed-zoom-out"
          aria-label="Zoom out"
          className="
            flex size-6 cursor-default items-center justify-center rounded-sm text-(--docblocks-text-color)
            hover:bg-accent hover:text-accent-foreground
            disabled:opacity-50
          "
          disabled={view.scale <= EMBED_MIN_SCALE}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => zoomBy(1 / EMBED_ZOOM_STEP)}
        >
          <Minus className="size-3.5" />
        </button>
        <span
          data-slot="docblocks/embed-zoom"
          className="min-w-10 px-1 text-center text-xs text-(--docblocks-text-color) tabular-nums"
        >
          {Math.round(view.scale * 100)}%
        </span>
        <button
          type="button"
          data-slot="docblocks/embed-zoom-in"
          aria-label="Zoom in"
          className="
            flex size-6 cursor-default items-center justify-center rounded-sm text-(--docblocks-text-color)
            hover:bg-accent hover:text-accent-foreground
            disabled:opacity-50
          "
          disabled={view.scale >= EMBED_MAX_SCALE}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => zoomBy(EMBED_ZOOM_STEP)}
        >
          <Plus className="size-3.5" />
        </button>
        <button
          type="button"
          data-slot="docblocks/embed-zoom-reset"
          aria-label="Reset zoom"
          className="
            flex size-6 cursor-default items-center justify-center rounded-sm text-(--docblocks-text-color)
            hover:bg-accent hover:text-accent-foreground
            disabled:opacity-50
          "
          disabled={atIdentity}
          onMouseDown={(event) => event.preventDefault()}
          onClick={resetView}
        >
          <RotateCcw className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export { EmbedBlock };
