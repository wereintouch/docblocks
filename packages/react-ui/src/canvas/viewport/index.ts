/**
 * The canvas viewport segment: the pure geometry math (the screen ↔ canvas
 * mapping, the resize, the pen stroke) + its constants, and the view state
 * (zoom / pan / the mode / the tool / the pending stand) + the placement
 * and the in-flight sessions (move / resize / the connector endpoint drag)
 * over the doc. Pure view state per editor instance.
 */
export { MAX_ZOOM, MIN_ZOOM, MOVE_THRESHOLD_PX, RESIZE_FLOOR_PX, TOOL_SIZES, ZOOM_STEP } from "./constants";
export {
  canvasToScreen,
  clampResizeBoxToUnion,
  marqueeRect,
  penStroke,
  rectsIntersect,
  resizeBox,
  unionBox,
  screenDeltaToCanvas,
  screenToCanvas,
} from "./geometry";
export { useCanvasViewport } from "./hooks";
export type {
  Box,
  CanvasMode,
  CanvasPoint,
  CanvasTool,
  CanvasViewportState,
  EndpointDrag,
  EndpointPreview,
  EndpointSnap,
  MovePreview,
  PenStroke,
  ResizeHandle,
  ScreenPoint,
  ScreenRect,
} from "./models";
export { readCanvasViewport, writeCanvasViewport, WRITE_DEBOUNCE_MS } from "./persistence";
export type { PersistedViewport } from "./persistence";
export { clampZoom, pinchZoom, stepZoom } from "./zoom";
