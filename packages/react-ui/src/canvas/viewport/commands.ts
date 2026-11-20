/** The viewport's gesture commands' assembly: the store's slice setters
 * (the plain setters) + the doc-touching session commands (the shape's
 * move / resize, the connector's pick / commit / endpoint's drag, the
 * placement) + the zoom's math (the cursor-fixed zoom over the screen
 * point). Every command is a stable closure (the per-view store + the
 * doc) — the CanvasView's body re-render stands no command re-creation
 * (the memoized children's props keep their identity). The commands read
 * the live viewport state through `store.getState()` (the handler's
 * freshness, the closure's stability). */
import type { Doc } from "docblocks-core";

import type { CanvasPoint, ScreenPoint } from "./models";
import { type StandPointRef, createConnectorSessions } from "./session-connector";
import { createPlaceCommands } from "./session-place";
import { createShapeSessions } from "./session-shape";
import type { CanvasViewportStore } from "./viewport-store";
import { pinchZoom, stepZoom } from "./zoom";

/** The viewport's gesture commands (the doc writes + the zoom's math +
 * the pending stand's extended setter). */
function createCanvasViewportCommands(store: CanvasViewportStore, doc: Doc) {
  const standPoint: StandPointRef = { current: null };

  // The zoom step (the toolbar's buttons / the keyboard's stand).
  const step = (direction: 1 | -1) => {
    const state = store.getState();
    const next = stepZoom(state.zoom, direction);
    if (next !== state.zoom) state.setZoom(next);
  };

  // The wheel's zoom at the cursor: the canvas point under the screen
  // point stands fixed — the pan moves by the screen delta the point's
  // new position would bring (screen = zoom * canvas + pan). The step
  // stands no-op at the bounds (the zoom and the pan keep).
  const zoomAt = (point: ScreenPoint, direction: 1 | -1) => {
    const state = store.getState();
    const next = stepZoom(state.zoom, direction);
    if (next === state.zoom) return;
    // The two-decimal round: the float drift of the ratio (the stop
    // grid's decimals stand the exact value) stands no phantom px.
    state.setZoom(next);
    state.setPan({
      x: Number((point.x - (point.x - state.pan.x) * (next / state.zoom)).toFixed(2)),
      y: Number((point.y - (point.y - state.pan.y) * (next / state.zoom)).toFixed(2)),
    });
  };

  // The pinch's continuous zoom at the cursor (the trackpad's smooth
  // stand): the zoom scales by the wheel's delta (no step threshold —
  // the pinch reacts on every event) and the point under the cursor
  // stands fixed (the pan compensates, the same math as the step's
  // zoomAt). The bound stands the no-op (the zoom and the pan keep).
  const pinchAt = (point: ScreenPoint, deltaY: number) => {
    const state = store.getState();
    const next = pinchZoom(state.zoom, deltaY);
    if (next === state.zoom) return;
    state.setZoom(next);
    state.setPan({
      x: Number((point.x - (point.x - state.pan.x) * (next / state.zoom)).toFixed(2)),
      y: Number((point.y - (point.y - state.pan.y) * (next / state.zoom)).toFixed(2)),
    });
  };

  // The pending stand's extended setter: the store's slices + the press
  // point's ref (the non-render gesture data) + the previews' drop (a
  // new stand stands its own preview, not the last stand's).
  const setPendingStand = (
    stand: {
      blockId?: string;
      free?: CanvasPoint;
      port?: "north" | "east" | "south" | "west";
      freePort?: "north" | "east" | "south" | "west";
      source?: string;
    } | null,
    pressPoint: CanvasPoint | null = null
  ) => {
    const state = store.getState();
    state.setPendingStand(stand);
    state.setConnectorPreview(null);
    state.setConnectorHoverSnap(null);
    standPoint.current = stand === null ? null : pressPoint;
  };

  return {
    ...createShapeSessions(store, doc),
    ...createConnectorSessions(store, doc, standPoint),
    ...createPlaceCommands(store, doc),
    stepZoom: step,
    zoomAt,
    pinchAt,
    setPendingStand,
  };
}

export { createCanvasViewportCommands };
