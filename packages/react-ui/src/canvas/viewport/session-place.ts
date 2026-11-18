/** The placement's commands (the click-to-place, the drag-to-size place,
 * the pen's stroke commit) over the doc: each lands its block in one
 * transact (the insert + the setGeometry / the stroke's geometry — one
 * undo step, one wire update). A placement failure (a validator
 * rejection) must not take the canvas down — the tool just resets. */
import type { Doc } from "docblocks-core";

import { assertNever } from "../../shared/utils";
import { placeCanvasText, placeContainer, placeFrame, placePenStroke, placeShape } from "../insert";
import { TOOL_SIZES } from "./constants";
import type { CanvasTool, PenStroke } from "./models";
import type { CanvasViewportStore } from "./viewport-store";

/** The placement's commands (the doc writes; the tool's reset over the
 * viewport's store). */
function createPlaceCommands(store: CanvasViewportStore, doc: Doc) {
  // The click-to-place: the block lands at the point in one transact.
  const onPlace = (point: { x: number; y: number }) => {
    const state = store.getState();
    const tool = state.activeTool;
    if (tool === null || tool === "connector" || tool === "pen") return;
    const size = TOOL_SIZES[tool];
    try {
      switch (tool) {
        case "rect":
        case "rounded":
        case "ellipse":
        case "diamond":
        case "cylinder":
        case "cloud":
          placeShape(doc, tool, point, size);
          break;
        case "container":
          placeContainer(doc, point, size);
          break;
        case "text":
          placeCanvasText(doc, point, size);
          break;
        case "frame":
          placeFrame(doc, point, size);
          break;
        default:
          assertNever(tool);
      }
    } catch {
      // A rejected placement: the tool resets, nothing is created.
    }
    store.getState().setActiveTool(null);
  };

  // The drag-to-size place: the shape's box is the dragged size (the
  // marquee gesture), the center anchor is the drag's midpoint — one
  // transact (the insert + the setGeometry, like the click place).
  const onPlaceSize = (tool: CanvasTool, point: { x: number; y: number }, size: { w: number; h: number }) => {
    store.getState().setPlacePreview(null);
    try {
      switch (tool) {
        case "rect":
        case "rounded":
        case "ellipse":
        case "diamond":
        case "cylinder":
        case "cloud":
          placeShape(doc, tool, point, size);
          break;
        case "container":
          placeContainer(doc, point, size);
          break;
        case "frame":
          placeFrame(doc, point, size);
          break;
      }
    } catch {
      // A rejected placement (the size against a validator bound):
      // the tool resets, nothing is created.
    }
    store.getState().setActiveTool(null);
  };

  // The pen stroke's commit (the released drag).
  const onPen = (stroke: PenStroke) => {
    try {
      placePenStroke(doc, stroke);
    } catch {
      // A rejected stroke: nothing is created.
    }
  };

  return { onPlace, onPlaceSize, onPen };
}

export { createPlaceCommands };
