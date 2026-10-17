import { useStore } from "zustand";

import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { CanvasDock } from "../canvas/CanvasDock";
import { marqueeRect, penStroke, rectsIntersect, screenToCanvas } from "../canvas/viewport";
import { useCanvasViewport } from "../canvas/viewport-state";
import { useBlock } from "../hooks";
import { Button } from "../shared/ui";
import { ScrollArea } from "../shared/ui/ScrollArea";
import { Minus } from "../shared/ui/icons/Minus";
import { Plus } from "../shared/ui/icons/Plus";
import { BlockGroups } from "./BlockView";
import { CanvasItem } from "./CanvasItem";
import { ConnectorLayer } from "./ConnectorLayer";
import { BlockContext, useBlockContextValue } from "./block-context";
import { pageCardStyle } from "./canvas-geometry";

/**
 * One surface's layer on the document canvas (the canvas view): its
 * children (the canvas elements) under the surface's own block context —
 * the connector endpoints resolve against this siblings list — plus the
 * surface's connector overlay. The context provider is not a DOM node, so
 * several surfaces merge onto the same canvas in root order (the later
 * surface paints on top: the DOM order is the z-order).
 */
function SurfaceLayer({
  id,
  children,
  pendingConnector,
}: {
  id: BlockId;
  children: BlockId[];
  pendingConnector: string | null;
}) {
  const contextValue = useBlockContextValue(id, children, "surface");
  return (
    <BlockContext.Provider value={contextValue}>
      {children.map((childId) => (
        <CanvasItem key={childId} id={childId} pendingConnector={pendingConnector} />
      ))}
      <ConnectorLayer id={id} />
    </BlockContext.Provider>
  );
}

/**
 * The canvas zoom controls (the floating chrome, top-right): the zoom-out /
 * current / zoom-in buttons. The zoom stands in the view state only — no
 * data, no awareness. `onMouseDown` keeps the default out (a click on the
 * chrome must not steal the pointer into a canvas session).
 */
function ZoomControls({
  zoom,
  onStep,
  onReset,
}: {
  zoom: number;
  onStep: (direction: 1 | -1) => void;
  onReset: () => void;
}) {
  return (
    <div data-slot="docblocks/canvas-chrome" className="absolute top-3 right-3 z-50">
      <div
        data-slot="docblocks/zoom-controls"
        role="toolbar"
        aria-label="Canvas zoom"
        className="
          flex items-center gap-0.5 rounded-(--docblocks-radius) border border-(--docblocks-formatbar-border-color)
          bg-(--docblocks-formatbar-background) p-1 text-(--docblocks-text-color) shadow-(--docblocks-formatbar-shadow)
        "
        onMouseDown={(event) => event.preventDefault()}
      >
        <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => onStep(-1)}>
          <Minus className="size-4" />
        </Button>
        <Button variant="ghost" size="sm" aria-label="Reset zoom" className="min-w-14 tabular-nums" onClick={onReset}>
          {Math.round(zoom * 100)}%
        </Button>
        <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => onStep(1)}>
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/** The in-flight canvas pointer session (the primary button only). */
type CanvasSession =
  | { kind: "pan"; startClientX: number; startClientY: number; startPanX: number; startPanY: number }
  | { kind: "marquee" }
  | { kind: "pen"; points: { x: number; y: number }[] };

/**
 * The document's canvas view (the `view === "canvas"` mode): the document's
 * page rendered as a page miniature — a positioned vertical rectangle of
 * page proportions holding the root's page children (the non-surface
 * children, in reading order) — at the root's geometry (the center anchor;
 * the default is the canvas center with the default page size), and every
 * root-level surface's elements on the same canvas (the shared origin is
 * the canvas center). The surface container itself has no canvas box here:
 * the canvas view IS the surface. The content stands in a single world
 * wrapper carrying the zoom/pan transform (the transform origin is the
 * container's center; the dot grid follows the pan/zoom as the background
 * position/size). Switching views writes nothing to the data (the view is
 * view state, like the selection).
 *
 * The canvas interaction (the pointer sessions on the container): the pan
 * mode (or the held space) drags the canvas from anywhere; the default
 * mode marquee-selects from the empty canvas (the block selection over the
 * intersecting canvas items; the focus parks on the editor root so the
 * Delete/Backspace path reaches the selection) and click-selects a single
 * canvas item. The editing surfaces (the canvas-text inners, the page
 * miniature's content) keep their own pointer handling (the caret), and
 * the floating chrome (the zoom controls, the dock) handles its own.
 */
