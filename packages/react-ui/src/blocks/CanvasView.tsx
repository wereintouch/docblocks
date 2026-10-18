import { useStore } from "zustand";

import { useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import type { BlockId, SelectionView } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { CanvasDock } from "../canvas/CanvasDock";
import { ConnectorToolbar } from "../canvas/ConnectorToolbar";
import { ShapeToolbar } from "../canvas/ShapeToolbar";
import {
  MOVE_THRESHOLD_PX,
  canvasToScreen,
  marqueeRect,
  penStroke,
  rectsIntersect,
  screenToCanvas,
} from "../canvas/viewport";
import type { Box, CanvasPoint, CanvasTool, ResizeHandle } from "../canvas/viewport";
import { useCanvasViewport } from "../canvas/viewport-state";
import type { MovePreview } from "../canvas/viewport-state";
import { useBlock } from "../hooks";
import { Button } from "../shared/ui";
import { ScrollArea } from "../shared/ui/ScrollArea";
import { cn } from "../shared/ui/cn";
import { Minus } from "../shared/ui/icons/Minus";
import { Plus } from "../shared/ui/icons/Plus";
import { BlockGroups } from "./BlockView";
import { CanvasItem } from "./CanvasItem";
import { ConnectorLayer } from "./ConnectorLayer";
import { ShapeSvg } from "./ShapeSvg";
import { BlockContext, useBlockContextValue } from "./block-context";
import { connectorPath, endpointBoxOf } from "./canvas-geometry";
import { effectiveGeometry, pageCardStyle } from "./canvas-geometry";

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
  movePreview,
  resizePreview,
  rotatePreview,
}: {
  id: BlockId;
  children: BlockId[];
  pendingConnector: string | null;
  movePreview: MovePreview | null;
  resizePreview: { id: string; box: Box } | null;
  rotatePreview: { id: string; rotation: number } | null;
}) {
  const contextValue = useBlockContextValue(id, children, "surface");
  return (
    <BlockContext.Provider value={contextValue}>
      {children.map((childId) => (
        <CanvasItem
          key={childId}
          id={childId}
          pendingConnector={pendingConnector}
          movePreview={movePreview !== null && movePreview.ids.includes(childId) ? movePreview : null}
          resizeBox={resizePreview !== null && resizePreview.id === childId ? resizePreview.box : null}
          rotatePreview={rotatePreview !== null && rotatePreview.id === childId ? rotatePreview.rotation : null}
        />
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
/** The eight resize handles' positions (box percentages) + cursors. */
const RESIZE_HANDLE_POSITIONS: { handle: ResizeHandle; className: string; style: CSSProperties }[] = [
  { handle: "nw", className: "cursor-nwse-resize", style: { left: 0, top: 0, transform: "translate(-50%, -50%)" } },
  { handle: "n", className: "cursor-ns-resize", style: { left: "50%", top: 0, transform: "translate(-50%, -50%)" } },
  {
    handle: "ne",
    className: "cursor-nesw-resize",
    style: { left: "100%", top: 0, transform: "translate(-50%, -50%)" },
  },
  {
    handle: "e",
    className: "cursor-ew-resize",
    style: { left: "100%", top: "50%", transform: "translate(-50%, -50%)" },
  },
  {
    handle: "se",
    className: "cursor-nwse-resize",
    style: { left: "100%", top: "100%", transform: "translate(-50%, -50%)" },
  },
  {
    handle: "s",
    className: "cursor-ns-resize",
    style: { left: "50%", top: "100%", transform: "translate(-50%, -50%)" },
  },
  {
    handle: "sw",
    className: "cursor-nesw-resize",
    style: { left: 0, top: "100%", transform: "translate(-50%, -50%)" },
  },
  { handle: "w", className: "cursor-ew-resize", style: { left: 0, top: "50%", transform: "translate(-50%, -50%)" } },
];

/** The rotate handle's offset above the box top edge (screen px). */
const HANDLE_ROTATE_OFFSET_PX = 24;

/** The shape toolbar's offset above the box top edge (screen px): it
 * stands over the rotate handle (24px), so it clears the handle zone. */
const TOOLBAR_OFFSET_PX = 48;

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

/** The shape placement tools (the drag-to-size gesture's tools). */
type ShapeTool = Extract<CanvasTool, "rect" | "ellipse" | "diamond" | "line">;

/** The in-flight canvas pointer session (the primary button only). */
type CanvasSession =
  | { kind: "pan"; startClientX: number; startClientY: number; startPanX: number; startPanY: number }
  | { kind: "marquee"; additive: boolean }
  | { kind: "pen"; points: { x: number; y: number }[] }
  | { kind: "place"; tool: ShapeTool; start: CanvasPoint; startClientX: number; startClientY: number };

/**
 * The shift-click selection toggle (the additive select): the id joins or
 * leaves the current block selection — the anchor stands on the clicked
 * id when it joins and keeps the old anchor (or the first remaining id)
 * when it leaves. A pure view-state mutation: no document update.
 */
function toggleCanvasSelection(view: SelectionView, id: BlockId): void {
  const sel = view.get();
  const ids = sel.kind === "blocks" ? sel.ids : [];
  if (ids.includes(id)) {
    const next = ids.filter((existing) => existing !== id);
    if (next.length === 0) {
      view.set({ kind: "none" });
      return;
    }
    const anchorId = sel.kind === "blocks" && next.includes(sel.anchorId) ? sel.anchorId : next[0]!;
    view.set({ kind: "blocks", ids: next, anchorId });
    return;
  }
  view.set({ kind: "blocks", ids: [...ids, id], anchorId: id });
}

/** The page-card scrollbar-strip guard width (the native thin bar's reach). */
const SCROLLBAR_GUARD_PX = 12;

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
  // The reactive selection (the handles' render condition): the context's
  // `selection` handle is stable, so the store slice drives the re-render.
  const storeSelection = useStore(store, (state) => state.selection);
  const root = useBlock(rootBlockId);
  const viewport = useCanvasViewport(doc);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<CanvasSession | null>(null);
  // The page miniature's first press stands the card's move session over
  // the page's content (the two-click contract) — the flag drops the
  // compatibility mousedown's default (the caret / the focus move).
  const cardPressRef = useRef(false);
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

  // The handles' target: a single block selection with an effective box
  // (the stored geometry or the synthesized default; the connector is
  // excluded — it carries no own geometry). The rotation preview / the
  // resize preview stand over the stored values while in flight.
  const handleTarget = useMemo(() => {
    if (storeSelection?.kind !== "blocks" || storeSelection.ids.length !== 1) return null;
    const id = storeSelection.ids[0]!;
    const block = blocks[id];
    if (block === undefined || block.type === "connector") return null;
    return { id, box: effectiveGeometry(block), rotation: block.geometry?.rotation ?? 0 };
  }, [storeSelection, blocks]);
  const displayBox =
    handleTarget !== null && viewport.resizePreview !== null && viewport.resizePreview.id === handleTarget.id
      ? viewport.resizePreview.box
      : (handleTarget?.box ?? null);

  // The multi-selection's summary box: the union of the selected items'
  // effective boxes (the connector is excluded — it carries no own
  // geometry). Hidden while a move preview is in flight (the union is
  // stale then, like the single-selection handles).
  const multiSelectionBox = useMemo(() => {
    if (storeSelection?.kind !== "blocks" || storeSelection.ids.length < 2) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let count = 0;
    for (const id of storeSelection.ids) {
      const block = blocks[id];
      if (block === undefined || block.type === "connector") continue;
      const box = effectiveGeometry(block);
      minX = Math.min(minX, box.x - box.w / 2);
      minY = Math.min(minY, box.y - box.h / 2);
      maxX = Math.max(maxX, box.x + box.w / 2);
      maxY = Math.max(maxY, box.y + box.h / 2);
      count += 1;
    }
    if (count < 2 || !Number.isFinite(minX)) return null;
    return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
  }, [storeSelection, blocks]);
  const displayRotation =
    handleTarget !== null && viewport.rotatePreview !== null && viewport.rotatePreview.id === handleTarget.id
      ? viewport.rotatePreview.rotation
      : (handleTarget?.rotation ?? null);

  // The color toolbar's target: a single `shape` selection (the fill /
  // stroke attrs); absent for the other canvas types, the multi
  // selection, an active tool, or an in-flight session.
  const shapeToolbarTarget = (() => {
    if (handleTarget === null || viewport.activeTool !== null) return null;
    if (viewport.movePreview !== null || viewport.resizePreview !== null || viewport.rotatePreview !== null)
      return null;
    const block = blocks[handleTarget.id];
    if (block === undefined || block.type !== "shape") return null;
    return {
      id: handleTarget.id,
      fill: block.attrs?.fill,
      stroke: block.attrs?.stroke,
      variant: block.attrs?.variant,
    };
  })();

  // The connector type toolbar's target: a single `connector` selection
  // whose endpoints resolve within the surface (the toolbar seats at the
  // line's midpoint; absent for the multi selection, an active tool, or
  // an in-flight session).
  const connectorToolbarTarget = (() => {
    if (viewport.activeTool !== null) return null;
    if (viewport.movePreview !== null || viewport.resizePreview !== null || viewport.rotatePreview !== null)
      return null;
    if (storeSelection?.kind !== "blocks" || storeSelection.ids.length !== 1) return null;
    const id = storeSelection.ids[0]!;
    const block = blocks[id];
    if (block === undefined || block.type !== "connector" || block.attrs === undefined) return null;
    const surface = surfaces.find((entry) => entry.children.includes(id));
    if (surface === undefined) return null;
    const childIds = surface.children;
    const start = endpointBoxOf(block.attrs.start, childIds, blocks);
    const end = endpointBoxOf(block.attrs.end, childIds, blocks);
    if (start === null || end === null) return null;
    const mid = connectorPath(start, end, block.attrs.variant ?? "straight").mid;
    return { id, variant: block.attrs.variant, mid };
  })();

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
    // The DOM containment guard: React's synthetic events bubble through
    // the FIBER tree, not the DOM tree — the portaled popover content
    // (the shape toolbar's palettes) stands in `document.body`, but its
    // pointer presses reach this handler through the component chain
    // (target = the portaled element). A press outside the container's
    // DOM subtree belongs to the portal content, not to the canvas.
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
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
      const tool = viewport.activeTool;
      if (tool === "rect" || tool === "ellipse" || tool === "diamond" || tool === "line") {
        // The shape's drag-to-size: the press starts the session (no
        // commit yet), the drag stands the preview (the marquee's
        // gesture), the release commits the dragged size (a click stands
        // the default-size place).
        const start = screenToCanvas(point, viewport.zoom, viewport.pan);
        sessionRef.current = {
          kind: "place",
          tool: tool as ShapeTool,
          start,
          startClientX: event.clientX,
          startClientY: event.clientY,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        return;
      }
      // The click-to-place tools (text / frame): the block lands at the
      // click point (the center anchor), the tool resets.
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

    // The pan (the dock's hand, the held space) wins over the editing
    // surfaces it lands on (the hand's contract: a grab anywhere pans —
    // the press is prevented, so the drag stands no caret / text
    // selection on the surface).
    if (viewport.mode === "pan" || spacePan) {
      // The press stands the pan (the surfaces keep no caret / text
      // selection); the focus parks on the container (the preventDefault
      // drops the default focus change — the keydown reach stands).
      event.preventDefault();
      containerRef.current?.focus();
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

    if (isEditingSurface(event.target)) {
      // The editing surfaces outside the page miniature (the frame's
      // content, the canvas-text's inner) keep the plain caret press;
      // the page miniature's content stands the two-click contract: the
      // first press selects the card (the root's one-item selection +
      // the move session, like an item press — the caret stands only on
      // the second press, the card already selected).
      if (!isPageCard(event.target) || event.shiftKey) return;
      const sel = selection.view?.get();
      if (sel?.kind === "blocks" && sel.ids.includes(rootBlockId)) return; // the caret
      event.preventDefault();
      containerRef.current?.focus();
      selection.view?.set({ kind: "blocks", ids: [rootBlockId], anchorId: rootBlockId });
      viewport.beginMove([rootBlockId], event.clientX, event.clientY);
      cardPressRef.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }

    // The resize / rotate handles (the single-selection overlay): the
    // press starts the session (the pan mode / the held space stand
    // before this — space+drag over a handle pans).
    const handle =
      event.target instanceof Element
        ? (event.target.closest<HTMLElement>('[data-slot="docblocks/canvas-handle"]') ?? null)
        : null;
    if (handle !== null && handleTarget !== null) {
      containerRef.current?.focus();
      if (handle.dataset.handle === "rotate") {
        viewport.beginRotate(
          handleTarget.id,
          { x: handleTarget.box.x, y: handleTarget.box.y },
          event.clientX,
          event.clientY
        );
      } else {
        const resizeHandle = handle.dataset.handle as ResizeHandle | undefined;
        if (resizeHandle !== undefined)
          viewport.beginResize(handleTarget.id, resizeHandle, event.clientX, event.clientY);
      }
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }

    const item =
      event.target instanceof Element ? event.target.closest<HTMLElement>('[data-slot="docblocks/canvas-item"]') : null;
    if (item !== null) {
      const id = item.getAttribute("data-block-id");
      if (id !== null) {
        if (event.shiftKey) {
          // The shift toggle (no move session — the selection stands; the
          // focus parks on the container so the keys reach the view).
          containerRef.current?.focus();
          if (selection.view !== null) toggleCanvasSelection(selection.view, id);
          return;
        }
        // Group-aware selection: an item inside the current block selection
        // keeps the group (the group is what moves); otherwise it stands
        // alone. The check stands BEFORE the page-card guard: an item
        // paints over the card, so a press on it is an item press (not a
        // card press).
        const sel = selection.view?.get();
        const ids = sel?.kind === "blocks" && sel.ids.includes(id) ? sel.ids : [id];
        selection.view?.set({ kind: "blocks", ids, anchorId: id });
        containerRef.current?.focus();
        viewport.beginMove(ids, event.clientX, event.clientY);
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }
      return;
    }

    // The connector's hit path (the wide transparent stroke, the overlay
    // paints over the items): the click selects the connector — group-
    // aware as the items', but NO move session (the connectors carry no
    // geometry — the line follows the endpoint blocks).
    const connectorHit =
      event.target instanceof Element ? event.target.closest<SVGElement>("[data-connector-hit]") : null;
    if (connectorHit !== null) {
      const id = connectorHit.getAttribute("data-connector-hit");
      if (id !== null) {
        if (event.shiftKey) {
          // The shift toggle (the same contract as the item's: no move —
          // the connectors carry no geometry at all).
          containerRef.current?.focus();
          if (selection.view !== null) toggleCanvasSelection(selection.view, id);
          return;
        }
        const sel = selection.view?.get();
        const ids = sel?.kind === "blocks" && sel.ids.includes(id) ? sel.ids : [id];
        selection.view?.set({ kind: "blocks", ids, anchorId: id });
        containerRef.current?.focus();
      }
      return;
    }

    if (isPageCard(event.target)) {
      if (event.shiftKey) {
        // The shift press stands the selection (the additive contract —
        // no root move, no clear).
        return;
      }
      // The card's scroll element is the card itself (the consumer
      // data-slot stands on the ScrollArea's root div).
      const card =
        event.target instanceof Element
          ? (event.target.closest('[data-slot="docblocks/page-card"]') as HTMLElement | null)
          : null;
      if (card !== null && card.scrollHeight > card.clientHeight) {
        // The card's native thin scrollbar strip (non-contenteditable):
        // the press belongs to the scrollbar drag, not the card move.
        const rect = card.getBoundingClientRect();
        const inStrip =
          event.clientX > rect.right - SCROLLBAR_GUARD_PX || event.clientY > rect.bottom - SCROLLBAR_GUARD_PX;
        if (inStrip) return;
      }
      // The page miniature moves from its non-editing areas (the content
      // keeps the caret): the one-item selection + move session over the
      // root (the selection stands the handles' target).
      containerRef.current?.focus();
      selection.view?.set({ kind: "blocks", ids: [rootBlockId], anchorId: rootBlockId });
      viewport.beginMove([rootBlockId], event.clientX, event.clientY);
      cardPressRef.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }

    sessionRef.current = { kind: "marquee", additive: event.shiftKey };
    viewport.setMarquee({ start: point, end: point });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The release can be lost (the pointer leaves the window mid-drag
    // and the capture is dropped without a pointerup / pointercancel):
    // a button-less move then stands over a surviving session and the
    // world chases the cursor (the next release would commit a stale
    // geometry). A button-less move drops every standing session; a
    // real drag carries the primary button.
    if ((event.buttons & 1) === 0) {
      dropCanvasSessions();
      return;
    }

    // The move / resize / rotate sessions (item / page-card / handle
    // press) run without a container session; the feeders are no-ops
    // while none is open.
    viewport.moveDrag(event.clientX, event.clientY);
    viewport.resizeDrag(event.clientX, event.clientY, event.shiftKey);
    viewport.rotateDrag(centerRelativePoint(event), event.clientX, event.clientY, event.shiftKey);
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
    } else if (session.kind === "place") {
      // The drag-to-size preview: the box is the drag's extent (the
      // marquee's math), the center anchor is the drag's midpoint.
      const current = screenToCanvas(point, viewport.zoom, viewport.pan);
      viewport.setPlacePreview({
        variant: session.tool,
        x: (session.start.x + current.x) / 2,
        y: (session.start.y + current.y) / 2,
        w: Math.max(Math.abs(current.x - session.start.x), 1),
        h: Math.max(Math.abs(current.y - session.start.y), 1),
      });
    } else if (session.kind === "pen") {
      session.points.push(screenToCanvas(point, viewport.zoom, viewport.pan));
      viewport.setPenPoints([...session.points]);
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    cardPressRef.current = false;
    viewport.endMove();
    viewport.endResize();
    viewport.endRotate();
    const session = sessionRef.current;
    if (session === null) return;
    sessionRef.current = null;

    if (session.kind === "place") {
      // The release commits: a sub-threshold drag is the click place (the
      // default size), a real drag lands the dragged size at the drag's
      // midpoint (one transact, the tool resets, the preview drops).
      const current = screenToCanvas(centerRelativePoint(event), viewport.zoom, viewport.pan);
      if (Math.hypot(event.clientX - session.startClientX, event.clientY - session.startClientY) < MOVE_THRESHOLD_PX) {
        viewport.onPlace(session.start);
      } else {
        viewport.onPlaceSize(
          session.tool,
          { x: (session.start.x + current.x) / 2, y: (session.start.y + current.y) / 2 },
          {
            w: Math.max(Math.abs(current.x - session.start.x), 1),
            h: Math.max(Math.abs(current.y - session.start.y), 1),
          }
        );
      }
      viewport.setPlacePreview(null);
      return;
    }

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
      const additive = session.additive;
      const marquee = viewport.marquee;
      viewport.setMarquee(null);
      if (marquee === null || containerRef.current === null) return;
      const rect = marqueeRect(marquee.start, marquee.end);
      if (rect.width < 3 || rect.height < 3) {
        // A click on the empty canvas (no drag): clear the selection —
        // the additive press (the shift down) keeps it.
        if (additive === false) selection.view?.set({ kind: "none" });
        return;
      }
      const containerRect = containerRef.current.getBoundingClientRect();
      const center = { x: containerRect.width / 2, y: containerRect.height / 2 };
      const ids: BlockId[] = [];
      for (const el of containerRef.current.querySelectorAll<HTMLElement>('[data-slot="docblocks/canvas-item"]')) {
        const id = el.getAttribute("data-block-id");
        // The connector's wrapper is an empty origin box (its line lives
        // in the overlay): it is not marquee-selectable.
        if (id === null || blocks[id]?.type === "connector") continue;
        const box = el.getBoundingClientRect();
        const itemRect = {
          left: box.left - containerRect.left - center.x,
          top: box.top - containerRect.top - center.y,
          width: box.width,
          height: box.height,
        };
        if (rectsIntersect(rect, itemRect)) ids.push(id);
      }
      if (additive) {
        // The shift-marquee's union: the pre-marquee selection stands first
        // (the marquee extends it — an empty union keeps the selection).
        const sel = selection.view?.get();
        const base = sel?.kind === "blocks" ? sel.ids : [];
        const merged = [...base, ...ids.filter((id) => !base.includes(id))];
        selection.view?.set(
          merged.length > 0
            ? {
                kind: "blocks",
                ids: merged,
                anchorId: base.length > 0 && sel?.kind === "blocks" ? sel.anchorId : merged[0]!,
              }
            : { kind: "none" }
        );
      } else {
        selection.view?.set(ids.length > 0 ? { kind: "blocks", ids, anchorId: ids[0]! } : { kind: "none" });
      }
      // The focus parks on the canvas container (the Delete keydown has to
      // bubble through it — the editor-root focus would skip the container
      // handler).
      containerRef.current?.focus();
    }
  };

  // The page miniature's two-click contract (the compatibility
  // mousedown): the first press over the page's content starts the card's
  // move session — the mousedown's default (the caret / the focus move)
  // stands no more. The flag stands until the release (the second press
  // stands no session, so its mousedown keeps the default).
  const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (cardPressRef.current) {
      event.preventDefault();
    }
  };

  // The OS / browser takeover (a pointer cancel, a lost capture, a
  // button-less move over a surviving session) drops every in-flight
  // session: the move's preview would otherwise stand until the next
  // release, and that release would commit a stale setGeometry. The
  // no-session calls are no-ops (the state stays, no re-render).
  const dropCanvasSessions = () => {
    // The no-session no-op: a button-less mouse move over the idle
    // canvas must not write state (no re-render) — the setX calls stand
    // fresh values (a new array for the pen points).
    if (
      sessionRef.current === null &&
      viewport.movePreview === null &&
      viewport.resizePreview === null &&
      viewport.rotatePreview === null &&
      viewport.marquee === null &&
      viewport.penPoints.length === 0 &&
      viewport.placePreview === null
    ) {
      return;
    }
    sessionRef.current = null;
    viewport.setPlacePreview(null);
    viewport.cancelMove();
    viewport.cancelResize();
    viewport.cancelRotate();
    viewport.setMarquee(null);
    viewport.setPenPoints([]);
  };

  const onPointerCancel = () => {
    cardPressRef.current = false;
    dropCanvasSessions();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // The same DOM-containment rule as the pointer handler: React's
    // synthetic events bubble through the fiber tree, so a key from a
    // portaled element (the shape toolbar's palette content, tabIndex
    // -1) reaches this handler with a target the container does not
    // contain — and would delete the selection (Delete / Backspace).
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
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
      viewport.setPlacePreview(null);
      sessionRef.current = null;
      return;
    }
    if (event.key === "Escape" && viewport.movePreview !== null) {
      // The in-flight move's cancel: the preview is dropped, nothing is
      // written, the selection stands.
      event.stopPropagation();
      viewport.cancelMove();
      return;
    }
    if (event.key === "Escape" && (viewport.resizePreview !== null || viewport.rotatePreview !== null)) {
      // The in-flight resize / rotate's cancel (the same contract as the
      // move's: the preview is dropped, nothing is written).
      event.stopPropagation();
      viewport.cancelResize();
      viewport.cancelRotate();
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

  // The page miniature's selection (the two-click contract's first press):
  // the card stands the shared selection's outline (like an item) when the
  // root is in the blocks selection.
  const pageCardSelected = storeSelection?.kind === "blocks" && storeSelection.ids.includes(rootBlockId);

  // The page miniature's display style (the committed style + the session
  // previews: the move offset, the resize box, the rotation — the same
  // composition as the CanvasItem's).
  const pageCardDisplayStyle = (() => {
    const style = pageCardStyle(root);
    if (handleTarget === null || handleTarget.id !== rootBlockId) return style;
    const isMoving = viewport.movePreview !== null && viewport.movePreview.ids.includes(rootBlockId);
    const previewBox =
      viewport.resizePreview !== null && viewport.resizePreview.id === rootBlockId ? viewport.resizePreview.box : null;
    const rotation = displayRotation ?? 0;
    if (isMoving === false && previewBox === null && rotation === (root.geometry?.rotation ?? 0)) return style;
    if (previewBox !== null) {
      style.left = `calc(50% + ${previewBox.x}px)`;
      style.top = `calc(50% + ${previewBox.y}px)`;
      style.width = `${previewBox.w}px`;
      style.height = `${previewBox.h}px`;
    }
    const parts = ["translate(-50%, -50%)"];
    // The move offset stands BEFORE the rotation (the Δ is in the canvas
    // axes; a trailing translate would land in the rotated frame).
    if (isMoving) parts.push(`translate(${viewport.movePreview!.dx}px, ${viewport.movePreview!.dy}px)`);
    if (rotation !== 0) parts.push(`rotate(${rotation}deg)`);
    style.transform = parts.join(" ");
    return style;
  })();

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
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={dropCanvasSessions}
      onMouseDown={onMouseDown}
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
          style={pageCardDisplayStyle}
          className={cn(
            `
              box-border rounded-(--docblocks-radius) bg-(--docblocks-page-card-background)
              p-(--docblocks-page-card-padding) shadow-(--docblocks-page-card-shadow)
            `,
            pageCardSelected &&
              `
                outline-(length:--docblocks-canvas-selection-border-width) outline-offset-1
                outline-(--docblocks-canvas-selection-border-color) outline-solid
              `
          )}
        >
          <BlockContext.Provider value={pageContext}>
            <BlockGroups ids={pageChildren} />
          </BlockContext.Provider>
        </ScrollArea>
        {surfaces.map(({ id, children }) => (
          <SurfaceLayer
            key={id}
            id={id}
            children={children}
            pendingConnector={viewport.pendingConnector}
            movePreview={viewport.movePreview}
            resizePreview={viewport.resizePreview}
            rotatePreview={viewport.rotatePreview}
          />
        ))}
        {viewport.placePreview !== null && (
          // The drag-to-size placement preview (the shape's figure at the
          // dragged box, the dashed cyan line; the world's space, so it
          // scales with the zoom).
          <div
            data-slot="docblocks/canvas-place-preview"
            className="pointer-events-none absolute"
            style={{
              left: `calc(50% + ${viewport.placePreview.x}px)`,
              top: `calc(50% + ${viewport.placePreview.y}px)`,
              width: `${viewport.placePreview.w}px`,
              height: `${viewport.placePreview.h}px`,
              transform: "translate(-50%, -50%)",
              color: "var(--docblocks-canvas-selection-border-color)",
              opacity: 0.6,
            }}
          >
            <ShapeSvg
              id="docblocks-place-preview"
              block={{
                type: "shape",
                attrs: { variant: viewport.placePreview.variant, stroke: "currentColor", strokeStyle: "dash" },
                geometry: {
                  x: 0,
                  y: 0,
                  w: viewport.placePreview.w,
                  h: viewport.placePreview.h,
                },
              }}
            />
          </div>
        )}
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
      {multiSelectionBox !== null && viewport.movePreview === null && (
        // The multi-selection's summary rectangle (the union of the
        // selected items' boxes + the on-screen offset, the token's
        // line + fill — screen-space like the marquee, constant at any
        // zoom). The offset is the CSS token (the style's calc reads
        // it — the px stand no literal here).
        <div
          data-slot="docblocks/canvas-multi-selection"
          className="
            pointer-events-none absolute z-30 border-(length:--docblocks-canvas-selection-border-width)
            border-(--docblocks-canvas-selection-border-color) bg-(--docblocks-canvas-selection-fill)
          "
          style={{
            left: `calc(50% + ${canvasToScreen({ x: multiSelectionBox.left, y: multiSelectionBox.top }, viewport.zoom, viewport.pan).x}px - var(--docblocks-canvas-selection-box-offset))`,
            top: `calc(50% + ${canvasToScreen({ x: multiSelectionBox.left, y: multiSelectionBox.top }, viewport.zoom, viewport.pan).y}px - var(--docblocks-canvas-selection-box-offset))`,
            width: `calc(${multiSelectionBox.width * viewport.zoom}px + 2 * var(--docblocks-canvas-selection-box-offset))`,
            height: `calc(${multiSelectionBox.height * viewport.zoom}px + 2 * var(--docblocks-canvas-selection-box-offset))`,
          }}
        />
      )}
      {viewport.marqueeRect !== null && (
        <div
          data-slot="docblocks/canvas-marquee"
          className="
            pointer-events-none absolute z-40 border-(length:--docblocks-canvas-selection-border-width)
            border-(--docblocks-canvas-selection-border-color) bg-(--docblocks-canvas-selection-fill)
          "
          style={{
            left: `calc(50% + ${viewport.marqueeRect.left}px)`,
            top: `calc(50% + ${viewport.marqueeRect.top}px)`,
            width: viewport.marqueeRect.width,
            height: viewport.marqueeRect.height,
          }}
        />
      )}
      {handleTarget !== null &&
        viewport.activeTool === null &&
        viewport.movePreview === null &&
        displayBox !== null && (
          // The selection's handles (the eight box handles + the rotate
          // handle above the top edge): screen-space, over the world
          // (they keep their on-screen size at any zoom). Hidden while a
          // move preview is in flight (the box is stale then).
          <div
            data-slot="docblocks/canvas-handles"
            className="pointer-events-none absolute z-40"
            style={{
              left: `calc(50% + ${canvasToScreen({ x: displayBox.x, y: displayBox.y }, viewport.zoom, viewport.pan).x}px)`,
              top: `calc(50% + ${canvasToScreen({ x: displayBox.x, y: displayBox.y }, viewport.zoom, viewport.pan).y}px)`,
              width: displayBox.w * viewport.zoom,
              height: displayBox.h * viewport.zoom,
              transform: `translate(-50%, -50%) rotate(${displayRotation ?? 0}deg)`,
            }}
          >
            {RESIZE_HANDLE_POSITIONS.map(({ handle: handleId, className, style }) => (
              <div
                key={handleId}
                data-slot="docblocks/canvas-handle"
                data-handle={handleId}
                className={cn(
                  "pointer-events-auto absolute size-2 rounded-full",
                  "border border-(--docblocks-formatbar-border-color) bg-(--docblocks-canvas-selection-border-color)",
                  className
                )}
                style={style}
              />
            ))}
            {handleTarget.id !== rootBlockId && (
              // The page miniature stands no rotate handle (the rotation
              // affordance is off for the editor; the shapes keep it).
              <div
                data-slot="docblocks/canvas-handle"
                data-handle="rotate"
                className={cn(
                  "pointer-events-auto absolute size-3 cursor-grab rounded-full",
                  "border border-(--docblocks-formatbar-border-color) bg-(--docblocks-canvas-selection-border-color)"
                )}
                style={{ left: "50%", top: -HANDLE_ROTATE_OFFSET_PX, transform: "translate(-50%, -50%)" }}
              />
            )}
          </div>
        )}
      {connectorToolbarTarget !== null && (
        // The connector's type toolbar (the single `connector`
        // selection): the three line types above the line's midpoint.
        <ConnectorToolbar
          id={connectorToolbarTarget.id}
          variant={connectorToolbarTarget.variant}
          style={{
            left: `calc(50% + ${canvasToScreen(connectorToolbarTarget.mid, viewport.zoom, viewport.pan).x}px)`,
            top: `calc(50% + ${canvasToScreen(connectorToolbarTarget.mid, viewport.zoom, viewport.pan).y - TOOLBAR_OFFSET_PX}px)`,
          }}
        />
      )}
      {shapeToolbarTarget !== null && displayBox !== null && (
        // The shape's color toolbar (the single `shape` selection): the
        // fill/stroke sections above the box top edge. Hidden for the
        // non-shape blocks, the multi selection, an active tool, and the
        // in-flight sessions (the box is stale then).
        <ShapeToolbar
          id={shapeToolbarTarget.id}
          fill={shapeToolbarTarget.fill}
          stroke={shapeToolbarTarget.stroke}
          variant={shapeToolbarTarget.variant}
          style={{
            left: `calc(50% + ${canvasToScreen({ x: displayBox.x, y: displayBox.y }, viewport.zoom, viewport.pan).x}px)`,
            top: `calc(50% + ${canvasToScreen({ x: displayBox.x, y: displayBox.y }, viewport.zoom, viewport.pan).y - (displayBox.h / 2) * viewport.zoom - TOOLBAR_OFFSET_PX}px)`,
          }}
        />
      )}
      <ZoomControls zoom={viewport.zoom} onStep={viewport.stepZoom} onReset={() => viewport.setZoom(1)} />
      <CanvasDock viewport={viewport} />
    </div>
  );
}

export { CanvasView };
