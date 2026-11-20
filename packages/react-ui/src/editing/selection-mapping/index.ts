/** The selection mapping's public surface: the DOM → core Selection
 *  mapping, the gesture-time view sync, and the writer's anchor hint. */
export { setWriterAnchorHint } from "./anchor-hint";
export { domSelectionInEditable, selectionsEqual, syncDomSelection } from "./compare";
export { mapDomSelection } from "./mapping";
