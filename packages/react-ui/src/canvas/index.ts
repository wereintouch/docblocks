// The canvas unit's cross-unit surface (C6): the canvas-view renderers, the state
// store, and the font catalog import canvas through this barrel (one entry per
// unit). The viewport sub-unit's own barrel (./viewport) still stands for
// intra-canvas consumers; this re-exports the viewport surface the canvas view
// needs, alongside the flat canvas files (the toolbar, the clipboard, the fit/
// insert/nudge helpers, the z-order, the shape fonts).

export { CanvasDock } from "./CanvasDock";
export { copyCanvasItems, pasteCanvasItems } from "./clipboard";
export type { CanvasClipboard } from "./clipboard";
export { ConnectorToolbar } from "./ConnectorToolbar";
export { canvasContentBox, fitView } from "./fit";
export { dissolveGroup, findParentSurface, firstSurface, makeGroup } from "./insert";
export { NUDGE_KEYS, nudgeDelta, nudgeGate, nudgeSelection } from "./nudge";
export { ShapeToolbar } from "./shape-toolbar";
export { SHAPE_FONT_OPTIONS, SHAPE_FONT_STACKS, SHAPE_TEXT_DEFAULT_SIZE, SHAPE_TEXT_WEIGHTS } from "./text-fonts";
export { zPositionOf } from "./z-order-menu";
export {
  MOVE_THRESHOLD_PX,
  canvasToScreen,
  marqueeRect,
  penStroke,
  readCanvasViewport,
  rectsIntersect,
  screenToCanvas,
  useCanvasViewport,
} from "./viewport";
export {
  connectorPressStand,
  connectorPreviewFrom,
  connectorPreviewPoint,
  placeDragBox,
  snapAnySurfaceEdge,
} from "./viewport/utils";
export type { Box, CanvasMode, CanvasPoint, CanvasTool, MovePreview, ResizeHandle } from "./viewport";
