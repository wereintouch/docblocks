/** The canvas view's pointer sessions: the press (the selection's toggle,
 * the tool's begin), the drag (the move / the resize / the marquee / the
 * pen / the place / the connector endpoint), the release (the commit / the
 * cancel), the chrome's mouse-down (the dock's drag), and the session's
 * drop. The stand helpers (the stand item, the port pick) stand on the
 * block map + the surfaces. The editing-surface guard is passed in (the
 * keyboard hook shares it). */
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";

import type { Block, BlockId, Doc } from "docblocks-core";

import {
  MOVE_THRESHOLD_PX,
  connectorPressStand,
  marqueeRect,
  penStroke,
  placeDragBox,
  rectsIntersect,
  screenToCanvas,
  snapAnySurfaceEdge,
} from "../../canvas";
import type { CanvasViewportState, ResizeHandle } from "../../canvas";
import type { SelectionRef } from "../../editor-provider";
import { effectiveGeometry, portsOf } from "../canvas-geometry";
import { PORT_PICK_RADIUS_PX, SCROLLBAR_GUARD_PX } from "./constants";
import type { CanvasPointerSession } from "./models";
import { isPlaceTool, toggleCanvasSelection } from "./utils";

interface CanvasSessionsDeps {
  containerRef: RefObject<HTMLDivElement | null>;
  sessionRef: RefObject<CanvasPointerSession | null>;
  lastPointerRef: RefObject<{ x: number; y: number } | null>;
  cardPressRef: RefObject<boolean>;
  connectorPressClientRef: RefObject<{ x: number; y: number } | null>;
  viewport: CanvasViewportState;
  spacePan: boolean;
  blocks: Record<BlockId, Block>;
  doc: Doc;
  rootBlockId: BlockId;
  selection: SelectionRef;
  isEditingSurface: (target: EventTarget | null) => boolean;
  surfaces: { id: BlockId; children: BlockId[] }[];
  handleTarget: { id: BlockId; box: { x: number; y: number; w: number; h: number } } | null;
}

