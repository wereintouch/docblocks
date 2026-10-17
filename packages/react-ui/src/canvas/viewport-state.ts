import { useCallback, useRef, useState } from "react";

import type { Doc } from "docblocks-core";

import { effectiveGeometry } from "../blocks/canvas-geometry";
import { placeCanvasText, placeConnector, placeFrame, placePenStroke, placeShape } from "./insert";
import {
  TOOL_SIZES,
  marqueeRect,
  resizeBox,
  rotateAngle,
  screenDeltaToCanvas,
  screenToCanvas,
  stepZoom,
} from "./viewport";
import type {
  Box,
  CanvasMode,
  CanvasPoint,
  CanvasTool,
  PenStroke,
  ResizeHandle,
  ScreenPoint,
  ScreenRect,
} from "./viewport";

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
  /** The connector's first endpoint (the block id), between the two clicks. */
  pendingConnector: string | null;
  marquee: MarqueeState | null;
  /** The in-flight pen stroke (canvas space), between the pointer down/up. */
  penPoints: CanvasPoint[];
  /** The rendered move preview (null outside an in-flight drag). */
  movePreview: MovePreview | null;
  /** The rendered resize preview (null outside an in-flight drag). */
  resizePreview: { id: string; box: Box } | null;
  /** The rendered rotate preview (null outside an in-flight drag). */
  rotatePreview: { id: string; rotation: number } | null;
  setZoom: (zoom: number) => void;
  stepZoom: (direction: 1 | -1) => void;
  setPan: (pan: ScreenPoint) => void;
  setMode: (mode: CanvasMode) => void;
  setActiveTool: (tool: CanvasTool | null) => void;
  setPendingConnector: (id: string | null) => void;
  setMarquee: (marquee: MarqueeState | null) => void;
  setPenPoints: (points: CanvasPoint[]) => void;
  /** The in-flight marquee's rectangle (screen space, normalized); null outside a drag. */
  marqueeRect: ScreenRect | null;
  /** The click-to-place command (the tool lands at the point; the tool resets). */
  onPlace: (point: CanvasPoint) => void;
  /** The connector's endpoint pick (the second pick creates the connector). */
  onConnectorPick: (id: string) => void;
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

