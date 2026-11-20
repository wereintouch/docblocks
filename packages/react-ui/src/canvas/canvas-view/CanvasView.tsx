/** The canvas's view body: the session's hooks (the pointer's sessions
 * over the store's slices, the keys' hotkeys, the wheel's pan / zoom,
 * the viewport's persistence), the target's reads (the handles' / the
 * toolbars' / the preview's reads over the selection + the blocks), and
 * the surface's assembly (CanvasSurface — the paint). The viewport's
 * state stands in the store (the per-item subscriptions stand the
 * re-render contract — the body's re-render stands the shallow JSX, the
 * memoized children bail). */
import { useStore } from "zustand";

import { useEffect, useMemo, useRef, useState } from "react";

import { CanvasViewportStoreContext, readCanvasViewport, useCanvasViewport } from "../../canvas";
import { useEditorContext } from "../../editor-provider";
import { useBlock } from "../../hooks";
import { CanvasTextEditProvider } from "../canvas-text-edit-context";
import { CanvasSurface } from "./CanvasSurface";
import { useCanvasCulling } from "./culling";
import type { CanvasPointerSession, PendingCycleStep } from "./models";
import { useCanvasFit } from "./use-canvas-fit";
import { useCanvasKeys } from "./use-canvas-keys";
import { useCanvasSessions } from "./use-canvas-sessions";
import { useCanvasTargets } from "./use-canvas-targets";
import { useCanvasWheel } from "./use-canvas-wheel";
import { pageCardDisplayStyleOf } from "./utils";

