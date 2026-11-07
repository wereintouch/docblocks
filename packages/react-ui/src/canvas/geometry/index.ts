/**
 * The canvas geometry: the element's positioned styles (the center-anchor
 * placement), the page miniature's style, the effective geometry snapshot,
 * the connector endpoint's box / point resolution, the port helpers, and
 * the connector line math (the edge anchor, the box-to-box path, the
 * resolved-endpoint path with the orthogonal's stubs and the obstacle
 * avoidance).
 */
export { DEFAULT_CANVAS_ITEM_SIZE, DEFAULT_PAGE_SIZE, DOT_GRID_STEP_PX, PORT_NORMAL } from "./constants";
export {
  boxContains,
  canvasItemStyle,
  connectorHandlePoints,
  connectorMidpoint,
  connectorPath,
  connectorPathPoints,
  edgeAnchor,
  edgePointOf,
  effectiveGeometry,
  endpointBoxOf,
  endpointOf,
  endpointPointOf,
  frameDotBackground,
  frameWindowOffset,
  isCanvasSubType,
  pageCardStyle,
  portOfNormal,
  portsOf,
  surfaceChromeKey,
} from "./utils";
export type { Box, CanvasPort, ConnectorPath, ConnectorVariant, EndpointPoint, Ports, ShapeBlockView } from "./models";
export type { ConnectorPreviews } from "./utils";
