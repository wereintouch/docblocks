/** The canvas's surface assembly: the container (the pointer / key
 * sessions' host, the focus's park, the dot grid over the pan / zoom) and
 * the world (the pan / zoom's transform: the page miniature, the surfaces,
 * the connector's label chips, the label's inline edit, the world-space
 * previews) + the screen-space chrome over the world (the marquee, the
 * handles, the toolbars, the dock). The body (CanvasView) stands the
 * session's hooks + the target's reads; this component is the paint. */
import { useTranslation } from "react-i18next";

import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

import type { Block, BlockId, Selection } from "docblocks-core";

import { BlockGroups } from "../../blocks/BlockView";
import { BlockContext } from "../../shared/providers/block-context";
import type { BlockContextValue } from "../../shared/providers/block-context";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { cn } from "../../shared/ui/cn";
import { DOT_GRID_STEP_PX } from "../geometry";
import type { CanvasViewportState, CanvasViewportStore } from "../viewport";
import { CanvasOverlays } from "./CanvasOverlays";
import { CanvasScreenChrome } from "./CanvasScreenChrome";
import { ConnectorLabelChips } from "./ConnectorLabelChips";
import { ConnectorLabelEdit } from "./ConnectorLabelEdit";
import { SurfaceLayer } from "./SurfaceLayer";
import { CANVAS_SELECTION_OUTLINE } from "./constants";
import type { useCanvasTargets } from "./use-canvas-targets";

type Targets = Pick<
  ReturnType<typeof useCanvasTargets>,
  | "handleTarget"
  | "displayBox"
  | "multiSelectionBox"
  | "shapeToolbarTarget"
  | "textToolbarTarget"
  | "connectorToolbarTarget"
  | "connectorLabelTarget"
  | "selectedConnectorHandles"
  | "previewFrom"
  | "previewSnap"
  | "previewEnd"
  | "hoverSnapPoint"
>;

function CanvasSurface({
  containerRef,
  cursor,
  viewport,
  handlers,
  pageContext,
  pageChildren,
  pageCardSelected,
  pageCardDisplayStyle,
  surfaces,
  storeSelection,
  blocks,
  viewMode,
  targets,
  beginEndpointDrag,
  onResetZoom,
  onFit,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  cursor: string;
  viewport: CanvasViewportState & { store: CanvasViewportStore };
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: () => void;
    onLostPointerCapture: () => void;
    onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
    onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
    onKeyUp: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  };
  pageContext: BlockContextValue;
  pageChildren: BlockId[];
  pageCardSelected: boolean;
  pageCardDisplayStyle: CSSProperties;
  surfaces: { id: BlockId; children: BlockId[] }[];
  storeSelection: Selection | null;
  blocks: Record<BlockId, Block>;
  viewMode: boolean;
  targets: Targets;
  beginEndpointDrag: (id: BlockId, which: "start" | "end", pointerId: number, clientX: number, clientY: number) => void;
  onResetZoom: () => void;
  onFit: () => void;
}) {
  const { t } = useTranslation("canvas");
  const {
    handleTarget,
    displayBox,
    multiSelectionBox,
    shapeToolbarTarget,
    textToolbarTarget,
    connectorToolbarTarget,
    connectorLabelTarget,
    selectedConnectorHandles,
    previewFrom,
    previewSnap,
    previewEnd,
    hoverSnapPoint,
  } = targets;
  // The press is prevented (the same contract as the resize handle's
  // branch): the compatibility mousedown's default stands no caret /
  // native text selection — the re-anchor drag over the connector's label
  // chip (or the shape's text / the canvas's text) stands no selection.
  // The world layer's user-select none (the shared drag session's stand)
  // backstops it.
  const onEndpointPointerDown = (which: "start" | "end") => (event: ReactPointerEvent<SVGCircleElement>) => {
    if (connectorToolbarTarget === null) return;
    event.stopPropagation();
    event.preventDefault();
    beginEndpointDrag(connectorToolbarTarget.id, which, event.pointerId, event.clientX, event.clientY);
  };
  return (
    <div
      data-slot="docblocks/canvas-view"
      ref={containerRef}
      tabIndex={0}
      role="application"
      aria-label={t("view.label")}
      className={cn(
        `
          relative h-(--docblocks-canvas-view-height) overflow-hidden bg-(--docblocks-canvas-background)
          bg-[radial-gradient(circle,var(--docblocks-canvas-view-dot)_1px,transparent_1px)]
          focus:outline-none
          focus-visible:outline-none
        `,
        cursor
      )}
      style={{
        // The dot grid follows the pan/zoom (the background position is the
        // container center offset by the pan, the cell is the grid step
        // scaled by the zoom).
        backgroundPosition: `calc(50% + ${viewport.pan.x}px) calc(50% + ${viewport.pan.y}px)`,
        backgroundSize: `${DOT_GRID_STEP_PX * viewport.zoom}px ${DOT_GRID_STEP_PX * viewport.zoom}px`,
      }}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
      onLostPointerCapture={handlers.onLostPointerCapture}
      onMouseDown={handlers.onMouseDown}
      onDoubleClick={handlers.onDoubleClick}
      onKeyDown={handlers.onKeyDown}
      onKeyUp={handlers.onKeyUp}
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
            pageCardSelected && CANVAS_SELECTION_OUTLINE
          )}
        >
          <BlockContext.Provider value={pageContext}>
            <BlockGroups ids={pageChildren} />
          </BlockContext.Provider>
        </ScrollArea>
        {surfaces.map(({ id, children }) => (
          <SurfaceLayer key={id} id={id} children={children} pendingConnector={viewport.pendingConnector} />
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
        <CanvasOverlays
          viewport={viewport}
          previewFrom={previewFrom}
          previewEnd={previewEnd}
          previewSnap={previewSnap}
          hoverSnapPoint={hoverSnapPoint}
        />
      </div>
      <CanvasScreenChrome
        viewport={viewport}
        blocks={blocks}
        viewMode={viewMode}
        targets={{
          multiSelectionBox,
          handleTarget,
          displayBox,
          connectorToolbarTarget,
          selectedConnectorHandles,
          shapeToolbarTarget,
          textToolbarTarget,
        }}
        onEndpointPointerDown={onEndpointPointerDown}
        onResetZoom={onResetZoom}
        onFit={onFit}
      />
    </div>
  );
}

export { CanvasSurface };