function CanvasView() {
  const { store, doc, rootBlockId, selection, viewMode } = useEditorContext();
  const rootChildren = useStore(store, (state) => state.rootChildren);
  // The canvas chrome stands over the surfaces' chrome data (the items'
  // geometry, the connectors' attrs) + the root's own structure: the
  // chrome stamp keys the re-render (an O(1) read — the per-surface JSON
  // digest stood the O(siblings) stand per store notification); a
  // content-only change stands no bump (the figure's text keeps the
  // chrome's memos). The hooks' `blocks` input is the render-time state
  // (a stale map holds the unchanged blocks' own references — the
  // geometry stands between the stamp's changes).
  const chromeStamp = useStore(store, (state) => state.chromeStamp);
  // The reactive selection (the handles' render condition): the context's
  // `selection` handle is stable, so the store slice drives the re-render.
  const storeSelection = useStore(store, (state) => state.selection);
  const root = useBlock(rootBlockId);
  // The viewport's browser persistence:
  // the restored state (the storage's read, once on mount) over the fit's
  // stand (no stored state — the fit's mount stand below).
  const [storedViewport] = useState(() => readCanvasViewport(doc.meta.id));
  // The hooks' blocks input (the render-time state, memoized over the
  // digest: a text-only change stands no new map — the stale map holds the
  // unchanged blocks' own references, the geometry stands between the
  // digest's changes).
  const blocks = useMemo(() => store.getState().blocks, [chromeStamp, rootChildren, storeSelection, store]);
  const viewport = useCanvasViewport(doc, storedViewport);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<CanvasPointerSession | null>(null);
  // The editing surfaces' first press stands the move session over the
  // content (the two-click contract — the page miniature's card and the
  // canvas-text's inner): the flag drops the compatibility mousedown's
  // default (the caret / the focus move).
  const cardPressRef = useRef(false);
  // The connector's press point (screen px): the press-drag's release
  // threshold (a sub-threshold press-release cancels the stand instead of
  // committing the free end).
  const connectorPressClientRef = useRef<{ x: number; y: number } | null>(null);
  // The last pointer position (the container-center-relative screen px):
  // the paste's seat point (the copy's union center lands at the pointer
  // — the world position stands the conversion at the paste's own
  // zoom / pan, the viewport center over no pointer).
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  // The plain repeat press's pending drill-down step (the release applies it
  // over a click; a drag stands the move instead).
  const cycleStepRef = useRef<PendingCycleStep | null>(null);
  const [spacePan, setSpacePan] = useState(false);
  // The wheel listener's live viewport (the latest render's state and
  // callbacks): the native listener subscribes once on mount — re-running
  // the subscription on every pan / zoom change (the effect's former deps)
  // tore and re-added the listener on the wheel's own events.
  const viewportRef = useRef(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  });
  useCanvasWheel(containerRef, viewportRef);
  // The fit's stand + the entry's stand (the stored state's restore or
  // the fit's first visit).
  const onFit = useCanvasFit(doc, containerRef, storedViewport, viewport);

  const {
    pageChildren,
    surfaces,
    pageContext,
    handleTarget,
    displayBox,
    multiSelectionBox,
    shapeToolbarTarget,
    textToolbarTarget,
    arrangeToolbarTarget,
    connectorToolbarTarget,
    connectorLabelTarget,
    selectedConnectorHandles,
    previewFrom,
    previewSnap,
    previewEnd,
    hoverSnapPoint,
  } = useCanvasTargets({ rootChildren, blocks, storeSelection, viewport, rootBlockId });

  // The viewport's culling (the off-viewport items' stand — no DOM of
  // their own): the visible ids over the surfaces' children, the
  // referentially stable stand over the unchanged content (the pan's
  // re-render holds the surfaces' memo). The page miniature stands
  // un-culled (the card is the document's stand, not a surface's item).
  const culling = useCanvasCulling(containerRef, viewport, surfaces, blocks);

  if (root === undefined) return null;

  // The editing surfaces keep the pointer: the canvas-text inners and the
  // page miniature's content (the caret / the text selection).
  const isEditingSurface = (target: EventTarget | null) =>
    target instanceof Element && target.closest('[contenteditable="true"], input, textarea') !== null;

  const {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onMouseDown,
    onPointerCancel,
    dropCanvasSessions,
    beginEndpointDrag,
    onContentDoubleClick,
    onChipPress,
    onChipDoubleClick,
  } = useCanvasSessions({
    containerRef,
    sessionRef,
    lastPointerRef,
    cardPressRef,
    connectorPressClientRef,
    cycleStepRef,
    viewport,
    spacePan,
    blocks,
    doc,
    rootBlockId,
    selection,
    isEditingSurface,
    surfaces,
    handleTarget,
    viewMode,
  });

  const { onKeyDown, onKeyUp } = useCanvasKeys({
    containerRef,
    viewport,
    sessionRef,
    selection,
    doc,
    store,
    lastPointerRef,
    setSpacePan,
    rootBlockId,
    isEditingSurface,
    viewMode,
  });

  const cursor =
    viewport.activeTool !== null
      ? "cursor-crosshair"
      : viewport.mode === "pan" || spacePan
        ? "cursor-grab"
        : "cursor-default";

  // The page miniature's selection (the two-click contract's first press):
  // the card stands the shared selection's outline (like an item) when the
  // root is in the blocks selection.
  const pageCardSelected = storeSelection?.kind === "blocks" && storeSelection.ids.includes(rootBlockId);

  // The page miniature's display style (the committed style + the session
  // previews: the move offset, the resize box — the same composition as
  // the CanvasItem's).
  const pageCardDisplayStyle = pageCardDisplayStyleOf(root, handleTarget, rootBlockId, viewport);

  return (
    <CanvasViewportStoreContext.Provider value={viewport.store}>
      <CanvasTextEditProvider
        editingId={viewport.shapeTextEditing}
        setEditingId={viewport.setShapeTextEditing}
        canvasTextEditingId={viewport.canvasTextEditing}
        setCanvasTextEditingId={viewport.setCanvasTextEditing}
      >
        <CanvasSurface
          containerRef={containerRef}
          cursor={cursor}
          viewport={viewport}
          handlers={{
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel,
            onLostPointerCapture: dropCanvasSessions,
            onMouseDown,
            onDoubleClick: onContentDoubleClick,
            onChipPress,
            onChipDoubleClick,
            onKeyDown,
            onKeyUp,
          }}
          pageContext={pageContext}
          pageChildren={pageChildren}
          pageCardSelected={pageCardSelected}
          pageCardDisplayStyle={pageCardDisplayStyle}
          surfaces={surfaces}
          culling={culling}
          storeSelection={storeSelection}
          blocks={blocks}
          viewMode={viewMode}
          targets={{
            handleTarget,
            displayBox,
            multiSelectionBox,
            shapeToolbarTarget,
            textToolbarTarget,
            arrangeToolbarTarget,
            connectorToolbarTarget,
            connectorLabelTarget,
            selectedConnectorHandles,
            previewFrom,
            previewSnap,
            previewEnd,
            hoverSnapPoint,
          }}
          beginEndpointDrag={beginEndpointDrag}
          onResetZoom={() => viewport.setZoom(1)}
          onFit={onFit}
        />
      </CanvasTextEditProvider>
    </CanvasViewportStoreContext.Provider>
  );
}
export { CanvasView };