function useCanvasViewport(doc: Doc): CanvasViewportState {
  const [zoom, setZoomState] = useState(1);
  const [pan, setPan] = useState<ScreenPoint>({ x: 0, y: 0 });
  const [mode, setMode] = useState<CanvasMode>("default");
  const [activeTool, setActiveTool] = useState<CanvasTool | null>(null);
  const [pendingConnector, setPendingConnector] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [penPoints, setPenPoints] = useState<CanvasPoint[]>([]);
  const [movePreview, setMovePreview] = useState<MovePreview | null>(null);
  const moveRef = useRef<MoveSession | null>(null);

  const setZoom = useCallback((next: number) => setZoomState(next), []);
  const step = useCallback((direction: 1 | -1) => setZoomState((current) => stepZoom(current, direction)), []);

  // The click-to-place: the block lands at the point in one transact
  // (insert + setGeometry). A placement failure (a validator rejection)
  // must not take the canvas down — the tool just resets.
  const onPlace = useCallback(
    (point: CanvasPoint) => {
      const tool = activeTool;
      if (tool === null || tool === "connector" || tool === "pen") return;
      const size = TOOL_SIZES[tool];
      try {
        switch (tool) {
          case "rect":
          case "ellipse":
          case "diamond":
          case "line":
            placeShape(doc, tool, point, size);
            break;
          case "text":
            placeCanvasText(doc, point, size);
            break;
          case "frame":
            placeFrame(doc, point, size);
            break;
        }
      } catch {
        // A rejected placement: the tool resets, nothing is created.
      }
      setActiveTool(null);
    },
    [activeTool, doc]
  );

  const onConnectorPick = useCallback(
    (id: string) => {
      // The first pick stands the pending endpoint; the second (a different
      // item) creates the connector. A cross-surface pair (the merged
      // canvas) is a no-op cancel.
      if (pendingConnector === null) {
        setPendingConnector(id);
        return;
      }
      try {
        placeConnector(doc, pendingConnector, id);
      } catch {
        // A cross-surface pair: the pick cancels.
      }
      setPendingConnector(null);
      setActiveTool(null);
    },
    [doc, pendingConnector]
  );

  const onPen = useCallback(
    (stroke: PenStroke) => {
      try {
        placePenStroke(doc, stroke);
      } catch {
        // A rejected stroke: nothing is created.
      }
    },
    [doc]
  );

  const beginMove = useCallback(
    (ids: string[], startClientX: number, startClientY: number) => {
      const snapshot: MoveSession["snapshot"] = {};
      for (const id of ids) {
        const block = doc.getBlock(id);
        // The connector carries no geometry of its own (its endpoints
        // follow the blocks): it is never a move target.
        if (block === null || block.type === "connector") continue;
        // The effective box the element stands at (the stored geometry or
        // the synthesized default) — the release commit writes a complete
        // x/y/w/h patch from it.
        snapshot[id] = effectiveGeometry(block);
      }
      moveRef.current = { ids, startClientX, startClientY, snapshot, dragging: false, dx: 0, dy: 0 };
      setMovePreview(null);
    },
    [doc]
  );

  const moveDrag = useCallback(
    (clientX: number, clientY: number) => {
      const session = moveRef.current;
      if (session === null) return;
      const delta = screenDeltaToCanvas(clientX - session.startClientX, clientY - session.startClientY, zoom);
      if (delta === null) return;
      session.dragging = true;
      // The session carries the delta (the render state is the preview
      // only — the release commit reads the session, not the closure).
      session.dx = delta.x;
      session.dy = delta.y;
      setMovePreview({ ids: session.ids, dx: delta.x, dy: delta.y });
    },
    [zoom]
  );

  const endMove = useCallback(() => {
    const session = moveRef.current;
    moveRef.current = null;
    setMovePreview(null);
    if (session === null || !session.dragging) return;
    // One transact for the whole (group) move: one undo step, one wire
    // update. A vanished block (a concurrent removal) is skipped.
    doc.transact(() => {
      for (const id of session.ids) {
        const snap = session.snapshot[id];
        if (snap === undefined || doc.getBlock(id) === null) continue;
        doc.setGeometry(id, {
          x: snap.x + session.dx,
          y: snap.y + session.dy,
          w: snap.w,
          h: snap.h,
        });
      }
    });
  }, [doc]);

  const cancelMove = useCallback(() => {
    moveRef.current = null;
    setMovePreview(null);
  }, []);

  const resizeRef = useRef<ResizeSession | null>(null);
  const [resizePreview, setResizePreview] = useState<{ id: string; box: Box } | null>(null);
  const rotateRef = useRef<RotateSession | null>(null);
  const [rotatePreview, setRotatePreview] = useState<{ id: string; rotation: number } | null>(null);

  const beginResize = useCallback(
    (id: string, handle: ResizeHandle, startClientX: number, startClientY: number) => {
      const block = doc.getBlock(id);
      if (block === null || block.type === "connector") return;
      resizeRef.current = {
        id,
        handle,
        snapshot: effectiveGeometry(block),
        startClientX,
        startClientY,
        dragging: false,
        box: null,
      };
      setResizePreview(null);
    },
    [doc]
  );

  const resizeDrag = useCallback(
    (clientX: number, clientY: number, shift: boolean) => {
      const session = resizeRef.current;
      if (session === null) return;
      const delta = screenDeltaToCanvas(clientX - session.startClientX, clientY - session.startClientY, zoom);
      if (delta === null) return;
      session.dragging = true;
      // The session carries the box (the release commit reads the session,
      // not the render state).
      session.box = resizeBox(session.snapshot, session.handle, delta.x, delta.y, shift);
      setResizePreview({ id: session.id, box: session.box });
    },
    [zoom]
  );

  const endResize = useCallback(() => {
    const session = resizeRef.current;
    resizeRef.current = null;
    setResizePreview(null);
    if (session === null || !session.dragging || session.box === null) return;
    doc.transact(() => {
      if (doc.getBlock(session.id) === null) return;
      doc.setGeometry(session.id, { x: session.box!.x, y: session.box!.y, w: session.box!.w, h: session.box!.h });
    });
  }, [doc]);

  const beginRotate = useCallback(
    (id: string, center: CanvasPoint, startClientX: number, startClientY: number) => {
      const block = doc.getBlock(id);
      if (block === null || block.type === "connector") return;
      rotateRef.current = {
        id,
        center,
        snapshot: effectiveGeometry(block),
        startClientX,
        startClientY,
        dragging: false,
        rotation: null,
      };
      setRotatePreview(null);
    },
    [doc]
  );

  const rotateDrag = useCallback(
    (pointer: ScreenPoint, clientX: number, clientY: number, shift: boolean) => {
      const session = rotateRef.current;
      if (session === null) return;
      const delta = screenDeltaToCanvas(clientX - session.startClientX, clientY - session.startClientY, 1);
      if (delta === null) return;
      session.dragging = true;
      // The pointer in the canvas space, against the box center (canvas
      // anchor) — the zoom/pan cancel in the angle math.
      const canvasPointer = screenToCanvas(pointer, zoom, pan);
      session.rotation = rotateAngle(session.center, canvasPointer, shift);
      setRotatePreview({ id: session.id, rotation: session.rotation });
    },
    [zoom, pan]
  );

  const endRotate = useCallback(() => {
    const session = rotateRef.current;
    rotateRef.current = null;
    setRotatePreview(null);
    if (session === null || !session.dragging || session.rotation === null) return;
    const rotation = session.rotation;
    const snapshot = session.snapshot;
    // The rotation merges with the CURRENT geometry (a concurrent move / resize keeps
    // standing); a geometry-less block (the page miniature) gets the
    // session's snapshot box (a rotation-only patch is rejected by the
    // command — the merge needs a complete box).
    doc.transact(() => {
      const current = doc.getBlock(session.id);
      if (current === null) return;
      const geometry = current.geometry;
      if (geometry !== undefined) {
        doc.setGeometry(session.id, { x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h, rotation });
      } else {
        doc.setGeometry(session.id, { x: snapshot.x, y: snapshot.y, w: snapshot.w, h: snapshot.h, rotation });
      }
    });
  }, [doc]);

  const cancelResize = useCallback(() => {
    resizeRef.current = null;
    setResizePreview(null);
  }, []);

  const cancelRotate = useCallback(() => {
    rotateRef.current = null;
    setRotatePreview(null);
  }, []);

  return {
    zoom,
    pan,
    mode,
    activeTool,
    pendingConnector,
    marquee,
    penPoints,
    movePreview,
    resizePreview,
    rotatePreview,
    setZoom,
    stepZoom: step,
    setPan,
    setMode,
    setActiveTool,
    setPendingConnector,
    setMarquee,
    setPenPoints,
    marqueeRect: marquee === null ? null : marqueeRect(marquee.start, marquee.end),
    onPlace,
    onConnectorPick,
    onPen,
    beginMove,
    moveDrag,
    endMove,
    cancelMove,
    beginResize,
    resizeDrag,
    endResize,
    cancelResize,
    beginRotate,
    rotateDrag,
    endRotate,
    cancelRotate,
  };
}

export { useCanvasViewport };
export type { CanvasViewportState, MovePreview };
