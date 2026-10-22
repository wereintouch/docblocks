/** The canvas viewport's models: the session shapes (the move / resize /
 *  rotate / the connector endpoint drag), the rendered previews, and the
 *  `CanvasViewportState` the hook returns. */
import type { CanvasPort } from "../../blocks/canvas-geometry";
import type {
  Box,
  CanvasMode,
  CanvasPoint,
  CanvasTool,
  PenStroke,
  ResizeHandle,
  ScreenPoint,
  ScreenRect,
} from "../viewport";

/** The in-flight placement's preview (the center anchor, canvas coords).
 * `kind` stands the preview's figure: a shape (the variant's silhouette)
 * or the container (the plain rectangle border). */
interface PlacePreview {
  kind: "shape" | "container";
  variant: "rect" | "rounded" | "ellipse" | "diamond" | "cylinder" | "cloud";
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The marquee's corners during the drag (the container space, center-relative). */
interface MarqueeState {
  start: ScreenPoint;
  end: ScreenPoint;
}

/**
 * The in-flight move session (the mutable per-gesture data lives in the
 * hook's ref; only the preview offset is render state). The snapshot
 * carries the effective geometry of each moved id (the stored geometry or
 * the synthesized default box — the release commit is a complete x/y
 * patch regardless of what the block carried).
 */
interface MoveSession {
  ids: string[];
  startClientX: number;
  startClientY: number;
  snapshot: Record<string, { x: number; y: number; w: number; h: number } | undefined>;
  dragging: boolean;
  /** The last committed-candidate delta (canvas px), fed by moveDrag. */
  dx: number;
  dy: number;
}

/** The rendered move preview (canvas px, applied to the moved items). */
interface MovePreview {
  ids: string[];
  dx: number;
  dy: number;
}

/**
 * The in-flight move's drop indicator: the
 * dragged figure lands in a container it is not yet a member of (kind "in"
 * — the green icon), or a member is dragged out of its own container (kind
 * "out" — the red icon). Pure view state: the doc writes on the release
 * only (the membership commit stands in the move's one transact).
 */
interface DropIndicator {
  /** The dragged figure's block id (the icon stands over it). */
  id: string;
  /** The container's group id (the drop target). */
  containerId: string;
  /** "in" (the drop-in — green) or "out" (the member leaving — red). */
  kind: "in" | "out";
}

/** The in-flight resize session (one item, one handle). */
interface ResizeSession {
  id: string;
  handle: ResizeHandle;
  snapshot: Box;
  startClientX: number;
  startClientY: number;
  dragging: boolean;
  box: Box | null;
}

/** The in-flight rotate session (one item, the box center). */
interface RotateSession {
  id: string;
  /** The box center (canvas space) — the rotation's anchor. */
  center: CanvasPoint;
  /** The effective box snapshot (the commit writes the complete box + the rotation). */
  snapshot: Box;
  /** The press's client point (the 3px screen threshold anchor). */
  startClientX: number;
  startClientY: number;
  dragging: boolean;
  rotation: number | null;
}

/**
 * The in-flight connector endpoint drag (one connector, one endpoint).
 * The preview point stands in the CANVAS (world) space — the space the
 * canvas view's surface children stand in (the surface's geometry stands
 * no shift: the children render at the world's origin parity); the
 * session carries the point so the release commit reads the session, not
 * the closure.
 */
interface EndpointSession {
  connectorId: string;
  surfaceId: string;
  which: "start" | "end";
  /** The press's client point (the release threshold anchor). */
  startClientX: number;
  startClientY: number;
  dragging: boolean;
  /** The last preview point (canvas px), fed by the move. */
  point: CanvasPoint;
  /** The endpoint's frozen direction (the last anchor's side — the free
   *  point commit keeps it; the re-connection to an edge takes the
   *  edge's side over it). */
  direction: CanvasPort | null;
}

/** The rendered endpoint drag target (the handles' live preview). */
interface EndpointDrag {
  connectorId: string;
  which: "start" | "end";
}

/** The endpoint drag's edge snap (the sibling block, the side, and the
 * fractional position along it — the continuous anchor). */

interface EndpointSnap {
  blockId: string;
  port: CanvasPort;
  t: number;
}

/** The endpoint drag's live preview (the raw point + the port snap, if any). */
interface EndpointPreview {
  point: CanvasPoint;
  snap: EndpointSnap | null;
}

/**
 * The canvas viewport's view state (zoom / pan / the pointer mode / the
 * active placement tool / the pending connector endpoint / the in-flight
 * marquee and pen stroke) and the placement commands over the doc. Pure
 * view state per editor instance — like the selection it stands outside
 * the doc and the awareness, and it resets on the canvas view's unmount
 * (the view-mode switch).
 */
interface CanvasViewportState {
  zoom: number;
  pan: ScreenPoint;
  mode: CanvasMode;
  activeTool: CanvasTool | null;
  /** The connector's first endpoint (the block id), between the two picks. */
  pendingConnector: string | null;
  /** The connector's first endpoint as a FREE point (world canvas px, the
   * empty-canvas press); null when the stand is a block or no pick stands. */
  pendingFree: CanvasPoint | null;
  marquee: MarqueeState | null;
  /** The in-flight pen stroke (canvas space), between the pointer down/up. */
  penPoints: CanvasPoint[];
  /** The rendered move preview (null outside an in-flight drag). */
  movePreview: MovePreview | null;
  /** The in-flight move's drop indicators (the green / red stand); null
   * outside a drag or when no drop stands. */
  dropIndicators: DropIndicator[] | null;
  /** The rendered resize preview (null outside an in-flight drag). */
  resizePreview: { id: string; box: Box } | null;
  /** The rendered rotate preview (null outside an in-flight drag). */
  rotatePreview: { id: string; rotation: number } | null;
  /** The in-flight shape placement's preview (canvas coords, the center anchor); null outside a drag. */
  placePreview: PlacePreview | null;
  /** The connector's pending preview point (canvas coords, the cursor); null outside a pick. */
  connectorPreview: CanvasPoint | null;
  /** The in-flight connector endpoint drag (the handles' target); null outside a drag. */
  connectorEndpoint: EndpointDrag | null;
  /** The endpoint drag's live preview (the point + the port snap); null outside a drag. */
  connectorEndpointPreview: EndpointPreview | null;
  /** The shape in the inline text edit (the double-click's target); null outside an edit. */
  shapeTextEditing: string | null;
  /** The connector in the label's inline edit (the line's double-click); null outside an edit. */
  connectorLabelEditing: string | null;
  /** Opens / closes the shape's inline text edit (the double-click, the
   * toolbar's add-text button, the edit's blur / Escape close). */
  setShapeTextEditing: (id: string | null) => void;
  /** Opens / closes the connector's label inline edit (the line's
   * double-click; the edit's blur / Escape close). */
  setConnectorLabelEditing: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  stepZoom: (direction: 1 | -1) => void;
  /** The zoom step at the screen point (the wheel): the point under the
   * cursor stays fixed (the pan compensates the zoom change). */
  zoomAt: (point: ScreenPoint, direction: 1 | -1) => void;
  /** The pinch's continuous zoom at the screen point (the wheel's
   * ctrl/cmd): the zoom scales by the delta (the smooth stand, no step
   * threshold), the point under the cursor stays fixed. */
  pinchAt: (point: ScreenPoint, deltaY: number) => void;
  setPan: (pan: ScreenPoint) => void;
  setMode: (mode: CanvasMode) => void;
  setActiveTool: (tool: CanvasTool | null) => void;
  setPendingConnector: (id: string | null) => void;
  /** Sets the pending stand (a block ref or a free point; null clears both). */
  setPendingStand: (stand: { blockId?: string; free?: CanvasPoint } | null, pressPoint?: CanvasPoint | null) => void;
  setMarquee: (marquee: MarqueeState | null) => void;
  setPenPoints: (points: CanvasPoint[]) => void;
  /** The in-flight marquee's rectangle (screen space, normalized); null outside a drag. */
  marqueeRect: ScreenRect | null;
  /** The click-to-place command (the tool lands at the point; the tool resets). */
  onPlace: (point: CanvasPoint) => void;
  /**
   * The drag-to-size place: the shape lands at the point with the given
   * box (the marquee gesture's result) in one transact; the tool resets,
   * the preview drops. A rejected placement resets nothing else.
   */
  onPlaceSize: (tool: CanvasTool, point: CanvasPoint, size: { w: number; h: number }) => void;
  setPlacePreview: (preview: PlacePreview | null) => void;
  setConnectorPreview: (preview: CanvasPoint | null) => void;
  /** The connector's endpoint pick (the second pick creates the connector). */
  onConnectorPick: (id: string) => void;
  /**
   * The connector's completion (the two-click's second pick or the
   * press-drag's release): creates the connector between the pending
   * stand and the second stand (a block ref, a port-snap when the pick
   * point stands near the block's port, or a free point at the pick
   * point). The free stands convert to the surface's local space at the
   * commit; the surface is the second block's (the first block's when the
   * second is free, the first surface when both stand free).
   */
  onConnectorCommit: (second: { blockId?: string; free?: CanvasPoint }, pickPoint: CanvasPoint) => void;
  /**
   * Opens the connector endpoint session (the selected line's handle
   * press): the line re-draws live from the preview point, the release
   * commits the endpoint (the port snap or the free point; the source
   * block's own port detaches to the free point). `pointer` is the
   * container-space, center-relative point (the screenToCanvas input).
   */
  beginConnectorEndpoint: (
    connectorId: string,
    which: "start" | "end",
    pointer: ScreenPoint,
    startClientX: number,
    startClientY: number
  ) => void;
  /** Feeds the endpoint session with a pointer move (the live re-draw). */
  moveConnectorEndpoint: (pointer: ScreenPoint) => void;
  /** Closes the session: commits the endpoint (one updateBlock) or cancels. */
  endConnectorEndpoint: (releaseClientX?: number, releaseClientY?: number) => void;
  /** Cancels the in-flight endpoint session without a commit (the Escape / pointercancel path). */
  cancelConnectorEndpoint: () => void;
  /** The pen stroke commit (the released drag). */
  onPen: (stroke: PenStroke) => void;
  /**
   * Opens a move session over the given ids (the snapshot reads the doc:
   * the stored geometry, or the synthesized default box when absent).
   */
  beginMove: (ids: string[], startClientX: number, startClientY: number) => void;
  /** Feeds the session with a pointer move (crosses the drag threshold at 3px). */
  moveDrag: (clientX: number, clientY: number) => void;
  /** Closes the session: commits the move (one transact) or cancels. */
  endMove: () => void;
  /** Cancels the in-flight session without a commit (the Escape path). */
  cancelMove: () => void;
  /** Opens a resize session (one item, one handle; the snapshot is the effective box). */
  beginResize: (id: string, handle: ResizeHandle, startClientX: number, startClientY: number) => void;
  /** Feeds the resize session with a pointer move (shift = the aspect lock). */
  resizeDrag: (clientX: number, clientY: number, shift: boolean) => void;
  /** Commits the resize (one setGeometry) or cancels. */
  endResize: () => void;
  /** Cancels the in-flight resize without a commit (the Escape / pointercancel path). */
  cancelResize: () => void;
  /** Opens a rotate session (one item; the anchor is the box center). */
  beginRotate: (id: string, center: CanvasPoint, startClientX: number, startClientY: number) => void;
  /**
   * Feeds the rotate session with a pointer move (shift = the 15° snap).
   * Sub-threshold jitters are dropped (the no-op press-release writes
   * nothing — the same contract as the move / resize sessions).
   */
  rotateDrag: (pointer: ScreenPoint, clientX: number, clientY: number, shift: boolean) => void;
  /** Commits the rotation (one setGeometry) or cancels. */
  endRotate: () => void;
  /** Cancels the in-flight rotation without a commit (the Escape / pointercancel path). */
  cancelRotate: () => void;
}

/** The endpoint drag's port snap radius (canvas px, the zoom-blind space). */
const ENDPOINT_SNAP_RADIUS = 12;
/** The endpoint drag's release threshold (screen px — a sub-threshold
 * press-release commits nothing, the move sessions' contract). */
const ENDPOINT_RELEASE_THRESHOLD_PX = 3;

export { ENDPOINT_RELEASE_THRESHOLD_PX, ENDPOINT_SNAP_RADIUS };
export type {
  CanvasViewportState,
  EndpointDrag,
  EndpointPreview,
  EndpointSession,
  EndpointSnap,
  DropIndicator,
  MarqueeState,
  MovePreview,
  MoveSession,
  PlacePreview,
  ResizeSession,
  RotateSession,
};
