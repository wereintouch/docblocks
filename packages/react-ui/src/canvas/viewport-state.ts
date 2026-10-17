import { useCallback, useState } from "react";

import type { Doc } from "docblocks-core";

import { placeCanvasText, placeConnector, placeFrame, placePenStroke, placeShape } from "./insert";
import { TOOL_SIZES, marqueeRect, stepZoom } from "./viewport";
import type { CanvasMode, CanvasPoint, CanvasTool, PenStroke, ScreenPoint, ScreenRect } from "./viewport";

/** The marquee's corners during the drag (the container space, center-relative). */
interface MarqueeState {
  start: ScreenPoint;
  end: ScreenPoint;
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
}

function useCanvasViewport(doc: Doc): CanvasViewportState {
  const [zoom, setZoomState] = useState(1);
  const [pan, setPan] = useState<ScreenPoint>({ x: 0, y: 0 });
  const [mode, setMode] = useState<CanvasMode>("default");
  const [activeTool, setActiveTool] = useState<CanvasTool | null>(null);
  const [pendingConnector, setPendingConnector] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [penPoints, setPenPoints] = useState<CanvasPoint[]>([]);

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

  return {
    zoom,
    pan,
    mode,
    activeTool,
    pendingConnector,
    marquee,
    penPoints,
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
  };
}

export { useCanvasViewport };
export type { CanvasViewportState };
