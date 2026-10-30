/**
 * The document's canvas view (the `view === "canvas"` mode): the document's
 * page rendered as a page miniature — a positioned vertical rectangle of
 * page proportions holding the root's page children (the non-surface
 * children, in reading order) — at the root's geometry (the center anchor;
 * the default is the canvas center with the default page size), and every
 * root-level surface's elements on the same canvas (the shared origin is
 * the canvas center). The surface container itself has no canvas box here:
 * the canvas view IS the surface. The content stands in a single world
 * wrapper carrying the zoom/pan transform (the transform origin is the
 * container's center; the dot grid follows the pan/zoom as the background
 * position/size). Switching views writes nothing to the data (the view is
 * view state, like the selection).
 *
 * The canvas interaction (the pointer sessions on the container): the pan
 * mode (or the held space) drags the canvas from anywhere; the default
 * mode marquee-selects from the empty canvas (the block selection over the
 * intersecting canvas items; the focus parks on the canvas container so the
 * Delete/Backspace path reaches the selection) and click-selects a single
 * canvas item. The editing surfaces (the canvas-text inners, the page
 * miniature's content) keep their own pointer handling (the caret), and
 * the floating chrome (the zoom controls, the dock) handles its own.
 */
import { useStore } from "zustand";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  CanvasDock,
  ConnectorToolbar,
  ShapeToolbar,
  canvasContentBox,
  canvasToScreen,
  fitView,
  readCanvasViewport,
  useCanvasViewport,
} from "../../canvas";
import { useEditorContext } from "../../editor-provider";
import { useBlock } from "../../hooks";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { cn } from "../../shared/ui/cn";
import { Container } from "../../shared/ui/icons";
import { BlockGroups } from "../BlockView";
import { ShapeSvg } from "../ShapeSvg";
import { BlockContext } from "../block-context";
import { effectiveGeometry, pageCardStyle } from "../canvas-geometry";
import { CanvasTextEditProvider } from "../canvas-text-edit-context";
import { ConnectorLabelChips } from "./ConnectorLabelChip";
import { ConnectorLabelEdit } from "./ConnectorLabelEdit";
import { ConnectorPreviewLine } from "./ConnectorPreviewLine";
import { ConnectorSnapBadge } from "./ConnectorSnapBadge";
import { SurfaceLayer } from "./SurfaceLayer";
import { ZoomControls } from "./ZoomControls";
import {
  CONNECTOR_HANDLE_HIT_RADIUS_PX,
  CONNECTOR_HANDLE_RADIUS_PX,
  RESIZE_HANDLE_POSITIONS,
  TOOLBAR_OFFSET_PX,
} from "./constants";
import type { CanvasPointerSession } from "./models";
import { useCanvasKeys } from "./use-canvas-keys";
import { useCanvasSessions } from "./use-canvas-sessions";
import { useCanvasTargets } from "./use-canvas-targets";
import { useCanvasWheel } from "./use-canvas-wheel";

