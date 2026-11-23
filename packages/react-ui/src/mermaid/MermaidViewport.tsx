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

import { useRef } from "react";

import type { BlockId, CodeBlock } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { Button } from "../shared/ui/Button";
import { Maximize, Minus, Plus, RotateCcw } from "../shared/ui/icons";
import { preventDefault } from "../shared/utils";
import { VIEWPORT_MAX_SCALE, VIEWPORT_MIN_SCALE } from "./mermaid-viewport-view";
import { VIEWPORT_MIN_HEIGHT, useMermaidHeight } from "./use-mermaid-height";
import { useMermaidPan } from "./use-mermaid-pan";
import { useMermaidViewportView } from "./use-mermaid-viewport-view";

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
  const { view, setView, viewRef, markExplicit, clampView, zoomIn, zoomOut, resetView, fitView, atIdentity } =
    useMermaidViewportView({ id, block, doc, wrapperRef, layerRef });
  const { panSession, onPointerDown, onPointerMove, endPan } = useMermaidPan({
    wrapperRef,
    layerRef,
    viewRef,
    clampView,
    markExplicit,
    setView,
  });
  const { height, onResizePointerDown, onResizePointerMove, endResize, onResizeKeyDown } = useMermaidHeight({
    id,
    block,
    doc,
    wrapperRef,
  });

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
