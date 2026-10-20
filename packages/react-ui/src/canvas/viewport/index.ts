/**
 * The canvas viewport segment: the view state (zoom / pan / the mode / the
 * tool / the pending stand) + the placement and the in-flight sessions
 * (move / resize / rotate / the connector endpoint drag) over the doc.
 * Pure view state per editor instance.
 */
export { useCanvasViewport } from "./hooks";
export type { CanvasViewportState, EndpointDrag, EndpointPreview, EndpointSnap, MovePreview } from "./models";
