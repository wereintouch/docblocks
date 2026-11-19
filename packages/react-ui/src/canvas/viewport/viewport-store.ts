/** The canvas viewport's store (a zustand vanilla store per canvas view):
 * the viewport's render slices (the zoom / pan / the pointer mode / the
 * active tool / the in-flight session's previews) + the slice setters.
 *
 * The re-render contract (the big-canvas performance stand): the CanvasView
 * body subscribes to the WHOLE state (its re-render is a shallow JSX
 * evaluation — the memoized children bail), while the heavy children
 * (the canvas items, the connector's lines, the ports' dots, the label
 * chips) subscribe to their OWN narrow slices: a pointermove over the
 * in-flight session re-renders ONLY the items / lines it touches (a
 * moved figure, the lines whose endpoints are in the previewed set),
 * never the 5000-item surface or the sibling lines. The inert
 * consumers (the page view's surface, the frame window's copy) read the
 * module's EMPTY store (a stable all-null state, no re-renders).
 */
import { createStore } from "zustand/vanilla";

import { createContext, useContext } from "react";

import type {
  Box,
  CanvasMode,
  CanvasPoint,
  CanvasTool,
  DropIndicator,
  EndpointDrag,
  EndpointPreview,
  CycleIndicator,
  CycleSession,
  EndpointSnap,
  MarqueeState,
  MovePreview,
  PlacePreview,
  ScreenPoint,
} from "./models";

/** The per-line canvas session (the move / resize previews + the
 * connector's endpoint drag + the live preview): the per-line render
 * reads it through the store's subscription (the line follows the items
 * mid-drag — the preview stands the endpoint's resolution). The page
 * view's surface stands the inert EMPTY session (no session there). */
interface CanvasSession {
  movePreview: MovePreview | null;
  resizePreview: { id: string; box: Box } | null;
  endpointDrag: EndpointDrag | null;
  endpointPreview: EndpointPreview | null;
}

/** The viewport's render slices (the volatile view state per canvas view
 * — the doc / the wire stand none of it; the committed geometry stands in
 * the doc, the previews stand the in-flight gesture only). */
interface CanvasViewportStoreState {
  zoom: number;
  pan: ScreenPoint;
  mode: CanvasMode;
  activeTool: CanvasTool | null;
  pendingConnector: string | null;
  pendingFree: CanvasPoint | null;
  pendingPort: "north" | "east" | "south" | "west" | null;
  pendingFreePort: "north" | "east" | "south" | "west" | null;
  pendingSource: string | null;
  marquee: MarqueeState | null;
  penPoints: CanvasPoint[];
  movePreview: MovePreview | null;
  moveSession: boolean;
  dropIndicators: DropIndicator[] | null;
  resizePreview: { id: string; box: Box } | null;
  resizeSession: boolean;
  placePreview: PlacePreview | null;
  pendingText: CanvasPoint | null;
  connectorPreview: EndpointPreview | null;
  connectorHoverSnap: EndpointSnap | null;
  connectorEndpoint: EndpointDrag | null;
  connectorEndpointPreview: EndpointPreview | null;
  shapeTextEditing: string | null;
  canvasTextEditing: string | null;
  connectorLabelEditing: string | null;
  kbFocusId: string | null;
  cycle: CycleSession | null;
  cycleIndicator: CycleIndicator | null;
  setCycle: (cycle: CycleSession | null) => void;
  setCycleIndicator: (indicator: CycleIndicator | null) => void;
  setZoom: (zoom: number) => void;
  setPan: (pan: ScreenPoint) => void;
  setMode: (mode: CanvasMode) => void;
  setActiveTool: (tool: CanvasTool | null) => void;
  setMarquee: (marquee: MarqueeState | null) => void;
  setPenPoints: (points: CanvasPoint[]) => void;
  setMovePreview: (preview: MovePreview | null) => void;
  setMoveSession: (open: boolean) => void;
  setDropIndicators: (indicators: DropIndicator[] | null) => void;
  setResizePreview: (preview: { id: string; box: Box } | null) => void;
  setResizeSession: (open: boolean) => void;
  setPlacePreview: (preview: PlacePreview | null) => void;
  setPendingText: (point: CanvasPoint | null) => void;
  setConnectorPreview: (preview: EndpointPreview | null) => void;
  setConnectorHoverSnap: (snap: EndpointSnap | null) => void;
  setConnectorEndpoint: (endpoint: EndpointDrag | null) => void;
  setConnectorEndpointPreview: (preview: EndpointPreview | null) => void;
  setShapeTextEditing: (id: string | null) => void;
  setCanvasTextEditing: (id: string | null) => void;
  setConnectorLabelEditing: (id: string | null) => void;
  setKbFocusId: (id: string | null) => void;
  /** Sets the pending stand (a block ref, a block ref with the port, or a
   * free point with the frozen direction; null clears the stand). */
  setPendingStand: (
    stand: {
      blockId?: string;
      free?: CanvasPoint;
      port?: "north" | "east" | "south" | "west";
      freePort?: "north" | "east" | "south" | "west";
      source?: string;
    } | null
  ) => void;
}