function CanvasView() {
  const { store, doc, rootBlockId, selection } = useEditorContext();
  const rootChildren = useStore(store, (state) => state.rootChildren);
  const blocks = useStore(store, (state) => state.blocks);
  // The reactive selection (the handles' render condition): the context's
  // `selection` handle is stable, so the store slice drives the re-render.
  const storeSelection = useStore(store, (state) => state.selection);
  const root = useBlock(rootBlockId);
  // The viewport's browser persistence:
  // the restored state (the storage's read, once on mount) over the fit's
  // stand (no stored state — the fit's mount stand below).
  const [storedViewport] = useState(() => readCanvasViewport(doc.meta.id));
  const viewport = useCanvasViewport(doc, storedViewport);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<CanvasPointerSession | null>(null);
  // The page miniature's first press stands the card's move session over
  // the page's content (the two-click contract) — the flag drops the
  // compatibility mousedown's default (the caret / the focus move).
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

  // The fit's stand: the content's union
  // box (the page miniature + the surface items + the connector's free
  // points) centered at the viewport's center at the smallest zoom that
  // fits both axes (the 25%–400% clamp). The empty canvas stands the no-op
  // (the zoom and the pan keep). The doc's own read stands in the gesture
  // (the handler is the chrome's memo input — the stable callback reads
  // the live doc, not a render closure).
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
  }, [doc]);

  // The viewport's entry stand: the
  // stored state's restore (the hook's init — no stand flash) or the fit
  // (the no-stored-state's first visit — the container's rect is the
  // mount's read).
  useEffect(() => {
    if (storedViewport !== null) return;
    onFit();
  }, [onFit, storedViewport]);

  const {
    pageChildren,
    surfaces,
    pageContext,
    handleTarget,
    displayBox,
    multiSelectionBox,
    shapeToolbarTarget,
    connectorToolbarTarget,
    connectorLabelTarget,
    selectedConnectorHandles,
    previewFrom,
    previewSnap,
    previewEnd,
    hoverSnapPoint,
  } = useCanvasTargets({ rootChildren, blocks, storeSelection, viewport, rootBlockId });

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
  } = useCanvasSessions({
    containerRef,
    sessionRef,
    lastPointerRef,
    cardPressRef,
    connectorPressClientRef,
    viewport,
    spacePan,
    blocks,
    doc,
    rootBlockId,
    selection,
    isEditingSurface,
    surfaces,
    handleTarget,
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
  const pageCardDisplayStyle = (() => {
    const style = pageCardStyle(root);
    if (handleTarget === null || handleTarget.id !== rootBlockId) return style;
    const isMoving = viewport.movePreview !== null && viewport.movePreview.ids.includes(rootBlockId);
    const previewBox =
      viewport.resizePreview !== null && viewport.resizePreview.id === rootBlockId ? viewport.resizePreview.box : null;
    if (isMoving === false && previewBox === null) return style;
    if (previewBox !== null) {
      style.left = `calc(50% + ${previewBox.x}px)`;
      style.top = `calc(50% + ${previewBox.y}px)`;
      style.width = `${previewBox.w}px`;
      style.height = `${previewBox.h}px`;
    }
    const parts = ["translate(-50%, -50%)"];
    if (isMoving) parts.push(`translate(${viewport.movePreview!.dx}px, ${viewport.movePreview!.dy}px)`);
    style.transform = parts.join(" ");
    return style;
  })();

  return (
    <CanvasTextEditProvider editingId={viewport.shapeTextEditing} setEditingId={viewport.setShapeTextEditing}>
      <div
        data-slot="docblocks/canvas-view"
        ref={containerRef}
        tabIndex={-1}
        className={
          "relative h-(--docblocks-canvas-view-height) overflow-hidden bg-(--docblocks-canvas-background) " +
          "bg-[radial-gradient(circle,var(--docblocks-canvas-view-dot)_1px,transparent_1px)] focus:outline-none " +
          cursor
        }
        style={{
          // The dot grid follows the pan/zoom (the background position is the
          // container center offset by the pan, the cell is the grid step
          // scaled by the zoom).
          backgroundPosition: `calc(50% + ${viewport.pan.x}px) calc(50% + ${viewport.pan.y}px)`,
          backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={dropCanvasSessions}
        onMouseDown={onMouseDown}
        onDoubleClick={onContentDoubleClick}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      >
        <div
          data-slot="docblocks/canvas-world"
          className={cn(
            "absolute inset-0",
            // The native text selection (the connector's label chip / the
            // shape's text / the canvas's text) stands no canvas drag
            // session: a drag over the world's text stands no selection
            // (the user-select is none over the world while a move / resize
            // / rotate / endpoint session is live). The text-EDIT sessions
            // (the shape's / the connector's label's inline edit) are not
            // drag sessions — the user-select stands there (the edit
            // contract allows the selection).
            (viewport.moveSession || viewport.resizeSession || viewport.connectorEndpoint !== null) && "select-none"
          )}
          style={{
            transform: `translate(${viewport.pan.x}px, ${viewport.pan.y}px) scale(${viewport.zoom})`,
            transformOrigin: "center",
          }}
        >
          <ScrollArea
            data-slot="docblocks/page-card"
            style={pageCardDisplayStyle}
            className={cn(
              `
                box-border rounded-(--docblocks-radius) bg-(--docblocks-page-card-background)
                p-(--docblocks-page-card-padding) shadow-(--docblocks-page-card-shadow)
              `,
              pageCardSelected &&
                `
                  outline-(length:--docblocks-canvas-selection-border-width) outline-offset-1
                  outline-(--docblocks-canvas-selection-border-color) outline-solid
                `
            )}
          >
            <BlockContext.Provider value={pageContext}>
              <BlockGroups ids={pageChildren} />
            </BlockContext.Provider>
          </ScrollArea>
          {surfaces.map(({ id, children }) => (
            <SurfaceLayer
              key={id}
              id={id}
              children={children}
              pendingConnector={viewport.pendingConnector}
              movePreview={viewport.movePreview}
              resizePreview={viewport.resizePreview}
              endpointDrag={viewport.connectorEndpoint}
              endpointPreview={viewport.connectorEndpointPreview}
              endpointSnap={
                viewport.connectorEndpoint !== null
                  ? (viewport.connectorEndpointPreview?.snap ?? null)
                  : viewport.activeTool === "connector"
                    ? (viewport.connectorHoverSnap ?? viewport.connectorPreview?.snap ?? null)
                    : null
              }
              showPorts={viewport.activeTool === "connector" || viewport.connectorEndpoint !== null}
            />
          ))}
          {/* The connector label chips (the shared chip's display stand):
              every labeled connector's midpoint — the opaque theme
              background over the line's own frame (the chip stands always,
              not only in the edit). The
              editing one stands off (its edit chip stands it). */}
          {surfaces.map(({ id, children }) => (
            <ConnectorLabelChips
              key={`label-chips-${id}`}
              children={children}
              selectedIds={storeSelection?.kind === "blocks" ? storeSelection.ids : undefined}
              skipId={viewport.connectorLabelEditing}
              previews={{
                movePreview: viewport.movePreview,
                resizePreview: viewport.resizePreview,
                endpointDrag: viewport.connectorEndpoint,
                endpointPreview: viewport.connectorEndpointPreview,
              }}
            />
          ))}
          {connectorLabelTarget !== null && (
            // The label's inline edit: the
            // input at the line's midpoint (the world's space, so it
            // scales with the zoom — the line's parity). The world stands
            // it over the surface's layers (the line's text stands off
            // while the edit stands the draft).
            <ConnectorLabelEdit
              id={connectorLabelTarget.id}
              mid={connectorLabelTarget.mid}
              stroke={connectorLabelTarget.stroke}
              width={connectorLabelTarget.width}
              lineStyle={connectorLabelTarget.lineStyle}
              label={connectorLabelTarget.label}
              onClose={() => viewport.setConnectorLabelEditing(null)}
            />
          )}
          {viewport.placePreview !== null && (
            // The drag-to-size placement preview (the shape's figure at the
            // dragged box, the dashed cyan line; the world's space, so it
            // scales with the zoom).
            <div
              data-slot="docblocks/canvas-place-preview"
              className="pointer-events-none absolute"
              style={{
                left: `calc(50% + ${viewport.placePreview.x}px)`,
                top: `calc(50% + ${viewport.placePreview.y}px)`,
                width: `${viewport.placePreview.w}px`,
                height: `${viewport.placePreview.h}px`,
                transform: "translate(-50%, -50%)",
                color: "var(--docblocks-canvas-selection-border-color)",
                opacity: 0.6,
              }}
            >
              {viewport.placePreview.kind === "container" ? (
                <div
                  className="h-full w-full rounded-(--docblocks-radius) border-2 border-dashed"
                  style={{ borderColor: "currentColor" }}
                />
              ) : (
                <ShapeSvg
                  id="docblocks-place-preview"
                  block={{
                    type: "shape",
                    attrs: { variant: viewport.placePreview.variant, stroke: "currentColor", strokeStyle: "dash" },
                    geometry: {
                      x: 0,
                      y: 0,
                      w: viewport.placePreview.w,
                      h: viewport.placePreview.h,
                    },
                  }}
                />
              )}
            </div>
          )}
          {(viewport.pendingConnector !== null || viewport.pendingFree !== null) &&
            previewFrom !== null &&
            previewEnd !== null && (
              // The connector's pending preview line: the dashed segment
              // from the pending stand (the snapped press point, or the
              // auto anchor over the plain block ref) to the cursor's snap
              // (the endpoint drag's parity) (the world's space, so it
              // scales with the zoom).
              <ConnectorPreviewLine id={viewport.pendingConnector ?? undefined} from={previewFrom} point={previewEnd} />
            )}
          {previewFrom !== null && previewEnd !== null && previewSnap !== null && (
            // The preview end's snap: the circle + the connect badge at
            // the snapped edge point (the endpoint drag's parity).
            <ConnectorSnapBadge
              slot="docblocks/canvas-connector-preview-snap"
              point={previewEnd}
              port={previewSnap.port}
            />
          )}
          {viewport.activeTool === "connector" &&
            previewFrom === null &&
            viewport.connectorHoverSnap !== null &&
            hoverSnapPoint !== null && (
              // The hover snap (before the stand): the circle + the connect
              // badge at the snapped edge point — the press's stand
              // preview (the line stands from that point on the press).
              <ConnectorSnapBadge
                slot="docblocks/canvas-connector-hover-snap"
                point={hoverSnapPoint}
                port={viewport.connectorHoverSnap.port}
              />
            )}
          {viewport.penPoints.length > 1 && (
            <svg
              data-slot="docblocks/canvas-pen-preview"
              className="pointer-events-none absolute top-1/2 left-1/2 overflow-visible"
              width={1}
              height={1}
            >
              <path
                d={viewport.penPoints
                  .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
                  .join(" ")}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
        {multiSelectionBox !== null && viewport.movePreview === null && (
          // The multi-selection's summary rectangle (the union of the
          // selected items' boxes + the on-screen offset, the token's
          // line + fill — screen-space like the marquee, constant at any
          // zoom). The offset is the CSS token (the style's calc reads
          // it — the px stand no literal here).
          <div
            data-slot="docblocks/canvas-multi-selection"
            className="
              pointer-events-none absolute z-30 border-(length:--docblocks-canvas-selection-border-width)
              border-(--docblocks-canvas-selection-border-color) bg-(--docblocks-canvas-selection-fill)
            "
            style={{
              left: `calc(50% + ${canvasToScreen({ x: multiSelectionBox.left, y: multiSelectionBox.top }, viewport.zoom, viewport.pan).x}px - var(--docblocks-canvas-selection-box-offset))`,
              top: `calc(50% + ${canvasToScreen({ x: multiSelectionBox.left, y: multiSelectionBox.top }, viewport.zoom, viewport.pan).y}px - var(--docblocks-canvas-selection-box-offset))`,
              width: `calc(${multiSelectionBox.width * viewport.zoom}px + 2 * var(--docblocks-canvas-selection-box-offset))`,
              height: `calc(${multiSelectionBox.height * viewport.zoom}px + 2 * var(--docblocks-canvas-selection-box-offset))`,
            }}
          />
        )}
        {viewport.marqueeRect !== null && (
          <div
            data-slot="docblocks/canvas-marquee"
            className="
              pointer-events-none absolute z-40 border-(length:--docblocks-canvas-selection-border-width)
              border-(--docblocks-canvas-selection-border-color) bg-(--docblocks-canvas-selection-fill)
            "
            style={{
              left: `calc(50% + ${viewport.marqueeRect.left}px)`,
              top: `calc(50% + ${viewport.marqueeRect.top}px)`,
              width: viewport.marqueeRect.width,
              height: viewport.marqueeRect.height,
            }}
          />
        )}
        {viewport.dropIndicators !== null &&
          viewport.dropIndicators.map((indicator) => {
            const figure = blocks[indicator.id];
            if (figure === undefined) return null;
            const base = effectiveGeometry(figure);
            const mv = viewport.movePreview;
            // The icon stands above the figure's live top edge (the move
            // preview's delta, the screen space — the on-screen size stands
            // at any zoom).
            const screen = canvasToScreen(
              { x: base.x + (mv?.dx ?? 0), y: base.y + (mv?.dy ?? 0) - base.h / 2 - 14 },
              viewport.zoom,
              viewport.pan
            );
            const isOut = indicator.kind === "out";
            return (
              <div
                key={`${indicator.id}-${indicator.containerId}`}
                data-slot="docblocks/canvas-drop-indicator"
                data-drop={indicator.kind}
                className="
                  pointer-events-none absolute z-40 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center
                  justify-center rounded-full
                "
                style={{
                  left: `calc(50% + ${screen.x}px)`,
                  top: `calc(50% + ${screen.y}px)`,
                  background: isOut ? "var(--destructive, #ef4444)" : "var(--docblocks-canvas-connect-color, #16a34a)",
                  color: "var(--docblocks-page-card-background, #ffffff)",
                }}
              >
                <Container className="size-4" />
              </div>
            );
          })}
        {handleTarget !== null &&
          viewport.activeTool === null &&
          viewport.movePreview === null &&
          displayBox !== null && (
            // The selection's handles (the eight box handles):
            // screen-space, over the world (they keep their on-screen size
            // at any zoom). Hidden while a move preview is in flight (the
            // box is stale then).
            <div
              data-slot="docblocks/canvas-handles"
              className="pointer-events-none absolute z-40"
              style={{
                left: `calc(50% + ${canvasToScreen({ x: displayBox.x, y: displayBox.y }, viewport.zoom, viewport.pan).x}px)`,
                top: `calc(50% + ${canvasToScreen({ x: displayBox.x, y: displayBox.y }, viewport.zoom, viewport.pan).y}px)`,
                width: displayBox.w * viewport.zoom,
                height: displayBox.h * viewport.zoom,
                transform: "translate(-50%, -50%)",
              }}
            >
              {RESIZE_HANDLE_POSITIONS.map(({ handle: handleId, className, style }) => (
                <div
                  key={handleId}
                  data-slot="docblocks/canvas-handle"
                  data-handle={handleId}
                  className={cn(
                    "pointer-events-auto absolute size-2 rounded-full",
                    "border border-(--docblocks-formatbar-border-color) bg-(--docblocks-canvas-selection-border-color)",
                    className
                  )}
                  style={style}
                />
              ))}
            </div>
          )}
        {connectorToolbarTarget !== null && (
          // The connector's type toolbar (the single `connector`
          // selection): the three line types above the line's midpoint.
          <ConnectorToolbar
            id={connectorToolbarTarget.id}
            variant={connectorToolbarTarget.variant}
            strokeColor={connectorToolbarTarget.strokeColor}
            strokeWidth={connectorToolbarTarget.strokeWidth}
            strokeStyle={connectorToolbarTarget.strokeStyle}
            arrowHead={connectorToolbarTarget.arrowHead}
            arrowStart={connectorToolbarTarget.arrowStart}
            zStand={connectorToolbarTarget.zStand}
            style={{
              left: `calc(50% + ${canvasToScreen(connectorToolbarTarget.mid, viewport.zoom, viewport.pan).x}px)`,
              top: `calc(50% + ${canvasToScreen(connectorToolbarTarget.mid, viewport.zoom, viewport.pan).y - TOOLBAR_OFFSET_PX}px)`,
            }}
          />
        )}
        {selectedConnectorHandles !== null && connectorToolbarTarget !== null && (
          // The selected line's endpoint handles (the screen-space
          // overlay over the world and the other chrome, z-50). The line's
          // OWN options toolbar stands above them (the topmost chrome,
          // z-60) — in the overlap zone the menu wins (the port stands
          // hidden and non-interactive there; the press hits the menu),
          // and the port keeps its stand where the menu does not cover it.
          // The invisible wider hit circle stands the pointerdown; the
          // visible circle stands the selection's cyan (the handles stand
          // only over the selected line).
          <div data-slot="docblocks/connector-handles" className="pointer-events-none absolute inset-0 z-50">
            {(["start", "end"] as const).map((which) => {
              const point = canvasToScreen(selectedConnectorHandles[which], viewport.zoom, viewport.pan);
              return (
                <svg
                  key={which}
                  data-connector-endpoint={which}
                  data-connector-endpoint-id={connectorToolbarTarget.id}
                  width={CONNECTOR_HANDLE_HIT_RADIUS_PX * 2}
                  height={CONNECTOR_HANDLE_HIT_RADIUS_PX * 2}
                  style={{
                    position: "absolute",
                    left: `calc(50% + ${point.x}px - ${CONNECTOR_HANDLE_HIT_RADIUS_PX}px)`,
                    top: `calc(50% + ${point.y}px - ${CONNECTOR_HANDLE_HIT_RADIUS_PX}px)`,
                  }}
                >
                  <circle
                    cx={CONNECTOR_HANDLE_HIT_RADIUS_PX}
                    cy={CONNECTOR_HANDLE_HIT_RADIUS_PX}
                    r={CONNECTOR_HANDLE_HIT_RADIUS_PX}
                    fill="transparent"
                    pointerEvents="all"
                    style={{ cursor: "grab" }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      // The press is prevented (the same contract as the resize
                      // handle's branch): the compatibility mousedown's default
                      // stands no caret / native text selection — the
                      // re-anchor drag over the connector's label chip (or the
                      // shape's text / the canvas's text) stands no selection.
                      // The world layer's user-select none (the shared drag
                      // session's stand) backstops it.
                      event.preventDefault();
                      beginEndpointDrag(
                        connectorToolbarTarget.id,
                        which,
                        event.pointerId,
                        event.clientX,
                        event.clientY
                      );
                    }}
                  />
                  <circle
                    cx={CONNECTOR_HANDLE_HIT_RADIUS_PX}
                    cy={CONNECTOR_HANDLE_HIT_RADIUS_PX}
                    r={CONNECTOR_HANDLE_RADIUS_PX}
                    fill="var(--docblocks-canvas-surface-background, var(--card, #ffffff))"
                    strokeWidth={1.5}
                    pointerEvents="none"
                    style={{ stroke: "var(--docblocks-canvas-selected-stroke)" }}
                  />
                </svg>
              );
            })}
          </div>
        )}
        {shapeToolbarTarget !== null && displayBox !== null && (
          // The shape's color toolbar (the single `shape` selection): the
          // fill/stroke sections above the box top edge. Hidden for the
          // non-shape blocks, the multi selection, an active tool, and the
          // in-flight sessions (the box is stale then).
          <ShapeToolbar
            id={shapeToolbarTarget.id}
            fill={shapeToolbarTarget.fill}
            stroke={shapeToolbarTarget.stroke}
            strokeWidth={shapeToolbarTarget.strokeWidth}
            strokeStyle={shapeToolbarTarget.strokeStyle}
            variant={shapeToolbarTarget.variant}
            text={shapeToolbarTarget.text}
            fontSize={shapeToolbarTarget.fontSize}
            fontFamily={shapeToolbarTarget.fontFamily}
            textColor={shapeToolbarTarget.textColor}
            textStyle={shapeToolbarTarget.textStyle}
            textAlign={shapeToolbarTarget.textAlign}
            zStand={shapeToolbarTarget.zStand}
            style={{
              left: `calc(50% + ${canvasToScreen({ x: displayBox.x, y: displayBox.y }, viewport.zoom, viewport.pan).x}px)`,
              top: `calc(50% + ${canvasToScreen({ x: displayBox.x, y: displayBox.y }, viewport.zoom, viewport.pan).y - (displayBox.h / 2) * viewport.zoom - TOOLBAR_OFFSET_PX}px)`,
            }}
          />
        )}
        <ZoomControls
          zoom={viewport.zoom}
          onStep={viewport.stepZoom}
          onReset={() => viewport.setZoom(1)}
          onFit={onFit}
        />
        <CanvasDock viewport={viewport} />
      </div>
    </CanvasTextEditProvider>
  );
}
export { CanvasView };