function CanvasView() {
  const { store, doc, rootBlockId, selection } = useEditorContext();
  const rootChildren = useStore(store, (state) => state.rootChildren);
  const blocks = useStore(store, (state) => state.blocks);
  const root = useBlock(rootBlockId);
  const viewport = useCanvasViewport(doc);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<CanvasSession | null>(null);
  const [spacePan, setSpacePan] = useState(false);

  // Split the root's children into the page (the non-surface blocks, in
  // reading order) and the surfaces (each rendered as its own layer).
  const { pageChildren, surfaces } = useMemo(() => {
    const page: BlockId[] = [];
    const list: { id: BlockId; children: BlockId[] }[] = [];
    for (const id of rootChildren) {
      const block = blocks[id];
      if (block === undefined) continue;
      if (block.type === "surface") {
        list.push({ id, children: block.children ?? [] });
      } else {
        page.push(id);
      }
    }
    return { pageChildren: page, surfaces: list };
  }, [rootChildren, blocks]);

  const pageContext = useBlockContextValue(rootBlockId, pageChildren, "root");

  if (root === undefined) return null;

  // The event point in the container space, center-relative (px) — the
  // world wrapper's transform origin.
  const centerRelativePoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (container === null) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    return {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    };
  };

  // The editing surfaces keep the pointer: the canvas-text inners and the
  // page miniature's content (the caret / the text selection).
  const isEditingSurface = (target: EventTarget | null) =>
    target instanceof Element && target.closest('[contenteditable="true"], input, textarea') !== null;

  // The floating chrome (the zoom controls, the dock) handles its own
  // pointers (the session would otherwise start on the button).
  const isChrome = (target: EventTarget | null) =>
    target instanceof Element && target.closest('[data-slot="docblocks/canvas-chrome"]') !== null;

  // The page miniature's content keeps the pointer too (no marquee/pen from
  // the page: the page blocks are not canvas items).
  const isPageCard = (target: EventTarget | null) =>
    target instanceof Element && target.closest('[data-slot="docblocks/page-card"]') !== null;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (isChrome(event.target)) return;
    const point = centerRelativePoint(event);

    // The active tool wins over the surface it lands on (the explicit
    // placement intent: a shape / stroke / connector placed over the page
    // miniature or a canvas-text inner stands on top of it).
    if (viewport.activeTool === "pen") {
      sessionRef.current = { kind: "pen", points: [screenToCanvas(point, viewport.zoom, viewport.pan)] };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }

    if (viewport.activeTool !== null && viewport.activeTool !== "connector") {
      // The click-to-place tools: the block lands at the click point (the
      // center anchor), the tool resets.
      viewport.onPlace(screenToCanvas(point, viewport.zoom, viewport.pan));
      return;
    }

    if (viewport.activeTool === "connector") {
      // The two-click endpoint picks: a click off the canvas items (the
      // empty canvas, the page miniature) cancels the pick.
      const item =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-slot="docblocks/canvas-item"]')
          : null;
      const id = item?.getAttribute("data-block-id") ?? null;
      if (id === null || id === viewport.pendingConnector) {
        viewport.setActiveTool(null);
        viewport.setPendingConnector(null);
        return;
      }
      viewport.onConnectorPick(id);
      return;
    }

    if (isEditingSurface(event.target)) return;

    if (viewport.mode === "pan" || spacePan) {
      sessionRef.current = {
        kind: "pan",
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPanX: viewport.pan.x,
        startPanY: viewport.pan.y,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }

    if (isPageCard(event.target)) return;

    const item =
      event.target instanceof Element ? event.target.closest<HTMLElement>('[data-slot="docblocks/canvas-item"]') : null;
    if (item !== null) {
      const id = item.getAttribute("data-block-id");
      if (id !== null) {
        selection.view?.set({ kind: "blocks", ids: [id], anchorId: id });
        containerRef.current?.focus();
      }
      return;
    }

    sessionRef.current = { kind: "marquee" };
    viewport.setMarquee({ start: point, end: point });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (session === null) return;
    const point = centerRelativePoint(event);

    if (session.kind === "pan") {
      viewport.setPan({
        x: session.startPanX + (event.clientX - session.startClientX),
        y: session.startPanY + (event.clientY - session.startClientY),
      });
    } else if (session.kind === "marquee") {
      const start = viewport.marquee?.start ?? point;
      viewport.setMarquee({ start, end: point });
    } else {
      session.points.push(screenToCanvas(point, viewport.zoom, viewport.pan));
      viewport.setPenPoints([...session.points]);
    }
  };

  const onPointerUp = () => {
    const session = sessionRef.current;
    if (session === null) return;
    sessionRef.current = null;

    if (session.kind === "pen") {
      const stroke = penStroke(session.points);
      if (stroke !== null) {
        const first = session.points[0];
        const last = session.points[session.points.length - 1];
        if (
          first !== undefined &&
          last !== undefined &&
          Math.hypot((first.x - last.x) * viewport.zoom, (first.y - last.y) * viewport.zoom) >= 3
        ) {
          viewport.onPen(stroke);
        }
      }
      viewport.setPenPoints([]);
      viewport.setActiveTool(null);
      return;
    }

    if (session.kind === "marquee") {
      const marquee = viewport.marquee;
      viewport.setMarquee(null);
      if (marquee === null || containerRef.current === null) return;
      const rect = marqueeRect(marquee.start, marquee.end);
      if (rect.width < 3 || rect.height < 3) {
        // A click on the empty canvas (no drag): clear the selection.
        selection.view?.set({ kind: "none" });
        return;
      }
      const containerRect = containerRef.current.getBoundingClientRect();
      const center = { x: containerRect.width / 2, y: containerRect.height / 2 };
      const ids: BlockId[] = [];
      for (const el of containerRef.current.querySelectorAll<HTMLElement>('[data-slot="docblocks/canvas-item"]')) {
        const box = el.getBoundingClientRect();
        const itemRect = {
          left: box.left - containerRect.left - center.x,
          top: box.top - containerRect.top - center.y,
          width: box.width,
          height: box.height,
        };
        const id = el.getAttribute("data-block-id");
        if (id !== null && rectsIntersect(rect, itemRect)) ids.push(id);
      }
      selection.view?.set(ids.length > 0 ? { kind: "blocks", ids, anchorId: ids[0]! } : { kind: "none" });
      // The focus parks on the canvas container (the Delete keydown has to
      // bubble through it — the editor-root focus would skip the container
      // handler).
      containerRef.current?.focus();
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isEditingSurface(event.target)) return;
    // The canvas items' delete (the page's removeBlocksSelection path
    // stands the root's page sequence — the canvas items are not in it).
    // A mixed selection bubbles to the editor root's handler.
    if ((event.key === "Delete" || event.key === "Backspace") && deleteCanvasSelection()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Escape" && (viewport.activeTool !== null || viewport.pendingConnector !== null)) {
      // The canvas tools' cancel (the page's Escape clears the selection —
      // the tool cancels first, the selection stands).
      event.stopPropagation();
      viewport.setActiveTool(null);
      viewport.setPendingConnector(null);
      viewport.setPenPoints([]);
      sessionRef.current = null;
      return;
    }
    if (event.key === " " && !event.repeat) {
      // The held space: the temporary pan (Miro's hand).
      setSpacePan(true);
    }
  };

  // The pure-canvas selection delete: every selected id is a direct
  // surface child → one transact of removeBlock (the core cascades a
  // frame's nested content). Returns false for a non-canvas selection
  // (the page path owns it).
  const deleteCanvasSelection = (): boolean => {
    const sel = selection.view?.get();
    if (sel?.kind !== "blocks" || sel.ids.length === 0) return false;
    const surfaceChildren: BlockId[][] = [];
    for (const childId of doc.getChildren(rootBlockId)) {
      if (doc.getBlock(childId)?.type === "surface") surfaceChildren.push(doc.getChildren(childId));
    }
    if (!sel.ids.every((id) => surfaceChildren.some((list) => list.includes(id)))) return false;
    const ids = [...sel.ids];
    doc.transact(() => {
      for (const id of ids) {
        if (doc.getBlock(id) === null) continue; // a previous cascade took it
        doc.removeBlock(id);
      }
    });
    selection.view?.set({ kind: "none" });
    containerRef.current?.focus();
    return true;
  };

  const onKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === " ") setSpacePan(false);
  };

  const cursor =
    viewport.activeTool !== null
      ? "cursor-crosshair"
      : viewport.mode === "pan" || spacePan
        ? "cursor-grab"
        : "cursor-default";

  return (
    <div
      data-slot="docblocks/canvas-view"
      ref={containerRef}
      tabIndex={-1}
      className={
        "relative h-(--docblocks-canvas-view-height) overflow-hidden bg-(--docblocks-canvas-background) " +
        "bg-[radial-gradient(circle,var(--docblocks-canvas-view-dot)_1px,transparent_1px)] focus:outline-none " +
        cursor
      }
      style={{
        // The dot grid follows the pan/zoom (the background position is the
        // container center offset by the pan, the cell is the grid step
        // scaled by the zoom).
        backgroundPosition: `calc(50% + ${viewport.pan.x}px) calc(50% + ${viewport.pan.y}px)`,
        backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    >
      <div
        data-slot="docblocks/canvas-world"
        className="absolute inset-0"
        style={{
          transform: `translate(${viewport.pan.x}px, ${viewport.pan.y}px) scale(${viewport.zoom})`,
          transformOrigin: "center",
        }}
      >
        <ScrollArea
          data-slot="docblocks/page-card"
          style={pageCardStyle(root)}
          className="
            box-border rounded-(--docblocks-radius) bg-(--docblocks-page-card-background)
            p-(--docblocks-page-card-padding) shadow-(--docblocks-page-card-shadow)
          "
        >
          <BlockContext.Provider value={pageContext}>
            <BlockGroups ids={pageChildren} />
          </BlockContext.Provider>
        </ScrollArea>
        {surfaces.map(({ id, children }) => (
          <SurfaceLayer key={id} id={id} children={children} pendingConnector={viewport.pendingConnector} />
        ))}
        {viewport.penPoints.length > 1 && (
          <svg
            data-slot="docblocks/canvas-pen-preview"
            className="pointer-events-none absolute top-1/2 left-1/2 overflow-visible"
            width={0}
            height={0}
          >
            <path
              d={viewport.penPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
      {viewport.marqueeRect !== null && (
        <div
          data-slot="docblocks/canvas-marquee"
          className="
            pointer-events-none absolute z-40 border border-(--docblocks-formatbar-border-color)
            bg-(--docblocks-selected-background)
          "
          style={{
            left: `calc(50% + ${viewport.marqueeRect.left}px)`,
            top: `calc(50% + ${viewport.marqueeRect.top}px)`,
            width: viewport.marqueeRect.width,
            height: viewport.marqueeRect.height,
          }}
        />
      )}
      <ZoomControls zoom={viewport.zoom} onStep={viewport.stepZoom} onReset={() => viewport.setZoom(1)} />
      <CanvasDock viewport={viewport} />
    </div>
  );
}

export { CanvasView };