/** The vanilla store over the viewport's slices. */
function createViewportStore(initial: { zoom: number; pan: ScreenPoint }) {
  return createStore<CanvasViewportStoreState>((set) => ({
    zoom: initial.zoom,
    pan: initial.pan,
    mode: "default",
    activeTool: null,
    pendingConnector: null,
    pendingFree: null,
    pendingPort: null,
    pendingFreePort: null,
    pendingSource: null,
    marquee: null,
    penPoints: [],
    movePreview: null,
    moveSession: false,
    dropIndicators: null,
    resizePreview: null,
    resizeSession: false,
    placePreview: null,
    pendingText: null,
    connectorPreview: null,
    connectorHoverSnap: null,
    connectorEndpoint: null,
    connectorEndpointPreview: null,
    shapeTextEditing: null,
    canvasTextEditing: null,
    connectorLabelEditing: null,
    kbFocusId: null,
    cycle: null,
    cycleIndicator: null,
    setCycle: (cycle) => set({ cycle }),
    setCycleIndicator: (cycleIndicator) => set({ cycleIndicator }),
    // The camera's / the tool's moves drop the drill-down's session (another
    // stack stands under the point) and its indicator.
    setZoom: (zoom) => set({ zoom, cycle: null, cycleIndicator: null }),
    setPan: (pan) => set({ pan, cycle: null, cycleIndicator: null }),
    setMode: (mode) => set({ mode }),
    setActiveTool: (activeTool) => set({ activeTool, cycle: null, cycleIndicator: null }),
    setMarquee: (marquee) => set({ marquee }),
    setPenPoints: (penPoints) => set({ penPoints }),
    setMovePreview: (movePreview) => set({ movePreview }),
    setMoveSession: (moveSession) => set({ moveSession }),
    setDropIndicators: (dropIndicators) => set({ dropIndicators }),
    setResizePreview: (resizePreview) => set({ resizePreview }),
    setResizeSession: (resizeSession) => set({ resizeSession }),
    setPlacePreview: (placePreview) => set({ placePreview }),
    setPendingText: (pendingText) => set({ pendingText }),
    setConnectorPreview: (connectorPreview) => set({ connectorPreview }),
    setConnectorHoverSnap: (connectorHoverSnap) => set({ connectorHoverSnap }),
    setConnectorEndpoint: (connectorEndpoint) => set({ connectorEndpoint }),
    setConnectorEndpointPreview: (connectorEndpointPreview) => set({ connectorEndpointPreview }),
    setShapeTextEditing: (shapeTextEditing) => set({ shapeTextEditing }),
    setCanvasTextEditing: (canvasTextEditing) => set({ canvasTextEditing }),
    setConnectorLabelEditing: (connectorLabelEditing) => set({ connectorLabelEditing }),
    setKbFocusId: (kbFocusId) => set({ kbFocusId }),
    setPendingStand: (stand) =>
      set(
        stand === null
          ? { pendingConnector: null, pendingFree: null, pendingPort: null, pendingFreePort: null, pendingSource: null }
          : {
              pendingConnector: stand.blockId ?? null,
              pendingFree: stand.free ?? null,
              pendingPort: stand.blockId !== undefined ? (stand.port ?? null) : null,
              pendingFreePort: stand.blockId === undefined ? (stand.freePort ?? null) : null,
              pendingSource: stand.source ?? null,
            }
      ),
  }));
}

/** The vanilla store's type (the slices + the stable setters). */
type CanvasViewportStore = ReturnType<typeof createViewportStore>;

/** The inert consumers' viewport store (the page view's surface, the
 * frame window's copy): a stable all-null state, no gestures. A module
 * singleton — the inert path stands no re-renders of its own. The inert
 * layers re-provide it (their items' subscriptions stand the stable
 * stand — the copies render the committed geometry only, the in-flight
 * preview does not ride the copy). */
const EMPTY_VIEWPORT_STORE = createViewportStore({ zoom: 1, pan: { x: 0, y: 0 } });

/** The canvas view's viewport store (the provider's value): the inert
 * consumers (outside the canvas view's provider) read the EMPTY stand. */
const CanvasViewportStoreContext = createContext<CanvasViewportStore>(EMPTY_VIEWPORT_STORE);

function useCanvasViewportStore(): CanvasViewportStore {
  return useContext(CanvasViewportStoreContext);
}

export { CanvasViewportStoreContext, EMPTY_VIEWPORT_STORE, createViewportStore, useCanvasViewportStore };
export type { CanvasSession, CanvasViewportStore, CanvasViewportStoreState };
