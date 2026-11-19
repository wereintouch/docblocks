/** The canvas's screen-space chrome: the overlays painted over the world
 * (the pan / zoom's transform stands OFF — the chrome keeps its on-screen
 * size at any zoom): the multi-selection's summary rectangle, the marquee,
 * the move's drop indicators, the selection's eight handles, the
 * single-selection's toolbars (the connector's type toolbar + the
 * endpoint's handles, the shape's color toolbar, the canvas-text's text
 * toolbar), the zoom's controls, and the bottom dock (the read-only's
 * stand keeps the zoom's gestures, the placement's tools stand off). The
 * world-space previews (the place / the connector's pending / the pen's
 * stroke, the ghost) stand inside the world — CanvasOverlays. */
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import type { Block, BlockId, Selection } from "docblocks-core";

import {
  CanvasDock,
  CanvasTextToolbar,
  ConnectorToolbar,
  ShapeToolbar,
  ZOrderToolbar,
  canvasToScreen,
} from "../../canvas";
import { cn } from "../../shared/ui/cn";
import type { CanvasViewportState } from "../viewport";
import { CanvasSelectionOverlay } from "./CanvasSelectionOverlay";
import { CanvasTitleChips } from "./CanvasTitleChips";
import { ZoomControls } from "./ZoomControls";
import {
  CONNECTOR_HANDLE_HIT_RADIUS_PX,
  CONNECTOR_HANDLE_RADIUS_PX,
  RESIZE_HANDLE_POSITIONS,
  SURFACE_BG,
  TOOLBAR_OFFSET_PX,
} from "./constants";
import type { useCanvasTargets } from "./use-canvas-targets";

type Targets = Pick<
  ReturnType<typeof useCanvasTargets>,
  | "multiSelectionBox"
  | "handleTarget"
  | "displayBox"
  | "connectorToolbarTarget"
  | "selectedConnectorHandles"
  | "shapeToolbarTarget"
  | "textToolbarTarget"
  | "arrangeToolbarTarget"
>;

function CanvasScreenChrome({
  viewport,
  blocks,
  surfaces,
  culling,
  selection,
  viewMode,
  targets,
  onChipPress,
  onChipDoubleClick,
  onEndpointPointerDown,
  onResetZoom,
  onFit,
}: {
  viewport: CanvasViewportState;
  blocks: Record<BlockId, Block>;
  surfaces: { id: BlockId; children: BlockId[] }[];
  culling: Set<BlockId> | null;
  selection: Selection | null;
  viewMode: boolean;
  targets: Targets;
  onChipPress: (id: BlockId, event: ReactPointerEvent<HTMLDivElement>) => void;
  onChipDoubleClick: (id: BlockId, event: ReactMouseEvent<HTMLDivElement>) => void;
  onEndpointPointerDown: (which: "start" | "end") => (event: ReactPointerEvent<SVGCircleElement>) => void;
  onResetZoom: () => void;
  onFit: () => void;
}) {
  const {
    multiSelectionBox,
    handleTarget,
    displayBox,
    connectorToolbarTarget,
    selectedConnectorHandles,
    shapeToolbarTarget,
    textToolbarTarget,
    arrangeToolbarTarget,
  } = targets;
  // The toolbar's top edge: the box top edge over the on-screen offset
  // (the box's screen-space half height over the zoom, the token's gap).
  const toolbarTop = (box: { x: number; y: number; h: number }) =>
    canvasToScreen({ x: box.x, y: box.y }, viewport.zoom, viewport.pan).y -
    (box.h / 2) * viewport.zoom -
    TOOLBAR_OFFSET_PX;
  return (
    <>
      <CanvasSelectionOverlay viewport={viewport} blocks={blocks} multiSelectionBox={multiSelectionBox} />
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
                  `border border-(--docblocks-formatbar-border-color) bg-(--docblocks-canvas-selection-border-color)`,
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
                  className="cursor-grab"
                  onPointerDown={onEndpointPointerDown(which)}
                />
                <circle
                  cx={CONNECTOR_HANDLE_HIT_RADIUS_PX}
                  cy={CONNECTOR_HANDLE_HIT_RADIUS_PX}
                  r={CONNECTOR_HANDLE_RADIUS_PX}
                  fill={SURFACE_BG}
                  strokeWidth={1.5}
                  pointerEvents="none"
                  className="stroke-(--docblocks-canvas-selected-stroke)"
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
            top: `calc(50% + ${toolbarTop(displayBox)}px)`,
          }}
        />
      )}
      {textToolbarTarget !== null && displayBox !== null && (
        // The canvas-text's text toolbar (the single `canvas-text`
        // selection): the text controls + the z-order menu above the box
        // top edge (the shape toolbar's position's stand). Hidden for the
        // non-text blocks, the multi selection, an active tool, and the
        // in-flight sessions (the box is stale then).
        <CanvasTextToolbar
          id={textToolbarTarget.id}
          fontFamily={textToolbarTarget.fontFamily}
          textColor={textToolbarTarget.textColor}
          textStyle={textToolbarTarget.textStyle}
          fontSize={textToolbarTarget.fontSize}
          textAlign={textToolbarTarget.textAlign}
          zStand={textToolbarTarget.zStand}
          style={{
            left: `calc(50% + ${canvasToScreen({ x: displayBox.x, y: displayBox.y }, viewport.zoom, viewport.pan).x}px)`,
            top: `calc(50% + ${toolbarTop(displayBox)}px)`,
          }}
        />
      )}
      {arrangeToolbarTarget !== null && displayBox !== null && (
        // The container's z-order toolbar (the single `group` / `frame`
        // selection): the unified's arrange's stand over the shapes (the
        // same position over the box's top edge; the menu is the bar's
        // whole content).
        <ZOrderToolbar
          id={arrangeToolbarTarget.id}
          kind={arrangeToolbarTarget.kind}
          zStand={arrangeToolbarTarget.zStand}
          style={{
            left: `calc(50% + ${canvasToScreen({ x: displayBox.x, y: displayBox.y }, viewport.zoom, viewport.pan).x}px)`,
            top: `calc(50% + ${toolbarTop(displayBox)}px)`,
          }}
        />
      )}
      <ZoomControls zoom={viewport.zoom} onStep={viewport.stepZoom} onReset={onResetZoom} onFit={onFit} />
      <CanvasTitleChips
        surfaces={surfaces}
        blocks={blocks}
        visibleIds={culling}
        selection={selection}
        viewport={viewport}
        viewMode={viewMode}
        onChipPress={onChipPress}
        onChipDoubleClick={onChipDoubleClick}
      />
      {/* The read-only stand (view / published): the dock's placement's
        tools' stand is off — the view's gestures keep (the wheel's
        zoom / pan, the zoom's controls' fit / step / reset). */}
      {viewMode ? null : <CanvasDock viewport={viewport} />}
    </>
  );
}

export { CanvasScreenChrome };