function useCanvasSessions({
  containerRef,
  sessionRef,
  lastPointerRef,
  cardPressRef,
  connectorPressClientRef,
  viewport,
  spacePan,
  blocks,
  doc,
  rootBlockId,
  selection,
  isEditingSurface,
  surfaces,
  handleTarget,
}: CanvasSessionsDeps) {
  const centerRelativePoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (container === null) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    return {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    };
  };

  // The endpoint handle's press: the container keeps the pointer (the
  // release outside the window would otherwise stand the session open —
  // the card-press capture's contract). The endpoint drag's release
  // commit reads the session, not the release target (the capture
  // retargets the pointerup to the container — unlike the connector
  // pick's release, the drag's commit stands off the target).
  const beginEndpointDrag = (
    connectorId: string,
    which: "start" | "end",
    pointerId: number,
    clientX: number,
    clientY: number
  ) => {
    const container = containerRef.current;
    if (container === null) return;
    container.setPointerCapture?.(pointerId);
    const rect = container.getBoundingClientRect();
    viewport.beginConnectorEndpoint(
      connectorId,
      which,
      {
        x: clientX - rect.left - rect.width / 2,
        y: clientY - rect.top - rect.height / 2,
      },
      clientX,
      clientY
    );
  };

  // The editing surfaces keep the pointer: the canvas-text inners and the
  // page miniature's content (the caret / the text selection).

  const isChrome = (target: EventTarget | null) =>
    target instanceof Element && target.closest('[data-slot="docblocks/canvas-chrome"]') !== null;

  // The page miniature's content keeps the pointer too (no marquee/pen from
  // the page: the page blocks are not canvas items).
  const isPageCard = (target: EventTarget | null) =>
    target instanceof Element && target.closest('[data-slot="docblocks/page-card"]') !== null;

  // The stand target under the cursor (the connector tool's press / release):
  // the canvas item — EXCEPT the connector's own wrapper (a press on the
  // line's hit band stands no stand on the line: the connector carries no
  // box — the band is the line's hit aid, and the stand falls to the port /
  // the free stand under the band, the pre-wrapper contract).
  const standItemAt = (target: EventTarget | null): HTMLElement | null => {
    const item = target instanceof Element ? target.closest<HTMLElement>('[data-slot="docblocks/canvas-item"]') : null;
    if (item !== null && item.querySelector("[data-connector-hit]") !== null) return null;
    return item;
  };

  // The port-proximity pick (the connector's press / release): the canvas
  // point stands within the pick radius of a canvas item's PORT (the
  // edge strip falls to the page card / the background under the item —
  // the exact-edge press misses the item's fill). The port's shape stands
  // the block stand; the commit's snap stands the port itself.
  const portBlockAt = (point: { x: number; y: number }): string | null => {
    for (const { children } of surfaces) {
      for (const childId of children) {
        const block = blocks[childId];
        if (block === undefined || block.type === "connector") continue;
        const ports = portsOf(effectiveGeometry(block));
        if (
          (Object.keys(ports) as ("north" | "east" | "south" | "west")[]).some(
            (port) => Math.hypot(ports[port].x - point.x, ports[port].y - point.y) <= PORT_PICK_RADIUS_PX
          )
        ) {
          return childId;
        }
      }
    }
    return null;
  };

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
      if (isPlaceTool(tool)) {
        // The shape's drag-to-size: the press starts the session (no
        // commit yet), the drag stands the preview (the marquee's
        // gesture), the release commits the dragged size (a click stands
        // the default-size place).
        const start = screenToCanvas(point, viewport.zoom, viewport.pan);
        sessionRef.current = {
          kind: "place",
          tool,
          start,
          startClientX: event.clientX,
          startClientY: event.clientY,
          lastPoint: start,
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
      // The connector's endpoint stands: a press on an item stands the
      // block stand (the two-click's first pick; the press-drag's press
      // on a block), a press off the items stands the FREE stand (the
      // empty-canvas press — the press point is the first endpoint, the
      // release commits). A press with a stand already standing cancels
      // (the second stand commits on the release / the second click).
      const item = standItemAt(event.target);
      const id = item?.getAttribute("data-block-id") ?? null;
      const hasStand = viewport.pendingConnector !== null || viewport.pendingFree !== null;
      const canvasPoint = screenToCanvas(point, viewport.zoom, viewport.pan);
      const standId = id ?? portBlockAt(canvasPoint);
      connectorPressClientRef.current = { x: event.clientX, y: event.clientY };
      if (standId !== null && standId !== viewport.pendingConnector && standId !== viewport.pendingSource) {
        if (!hasStand) {
          // The press's edge snap: the
          // stand stands the pressed point — the port ref at the port's
          // stick disk, the free point over the continuous edge (the
          // frozen direction = the snapped side), the plain block ref
          // over the interior (the auto anchor). The source stands the
          // self-pair guard (the stand's own block's second press
          // cancels, not commits a degenerate line).
          viewport.setPendingStand({ ...connectorPressStand(doc, standId, canvasPoint), source: standId }, canvasPoint);
        } else {
          // The second click on a different item: the completion.
          viewport.onConnectorCommit({ blockId: standId }, canvasPoint);
        }
      } else if (standId === null) {
        if (!hasStand) {
          viewport.setPendingStand({ free: canvasPoint }, canvasPoint);
        } else {
          // A plain click off the items cancels the stand (the
          // press-drag's release commits the free end instead — the
          // pointerup path keeps the stand open).
          viewport.setPendingStand(null);
          viewport.setActiveTool(null);
          viewport.setConnectorPreview(null);
          connectorPressClientRef.current = null;
          return;
        }
      } else {
        // The same block's second press: the cancel.
        viewport.setPendingStand(null);
        viewport.setActiveTool(null);
        viewport.setConnectorPreview(null);
        connectorPressClientRef.current = null;
        return;
      }
      viewport.setConnectorPreview({ point: canvasPoint, snap: snapAnySurfaceEdge(doc, canvasPoint) });
      // No pointer capture: the two-click's second pick and the
      // press-drag's release read the release TARGET (the item under the
      // cursor) — a capture would retarget the pointerup to the container
      // and the release would stand off the items.
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

    // The resize handles (the single-selection overlay): the
    // press starts the session (the pan mode / the held space stand
    // before this — space+drag over a handle pans).
    const handle =
      event.target instanceof Element
        ? (event.target.closest<HTMLElement>('[data-slot="docblocks/canvas-handle"]') ?? null)
        : null;
    if (handle !== null && handleTarget !== null) {
      // The press is prevented (the same contract as the pan / page-card
      // branches): the compatibility mousedown's default stands no caret /
      // native text selection — the resize drag over the shape's
      // text overlay (or the page card's editable content under the item)
      // stands no selection. The focus parks on the container (the
      // preventDefault drops the default focus change — the keydown reach
      // stands).
      event.preventDefault();
      containerRef.current?.focus();
      const resizeHandle = handle.dataset.handle as ResizeHandle | undefined;
      if (resizeHandle !== undefined) viewport.beginResize(handleTarget.id, resizeHandle, event.clientX, event.clientY);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }

    // The connector's hit path (the wide transparent stroke): the press
    // stands the line's press, not the item's — the line stands inside the
    // connector's own canvas-item wrapper (the z-order's paint stand), so
    // the hit check stands BEFORE the item's (a capture-less select: the
    // connectors carry no geometry — the line follows the endpoint blocks,
    // and the capture-less press keeps the line's double-click on the hit
    // path — the label's inline edit's entry).
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
        // The press is prevented (the same contract as the pan / page-card /
        // handle branches): the move drag over the page card's editable
        // content under the pointer stands no native text selection; the
        // focus parks on the container.
        event.preventDefault();
        containerRef.current?.focus();
        viewport.beginMove(ids, event.clientX, event.clientY);
        event.currentTarget.setPointerCapture?.(event.pointerId);
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

    // The container's EMPTY-interior press:
    // a press that lands on no figure / handle / connector (the branches
    // above caught those) but INSIDE a container's box stands the container
    // (the INNERMOST — the smallest box standing the point, the nesting's
    // deepest) + the move session (the drag moves the container, the
    // border's contract). A press ON a figure still stands the figure (the
    // item's branch) — the interior is pointer-transparent. The marquee
    // stands only off the containers.
    const canvasPoint = screenToCanvas(point, viewport.zoom, viewport.pan);
    const surfaceOrder = doc.getChildren(doc.meta.id);
    let innermost: { id: string; area: number } | null = null;
    for (const surfaceId of surfaceOrder) {
      const surface = doc.getBlock(surfaceId);
      if (surface === null || surface.type !== "surface") continue;
      for (const childId of doc.getChildren(surfaceId)) {
        const block = doc.getBlock(childId);
        if (block === null || block.type !== "group") continue;
        const box = effectiveGeometry(block);
        if (
          canvasPoint.x >= box.x - box.w / 2 &&
          canvasPoint.x <= box.x + box.w / 2 &&
          canvasPoint.y >= box.y - box.h / 2 &&
          canvasPoint.y <= box.y + box.h / 2
        ) {
          const area = box.w * box.h;
          if (innermost === null || area < innermost.area) innermost = { id: childId, area };
        }
      }
    }
    const containerId = innermost?.id ?? null;
    if (containerId !== null) {
      if (event.shiftKey) {
        containerRef.current?.focus();
        if (selection.view !== null) toggleCanvasSelection(selection.view, containerId);
        return;
      }
      event.preventDefault();
      containerRef.current?.focus();
      selection.view?.set({ kind: "blocks", ids: [containerId], anchorId: containerId });
      viewport.beginMove([containerId], event.clientX, event.clientY);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }

    sessionRef.current = { kind: "marquee", additive: event.shiftKey };
    viewport.setMarquee({ start: point, end: point });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The pointer's stand for the paste's seat (any tool / the drag's
    // capture — the position is the cursor's, always current).
    lastPointerRef.current = centerRelativePoint(event);
    // The connector's pending preview: the dashed line follows the cursor
    // (the hover of the two-click pick and the press-drag draw — the
    // button-less hover update runs before the buttons guard below). The
    // end stands the endpoint drag's snap (the stick to the port / the
    // continuous edge within the radius — the badge's parity); before the
    // stand the hover snap stands the press's stand point.
    if (viewport.activeTool === "connector") {
      const canvasPoint = screenToCanvas(centerRelativePoint(event), viewport.zoom, viewport.pan);
      const hasStand = viewport.pendingConnector !== null || viewport.pendingFree !== null;
      if (hasStand) {
        viewport.setConnectorPreview({ point: canvasPoint, snap: snapAnySurfaceEdge(doc, canvasPoint) });
      } else {
        viewport.setConnectorHoverSnap(snapAnySurfaceEdge(doc, canvasPoint));
      }
    }

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

    // The move / resize sessions (item / page-card / handle
    // press) run without a container session; the feeders are no-ops
    // while none is open. The connector endpoint drag feeds the live
    // re-draw (the preview point in the surface-local space).
    viewport.moveDrag(event.clientX, event.clientY);
    viewport.resizeDrag(event.clientX, event.clientY, event.shiftKey);
    if (viewport.connectorEndpoint !== null) {
      viewport.moveConnectorEndpoint(centerRelativePoint(event));
    }
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
      // marquee's math), the center anchor is the drag's midpoint; the shift
      // stands the 1:1 square (the live constraint — the release's commit
      // stands the same box, the preview's stand is the commit's stand).
      const current = screenToCanvas(point, viewport.zoom, viewport.pan);
      session.lastPoint = current;
      const box = placeDragBox(session.start, current, event.shiftKey);
      const isContainer = session.tool === "container";
      viewport.setPlacePreview({
        kind: isContainer ? "container" : "shape",
        variant: session.tool === "container" ? "rect" : session.tool,
        ...box,
      });
    } else if (session.kind === "pen") {
      session.points.push(screenToCanvas(point, viewport.zoom, viewport.pan));
      viewport.setPenPoints([...session.points]);
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    cardPressRef.current = false;

    // The connector endpoint's drag release: the commit (the port snap
    // or the free point; one updateBlock) or the no-op (a press-release
    // under the threshold).
    if (viewport.connectorEndpoint !== null) {
      viewport.endConnectorEndpoint(event.clientX, event.clientY);
      return;
    }

    // The connector's press-drag release: a release over an item stands
    // the second block stand (the port snap reads the release point), a
    // release on the empty canvas commits the FREE second endpoint for a
    // real drag (a sub-threshold press-release cancels the stand). The
    // two-click's second pick stands on the pointerdown instead.
    if (viewport.activeTool === "connector" && (viewport.pendingConnector !== null || viewport.pendingFree !== null)) {
      const canvasPoint = screenToCanvas(centerRelativePoint(event), viewport.zoom, viewport.pan);
      const item = standItemAt(event.target);
      const id = item?.getAttribute("data-block-id") ?? null;
      const standId = id ?? portBlockAt(canvasPoint);
      if (standId !== null && standId !== viewport.pendingConnector && standId !== viewport.pendingSource) {
        viewport.onConnectorCommit({ blockId: standId }, canvasPoint);
      } else if (standId === null) {
        const press = connectorPressClientRef.current;
        const dragged =
          press !== null && Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_THRESHOLD_PX;
        if (dragged) {
          viewport.onConnectorCommit({ free: canvasPoint }, canvasPoint);
        } else {
          viewport.setPendingStand(null);
          viewport.setActiveTool(null);
          viewport.setConnectorPreview(null);
        }
      }
      connectorPressClientRef.current = null;
      return;
    }

    viewport.endMove();
    viewport.endResize();
    const session = sessionRef.current;
    if (session === null) return;
    sessionRef.current = null;

    if (session.kind === "place") {
      // The release commits: a sub-threshold drag is the click place (the
      // default size), a real drag lands the dragged box at the drag's
      // midpoint (one transact, the tool resets, the preview drops); the
      // shift stands the same 1:1 box as the preview (the no-jump contract
      // — the preview's stand is the commit's stand).
      const current = screenToCanvas(centerRelativePoint(event), viewport.zoom, viewport.pan);
      if (Math.hypot(event.clientX - session.startClientX, event.clientY - session.startClientY) < MOVE_THRESHOLD_PX) {
        viewport.onPlace(session.start);
      } else {
        const box = placeDragBox(session.start, current, event.shiftKey);
        viewport.onPlaceSize(session.tool, { x: box.x, y: box.y }, { w: box.w, h: box.h });
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

  // The canvas content's double-click: the shape's text inline edit (the press's pointer
  // capture retargets the dblclick to THIS container — the event's target
  // is the container, not the shape — the shape stands the point's
  // element, the hit test through the world's transform) and the
  // connector's LABEL inline edit (the line's press keeps no capture —
  // the hit path is the dblclick's target; the page's inert surfaces
  // stand no container handler — the read-only stand there).
  const onContentDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // The line's double-click stands the label's edit (the hit path is
    // the target's element; a capture-retargeted event — the target IS
    // the container — falls to the point's element, the hit test through
    // the world's transform).
    const fromHit = event.target instanceof Element ? event.target.closest<SVGElement>("[data-connector-hit]") : null;
    if (fromHit !== null) {
      const id = fromHit.getAttribute("data-connector-hit");
      if (id !== null) viewport.setConnectorLabelEditing(id);
      return;
    }
    // The container's TITLE inline edit (the chip's double-click): the same
    // capture-retargeting stand as the shape's text — the press's pointer
    // capture retargets the dblclick to THIS container, so the chip is found
    // through the point's element (the group's id stands the inline-edit id).
    const groupTitleFromTarget =
      event.target instanceof Element ? event.target.closest<HTMLElement>("[data-slot='docblocks/group-title']") : null;
    let groupTitle = groupTitleFromTarget;
    if (groupTitle === null && typeof document.elementFromPoint === "function") {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      groupTitle =
        element instanceof Element ? element.closest<HTMLElement>("[data-slot='docblocks/group-title']") : null;
    }
    if (groupTitle !== null) {
      const groupId =
        groupTitle.closest<HTMLElement>("[data-slot='docblocks/canvas-item']")?.getAttribute("data-block-id") ?? null;
      if (groupId !== null) viewport.setShapeTextEditing(groupId);
      return;
    }
    // The page miniature's blank body (no block under the point): a
    // double-click stands no selection. The single-press select stands (the
    // move session's affordance), but the dblclick clears it — the empty
    // area stands nothing. The card's content keeps its contracts (the
    // two-click caret, the block's own gestures). The point's element stands
    // the capture-retargeting (the dblclick's target may be the container).
    if (typeof document.elementFromPoint === "function") {
      const dblElement = document.elementFromPoint(event.clientX, event.clientY);
      if (
        dblElement instanceof Element &&
        dblElement.closest('[data-slot="docblocks/page-card"]') !== null &&
        dblElement.closest('[data-slot="docblocks/block"]') === null
      ) {
        selection.view?.set({ kind: "none" });
        return;
      }
    }
    // A retargeted event stands the target's closest first (the bubbling
    // path); the capture-retargeted one (the target IS the container)
    // falls to the point's element (the hit test through the world's
    // transform).
    const fromTarget =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-slot='docblocks/shape-text-target']")
        : null;
    const element = fromTarget !== null ? fromTarget : document.elementFromPoint(event.clientX, event.clientY);
    const target = element instanceof Element ? element.closest("[data-slot='docblocks/shape-text-target']") : null;
    if (target === null) return;
    const id =
      target.closest<HTMLElement>("[data-slot='docblocks/canvas-item']")?.getAttribute("data-block-id") ?? null;
    if (id !== null) viewport.setShapeTextEditing(id);
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
      viewport.marquee === null &&
      viewport.penPoints.length === 0 &&
      viewport.placePreview === null &&
      viewport.connectorEndpoint === null
    ) {
      return;
    }
    sessionRef.current = null;
    viewport.setPlacePreview(null);
    viewport.cancelMove();
    viewport.cancelResize();
    viewport.cancelConnectorEndpoint();
    viewport.setMarquee(null);
    viewport.setPenPoints([]);
  };

  const onPointerCancel = () => {
    cardPressRef.current = false;
    dropCanvasSessions();
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onMouseDown,
    onPointerCancel,
    dropCanvasSessions,
    beginEndpointDrag,
    onContentDoubleClick,
  };
}

export { useCanvasSessions };
