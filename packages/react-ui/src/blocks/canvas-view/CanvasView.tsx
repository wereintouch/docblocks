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
 * intersecting canvas items; the focus parks on the canvas container so the
 * Delete/Backspace path reaches the selection) and click-selects a single
 * canvas item. The editing surfaces (the canvas-text inners, the page
 * miniature's content) keep their own pointer handling (the caret), and
 * the floating chrome (the zoom controls, the dock) handles its own.
 */
import { useStore } from "zustand";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../../EditorProvider";
import { CanvasDock } from "../../canvas/CanvasDock";
import { ConnectorToolbar } from "../../canvas/ConnectorToolbar";
import { ShapeToolbar } from "../../canvas/ShapeToolbar";
import { copyCanvasItems, pasteCanvasItems } from "../../canvas/clipboard";
import { dissolveGroup, findParentSurface, firstSurface, makeGroup } from "../../canvas/insert";
import { NUDGE_KEYS, nudgeDelta, nudgeGate, nudgeSelection } from "../../canvas/nudge";
import {
  MOVE_THRESHOLD_PX,
  canvasToScreen,
  marqueeRect,
  penStroke,
  rectsIntersect,
  screenToCanvas,
} from "../../canvas/viewport";
import type { ResizeHandle } from "../../canvas/viewport";
import { useCanvasViewport } from "../../canvas/viewport-state";
import {
  connectorPressStand,
  connectorPreviewFrom,
  connectorPreviewPoint,
  snapAnySurfaceEdge,
} from "../../canvas/viewport/utils";
import { useBlock } from "../../hooks";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { cn } from "../../shared/ui/cn";
import { Container, Link } from "../../shared/ui/icons";
import { BlockGroups } from "../BlockView";
import {
  CONNECTOR_SELECTED_STROKE,
  CONNECTOR_STROKE,
  CONNECT_COLOR,
  SNAP_BADGE_LIFT,
  SNAP_BADGE_RADIUS,
} from "../ConnectorLayer";
import { ShapeSvg } from "../ShapeSvg";
import { BlockContext, useBlockContextValue } from "../block-context";
import {
  PORT_NORMAL,
  connectorHandlePoints,
  connectorMidpoint,
  edgePointOf,
  effectiveGeometry,
  pageCardStyle,
  portsOf,
} from "../canvas-geometry";
import { CanvasTextEditProvider } from "../canvas-text-edit-context";
import { ConnectorLabelEdit } from "./ConnectorLabelEdit";
import { ConnectorPreviewLine } from "./ConnectorPreviewLine";
import { SurfaceLayer } from "./SurfaceLayer";
import { ZoomControls } from "./ZoomControls";
import {
  CONNECTOR_HANDLE_HIT_RADIUS_PX,
  CONNECTOR_HANDLE_RADIUS_PX,
  PORT_PICK_RADIUS_PX,
  RESIZE_HANDLE_POSITIONS,
  SCROLLBAR_GUARD_PX,
  TOOLBAR_OFFSET_PX,
  WHEEL_ZOOM_DELTA,
  isPlaceTool,
  wheelGesture,
  wheelPanDeltas,
} from "./models";
import type { CanvasSession } from "./models";
import { toggleCanvasSelection } from "./utils";

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
  // The connector's press point (screen px): the press-drag's release
  // threshold (a sub-threshold press-release cancels the stand instead of
  // committing the free end).
  const connectorPressClientRef = useRef<{ x: number; y: number } | null>(null);
  // The last pointer position (the container-center-relative screen px):
  // the paste's seat point (the copy's union center lands at the pointer
  // — the world position stands the conversion at the paste's own
  // zoom / pan, the viewport center over no pointer).
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  // The wheel's delta accumulator (the zoom step crosses the threshold —
  // the remainder stands over to the next event, the trackpad's
  // momentum feel).
  const wheelDeltaRef = useRef(0);
  const [spacePan, setSpacePan] = useState(false);

  // The wheel's gesture: the pointer
  // mode pans (the 1:1 screen px, zoom-blind; the content stands opposite
  // to the wheel's delta, the shift's horizontal axis), the hand mode and
  // the active tools zoom at the cursor (the point under the pointer
  // stands fixed), and the pinch (ctrl/cmd) zooms everywhere — the
  // CONTINUOUS stand (the zoom scales by the delta, the smooth reaction,
  // no step threshold). The native non-passive listener (React's onWheel
  // is passive at the root — the preventDefault would not stand) keeps
  // the page from scrolling. The step zoom's delta accumulates to the
  // threshold (the mouse's notch, the trackpad's small events).
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const onWheel = (event: WheelEvent) => {
      if (
        wheelGesture(viewport.mode, viewport.activeTool, {
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        }) === "zoom"
      ) {
        const rect = container.getBoundingClientRect();
        const point = {
          x: event.clientX - (rect.left + rect.width / 2),
          y: event.clientY - (rect.top + rect.height / 2),
        };
        // The pinch: the continuous zoom (the smooth stand — the discrete
        // step's threshold stood the jerk).
        if (event.ctrlKey || event.metaKey) {
          viewport.pinchAt(point, event.deltaY);
          event.preventDefault();
          return;
        }
        wheelDeltaRef.current += event.deltaY;
        if (Math.abs(wheelDeltaRef.current) < WHEEL_ZOOM_DELTA) {
          event.preventDefault();
          return;
        }
        const direction = wheelDeltaRef.current > 0 ? -1 : 1;
        wheelDeltaRef.current = 0;
        viewport.zoomAt(point, direction);
        event.preventDefault();
        return;
      }
      const deltas = wheelPanDeltas(event.deltaX, event.deltaY, event.shiftKey);
      if (deltas.dx === 0 && deltas.dy === 0) return;
      viewport.setPan({ x: viewport.pan.x + deltas.dx, y: viewport.pan.y + deltas.dy });
      event.preventDefault();
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [viewport.activeTool, viewport.mode, viewport.pan, viewport.pinchAt, viewport.setPan, viewport.zoomAt]);

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
  // excluded — it carries no own geometry). The container (the reworked
  // group) carries its own box: the eight resize handles stand it.
  const handleTarget = useMemo(() => {
    if (storeSelection?.kind !== "blocks" || storeSelection.ids.length !== 1) return null;
    const id = storeSelection.ids[0]!;
    const block = blocks[id];
    if (block === undefined || block.type === "connector") return null;
    return { id, box: effectiveGeometry(block) };
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
      // The container (the reworked group) stands its OWN geometry (the
      // free box) — the derived union stands off.
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

  // The color toolbar's target: a single `shape` selection (the fill /
  // stroke attrs); absent for the other canvas types, the multi
  // selection, an active tool, or an in-flight session.
  const shapeToolbarTarget = (() => {
    if (handleTarget === null || viewport.activeTool !== null) return null;
    if (viewport.movePreview !== null || viewport.resizePreview !== null) return null;
    const block = blocks[handleTarget.id];
    if (block === undefined || block.type !== "shape") return null;
    return {
      id: handleTarget.id,
      fill: block.attrs?.fill,
      stroke: block.attrs?.stroke,
      strokeWidth: block.attrs?.strokeWidth,
      strokeStyle: block.attrs?.strokeStyle,
      variant: block.attrs?.variant,
      text: block.attrs?.text,
      fontSize: block.attrs?.fontSize,
      fontFamily: block.attrs?.fontFamily,
      textColor: block.attrs?.textColor,
      textStyle: block.attrs?.textStyle,
      textAlign: block.attrs?.textAlign,
    };
  })();

  // The connector type toolbar's target: a single `connector` selection
  // whose endpoints resolve within the surface (the toolbar seats at the
  // line's midpoint; absent for the multi selection, an active tool, or
  // an in-flight session).
  const connectorToolbarTarget = (() => {
    if (viewport.activeTool !== null) return null;
    if (viewport.movePreview !== null || viewport.resizePreview !== null) return null;
    if (storeSelection?.kind !== "blocks" || storeSelection.ids.length !== 1) return null;
    const id = storeSelection.ids[0]!;
    const block = blocks[id];
    if (block === undefined || block.type !== "connector" || block.attrs === undefined) return null;
    const surface = surfaces.find((entry) => entry.children.includes(id));
    if (surface === undefined) return null;
    const childIds = surface.children;
    const mid = connectorMidpoint(block, childIds, blocks);
    if (mid === null) return null;
    return {
      id,
      variant: block.attrs.variant,
      strokeColor: block.attrs.strokeColor,
      strokeWidth: block.attrs.strokeWidth,
      arrowHead: block.attrs.arrowHead,
      arrowStart: block.attrs.arrowStart,
      mid,
      childIds,
    };
  })();

  // The label's inline edit's target: the
  // double-click's connector whose endpoints resolve (the input seats at
  // the line's midpoint, the frame stands the line's effective stroke).
  const connectorLabelTarget = (() => {
    const id = viewport.connectorLabelEditing;
    if (id === null) return null;
    const block = blocks[id];
    if (block === undefined || block.type !== "connector" || block.attrs === undefined) return null;
    const surface = surfaces.find((entry) => entry.children.includes(id));
    if (surface === undefined) return null;
    const mid = connectorMidpoint(block, surface.children, blocks);
    if (mid === null) return null;
    const selected = storeSelection?.kind === "blocks" && storeSelection.ids.includes(id);
    const stroke = selected
      ? CONNECTOR_SELECTED_STROKE
      : block.attrs.strokeColor === undefined || block.attrs.strokeColor === "none"
        ? CONNECTOR_STROKE
        : block.attrs.strokeColor;
    return { id, mid, stroke, label: block.attrs.label ?? "" };
  })();

  // The selected line's endpoint handles' points (the screen-space
  // overlay's data — the same resolution as the line's render, the live
  // preview / the snap's stand while the endpoint drag is in flight).
  const selectedConnectorHandles =
    connectorToolbarTarget !== null
      ? connectorHandlePoints(connectorToolbarTarget.childIds, blocks, connectorToolbarTarget.id, {
          movePreview: viewport.movePreview,
          resizePreview: viewport.resizePreview,
          endpointDrag: viewport.connectorEndpoint,
          endpointPreview: viewport.connectorEndpointPreview,
        })
      : null;

  // The pending connector's preview stand points (the world space, so
  // they scale with the zoom): the FROM over the pending stand (the
  // port's point over the port stand, the auto anchor over the plain
  // block ref —; the free stand stands its
  // own point), the END over the cursor's snap (the endpoint drag's
  // parity — the stick to the port / the continuous edge within the
  // radius).
  const previewStandBlock = viewport.pendingConnector !== null ? blocks[viewport.pendingConnector] : undefined;
  const previewFrom =
    viewport.connectorPreview === null || (viewport.pendingConnector === null && viewport.pendingFree === null)
      ? null
      : viewport.pendingFree !== null
        ? viewport.pendingFree
        : connectorPreviewFrom(
            previewStandBlock === undefined ? null : effectiveGeometry(previewStandBlock),
            viewport.pendingPort,
            viewport.connectorPreview.point
          );
  const previewSnap = viewport.connectorPreview?.snap ?? null;
  const previewSnapBlock = previewSnap !== null ? blocks[previewSnap.blockId] : undefined;
  const previewEnd =
    viewport.connectorPreview === null
      ? null
      : connectorPreviewPoint(
          viewport.connectorPreview.point,
          previewSnap,
          previewSnapBlock === undefined ? null : effectiveGeometry(previewSnapBlock)
        );
  // The hover snap's stand point (before the stand): the snapped edge's
  // point over the hovered sibling (the circle + the badge's anchor).
  const hoverSnapBlock = viewport.connectorHoverSnap !== null ? blocks[viewport.connectorHoverSnap.blockId] : undefined;
  const hoverSnapPoint =
    viewport.connectorHoverSnap === null || hoverSnapBlock === undefined
      ? null
      : edgePointOf(effectiveGeometry(hoverSnapBlock), viewport.connectorHoverSnap.port, viewport.connectorHoverSnap.t);

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
      const item =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-slot="docblocks/canvas-item"]')
          : null;
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
      // marquee's math), the center anchor is the drag's midpoint.
      const current = screenToCanvas(point, viewport.zoom, viewport.pan);
      const isContainer = session.tool === "container";
      viewport.setPlacePreview({
        kind: isContainer ? "container" : "shape",
        variant: session.tool === "container" ? "rect" : session.tool,
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
      const item =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-slot="docblocks/canvas-item"]')
          : null;
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

  // The canvas content's double-click (the /

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

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // The same DOM-containment rule as the pointer handler: React's
    // synthetic events bubble through the fiber tree, so a key from a
    // portaled element (the shape toolbar's palette content, tabIndex
    // -1) reaches this handler with a target the container does not
    // contain — and would delete the selection (Delete / Backspace).
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    // The M key: the select mode (the mode's keyboard switch — the dock's
    // button icon shows the current mode, the hand is the pan). The app
    // level hotkey wins over the editing surfaces (the "m" stands no
    // character over the text); the live caret (the editing state) stands
    // the view — the focus parks on the container (the undo hotkey reach).
    if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.isContentEditable) {
        window.getSelection()?.removeAllRanges();
        active.blur();
        containerRef.current?.focus();
      }
      viewport.setMode("default");
      return;
    }
    if (isEditingSurface(event.target)) return;
    // The group's hotkeys: Ctrl/Cmd+G
    // groups the multi selection (one transact — the makeGroup's null is
    // the no-op: the ineligible selection stands nothing),
    // Ctrl/Cmd+Shift+G dissolves the selected group (the members stand
    // where they are). The app-level hotkeys win over the editing surfaces
    // (the isEditingSurface guard above keeps the text's own shortcuts).
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
      const sel = selection.view?.get();
      if (sel?.kind !== "blocks") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        if (sel.ids.length !== 1) return;
        const id = sel.ids[0]!;
        if (dissolveGroup(doc, id)) selection.view?.set({ kind: "none" });
        return;
      }
      if (sel.ids.length < 2) return;
      const created = makeGroup(doc, sel.ids);
      if (created !== null) {
        // The group stands alone selected (its outline takes over the
        // selection's affordance; the members' selection stands no
        // summary box over the outline).
        selection.view?.set({ kind: "blocks", ids: [created], anchorId: created });
      }
      return;
    }
    // The canvas clipboard's hotkeys:
    // Ctrl/Cmd+C copies the selection's canvas items (the selection
    // stands — the copy clears nothing), Ctrl/Cmd+V pastes at the pointer
    // (the selection seats on the pasted; the snapshot stands the
    // undo/redo's selection contract). The app-level hotkeys win over the
    // editing surfaces (the isEditingSurface guard above keeps the
    // text's own copy / paste).
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
      const modKey = event.key.toLowerCase();
      if (modKey === "c") {
        const sel = selection.view?.get();
        if (sel?.kind !== "blocks" || sel.ids.length === 0) return;
        const clipboard = copyCanvasItems(doc, sel.ids);
        if (clipboard === null) return; // the non-copiable selection stands nothing
        event.preventDefault();
        event.stopPropagation();
        store.getState().setCanvasClipboard(clipboard);
        return;
      }
      if (modKey === "v") {
        const clipboard = store.getState().canvasClipboard;
        if (clipboard === null) return;
        const sel = selection.view?.get();
        event.preventDefault();
        event.stopPropagation();
        // The paste's target surface: the selection's first item's
        // surface, the doc's first surface over no canvas selection (the
        // paste stands the canvas even over the page's selection). The
        // surface-less stand creates the surface in its own transact (a
        // reachable only when every surface was removed between the copy
        // and the paste — the copy implies a surface stood).
        const surface = sel?.kind === "blocks" && sel.ids.length > 0 ? findParentSurface(doc, sel.ids[0]!) : null;
        const target = surface !== null ? surface : firstSurface(doc);
        // The pointer's world position (the last pointer's stand over the
        // paste's own zoom / pan; the viewport center over no pointer).
        const pointer = lastPointerRef.current ?? { x: 0, y: 0 };
        const center = screenToCanvas(pointer, viewport.zoom, viewport.pan);
        const pasted = pasteCanvasItems(doc, clipboard, target, center);
        if (pasted !== null && pasted.length > 0) {
          // The paste seats the selection on the pasted : the core's SelectionView restores the selection
          // over the undo / redo (each captured edit snapshots the selection
          // it started from — the paste's undo stands the previous
          // selection back, the redo re-seats the pasted).
          selection.view?.set({ kind: "blocks", ids: pasted, anchorId: pasted[0]! });
          containerRef.current?.focus();
        }
        return;
      }
    }
    // The arrow-key nudge: over the
    // canvas's blocks selection and no in-flight gesture — each press is
    // a real move (one setGeometry per item in one transact: one undo
    // step, one wire update; the selection stands on the same items).
    // The key stands over the container's own focus only (the hotkey's
    // context — the selection's hotkeys park there): the view's own
    // controls (the toolbar's width selector, the dock, the zoom) keep
    // their own arrows. The in-flight gestures own the keys (the move /
    // resize sessions, the pan / marquee / pen / placement, the endpoint
    // drag, the tool's pick); the page view and the editing surfaces keep
    // their own arrows (the isEditingSurface guard above). The key stands
    // swallowed — the page never scrolls over the arrows.
    if (
      (NUDGE_KEYS as readonly string[]).includes(event.key) &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      event.target === event.currentTarget
    ) {
      const sel = selection.view?.get();
      if (sel?.kind !== "blocks" || sel.ids.length === 0) return;
      if (
        nudgeGate(
          {
            move: viewport.moveSession,
            resize: viewport.resizeSession,
            pan: sessionRef.current !== null,
            endpoint: viewport.connectorEndpoint !== null,
            marquee: viewport.marquee !== null,
            pen: viewport.penPoints.length > 0,
            place: viewport.placePreview !== null,
            tool: viewport.activeTool !== null,
            pending: viewport.pendingConnector !== null || viewport.pendingFree !== null,
          },
          sel
        )
      ) {
        const delta = nudgeDelta(event.key, event.shiftKey);
        if (delta !== null) {
          event.preventDefault();
          event.stopPropagation();
          nudgeSelection(doc, sel.ids, delta.dx, delta.dy);
        }
        return;
      }
    }
    // The canvas items' delete (the page's removeBlocksSelection path
    // stands the root's page sequence — the canvas items are not in it).
    // A mixed selection bubbles to the editor root's handler.
    if ((event.key === "Delete" || event.key === "Backspace") && deleteCanvasSelection()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      event.key === "Escape" &&
      (viewport.activeTool !== null || viewport.pendingConnector !== null || viewport.pendingFree !== null)
    ) {
      // The canvas tools' cancel (the page's Escape clears the selection —
      // the tool cancels first, the selection stands).
      event.stopPropagation();
      viewport.setActiveTool(null);
      viewport.setPendingStand(null);
      viewport.setPenPoints([]);
      viewport.setPlacePreview(null);
      viewport.setConnectorPreview(null);
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
    if (event.key === "Escape" && viewport.connectorEndpoint !== null) {
      // The in-flight endpoint drag's cancel (the same contract as the
      // move's: the preview is dropped, nothing is written).
      event.stopPropagation();
      viewport.cancelConnectorEndpoint();
      return;
    }
    if (event.key === "Escape" && viewport.resizePreview !== null) {
      // The in-flight resize's cancel (the same contract as the
      // move's: the preview is dropped, nothing is written).
      event.stopPropagation();
      viewport.cancelResize();
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
  // previews: the move offset, the resize box — the same composition as
  // the CanvasItem's).
  const pageCardDisplayStyle = (() => {
    const style = pageCardStyle(root);
    if (handleTarget === null || handleTarget.id !== rootBlockId) return style;
    const isMoving = viewport.movePreview !== null && viewport.movePreview.ids.includes(rootBlockId);
    const previewBox =
      viewport.resizePreview !== null && viewport.resizePreview.id === rootBlockId ? viewport.resizePreview.box : null;
    if (isMoving === false && previewBox === null) return style;
    if (previewBox !== null) {
      style.left = `calc(50% + ${previewBox.x}px)`;
      style.top = `calc(50% + ${previewBox.y}px)`;
      style.width = `${previewBox.w}px`;
      style.height = `${previewBox.h}px`;
    }
    const parts = ["translate(-50%, -50%)"];
    if (isMoving) parts.push(`translate(${viewport.movePreview!.dx}px, ${viewport.movePreview!.dy}px)`);
    style.transform = parts.join(" ");
    return style;
  })();

  return (
    <CanvasTextEditProvider editingId={viewport.shapeTextEditing} setEditingId={viewport.setShapeTextEditing}>
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
        onDoubleClick={onContentDoubleClick}
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
              endpointDrag={viewport.connectorEndpoint}
              endpointPreview={viewport.connectorEndpointPreview}
              endpointSnap={
                viewport.connectorEndpoint !== null
                  ? (viewport.connectorEndpointPreview?.snap ?? null)
                  : viewport.activeTool === "connector"
                    ? (viewport.connectorHoverSnap ?? viewport.connectorPreview?.snap ?? null)
                    : null
              }
              showPorts={viewport.activeTool === "connector" || viewport.connectorEndpoint !== null}
              labelEditing={viewport.connectorLabelEditing}
            />
          ))}
          {connectorLabelTarget !== null && (
            // The label's inline edit: the
            // input at the line's midpoint (the world's space, so it
            // scales with the zoom — the line's parity). The world stands
            // it over the surface's layers (the line's text stands off
            // while the edit stands the draft).
            <ConnectorLabelEdit
              id={connectorLabelTarget.id}
              mid={connectorLabelTarget.mid}
              stroke={connectorLabelTarget.stroke}
              label={connectorLabelTarget.label}
              onClose={() => viewport.setConnectorLabelEditing(null)}
            />
          )}
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
              {viewport.placePreview.kind === "container" ? (
                <div
                  className="h-full w-full rounded-(--docblocks-radius) border-2 border-dashed"
                  style={{ borderColor: "currentColor" }}
                />
              ) : (
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
              )}
            </div>
          )}
          {(viewport.pendingConnector !== null || viewport.pendingFree !== null) &&
            previewFrom !== null &&
            previewEnd !== null && (
              // The connector's pending preview line: the dashed segment
              // from the pending stand (the snapped press point, or the
              // auto anchor over the plain block ref) to the cursor's snap
              // (the endpoint drag's parity) (the world's space, so it
              // scales with the zoom).
              <ConnectorPreviewLine id={viewport.pendingConnector ?? undefined} from={previewFrom} point={previewEnd} />
            )}
          {previewFrom !== null && previewEnd !== null && previewSnap !== null && (
            // The preview end's snap: the circle + the connect badge at
            // the snapped edge point (the endpoint drag's parity).
            <ConnectorSnapBadge
              slot="docblocks/canvas-connector-preview-snap"
              point={previewEnd}
              port={previewSnap.port}
            />
          )}
          {viewport.activeTool === "connector" &&
            previewFrom === null &&
            viewport.connectorHoverSnap !== null &&
            hoverSnapPoint !== null && (
              // The hover snap (before the stand): the circle + the connect
              // badge at the snapped edge point — the press's stand
              // preview (the line stands from that point on the press).
              <ConnectorSnapBadge
                slot="docblocks/canvas-connector-hover-snap"
                point={hoverSnapPoint}
                port={viewport.connectorHoverSnap.port}
              />
            )}
          {viewport.penPoints.length > 1 && (
            <svg
              data-slot="docblocks/canvas-pen-preview"
              className="pointer-events-none absolute top-1/2 left-1/2 overflow-visible"
              width={1}
              height={1}
            >
              <path
                d={viewport.penPoints
                  .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
                  .join(" ")}
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
        {viewport.dropIndicators !== null &&
          viewport.dropIndicators.map((indicator) => {
            const figure = blocks[indicator.id];
            if (figure === undefined) return null;
            const base = effectiveGeometry(figure);
            const mv = viewport.movePreview;
            // The icon stands above the figure's live top edge (the move
            // preview's delta, the screen space — the on-screen size stands
            // at any zoom).
            const screen = canvasToScreen(
              { x: base.x + (mv?.dx ?? 0), y: base.y + (mv?.dy ?? 0) - base.h / 2 - 14 },
              viewport.zoom,
              viewport.pan
            );
            const isOut = indicator.kind === "out";
            return (
              <div
                key={`${indicator.id}-${indicator.containerId}`}
                data-slot="docblocks/canvas-drop-indicator"
                data-drop={indicator.kind}
                className="
                  pointer-events-none absolute z-40 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center
                  justify-center rounded-full
                "
                style={{
                  left: `calc(50% + ${screen.x}px)`,
                  top: `calc(50% + ${screen.y}px)`,
                  background: isOut ? "var(--destructive, #ef4444)" : "var(--docblocks-canvas-connect-color, #16a34a)",
                  color: "var(--docblocks-page-card-background, #ffffff)",
                }}
              >
                <Container className="size-4" />
              </div>
            );
          })}
        {handleTarget !== null &&
          viewport.activeTool === null &&
          viewport.movePreview === null &&
          displayBox !== null && (
            // The selection's handles (the eight box handles):
            // screen-space, over the world (they keep their on-screen size
            // at any zoom). Hidden while a move preview is in flight (the
            // box is stale then).
            <div
              data-slot="docblocks/canvas-handles"
              className="pointer-events-none absolute z-40"
              style={{
                left: `calc(50% + ${canvasToScreen({ x: displayBox.x, y: displayBox.y }, viewport.zoom, viewport.pan).x}px)`,
                top: `calc(50% + ${canvasToScreen({ x: displayBox.x, y: displayBox.y }, viewport.zoom, viewport.pan).y}px)`,
                width: displayBox.w * viewport.zoom,
                height: displayBox.h * viewport.zoom,
                transform: "translate(-50%, -50%)",
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
            </div>
          )}
        {connectorToolbarTarget !== null && (
          // The connector's type toolbar (the single `connector`
          // selection): the three line types above the line's midpoint.
          <ConnectorToolbar
            id={connectorToolbarTarget.id}
            variant={connectorToolbarTarget.variant}
            strokeColor={connectorToolbarTarget.strokeColor}
            strokeWidth={connectorToolbarTarget.strokeWidth}
            arrowHead={connectorToolbarTarget.arrowHead}
            arrowStart={connectorToolbarTarget.arrowStart}
            style={{
              left: `calc(50% + ${canvasToScreen(connectorToolbarTarget.mid, viewport.zoom, viewport.pan).x}px)`,
              top: `calc(50% + ${canvasToScreen(connectorToolbarTarget.mid, viewport.zoom, viewport.pan).y - TOOLBAR_OFFSET_PX}px)`,
            }}
          />
        )}
        {selectedConnectorHandles !== null && connectorToolbarTarget !== null && (
          // The selected line's endpoint handles (the screen-space overlay
          // over the chrome, above the floating toolbars — a wide toolbar
          // stands no press on the line's endpoints). The invisible wider
          // hit circle stands the pointerdown; the visible circle stands
          // the selection's cyan (the handles stand only over the
          // selected line).
          <div data-slot="docblocks/connector-handles" className="pointer-events-none absolute inset-0 z-50">
            {(["start", "end"] as const).map((which) => {
              const point = canvasToScreen(selectedConnectorHandles[which], viewport.zoom, viewport.pan);
              return (
                <svg
                  key={which}
                  data-connector-endpoint={which}
                  data-connector-endpoint-id={connectorToolbarTarget.id}
                  width={CONNECTOR_HANDLE_HIT_RADIUS_PX * 2}
                  height={CONNECTOR_HANDLE_HIT_RADIUS_PX * 2}
                  style={{
                    position: "absolute",
                    left: `calc(50% + ${point.x}px - ${CONNECTOR_HANDLE_HIT_RADIUS_PX}px)`,
                    top: `calc(50% + ${point.y}px - ${CONNECTOR_HANDLE_HIT_RADIUS_PX}px)`,
                  }}
                >
                  <circle
                    cx={CONNECTOR_HANDLE_HIT_RADIUS_PX}
                    cy={CONNECTOR_HANDLE_HIT_RADIUS_PX}
                    r={CONNECTOR_HANDLE_HIT_RADIUS_PX}
                    fill="transparent"
                    pointerEvents="all"
                    style={{ cursor: "grab" }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      beginEndpointDrag(
                        connectorToolbarTarget.id,
                        which,
                        event.pointerId,
                        event.clientX,
                        event.clientY
                      );
                    }}
                  />
                  <circle
                    cx={CONNECTOR_HANDLE_HIT_RADIUS_PX}
                    cy={CONNECTOR_HANDLE_HIT_RADIUS_PX}
                    r={CONNECTOR_HANDLE_RADIUS_PX}
                    fill="var(--docblocks-canvas-surface-background, var(--card, #ffffff))"
                    strokeWidth={1.5}
                    pointerEvents="none"
                    style={{ stroke: "var(--docblocks-canvas-selected-stroke)" }}
                  />
                </svg>
              );
            })}
          </div>
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
            strokeWidth={shapeToolbarTarget.strokeWidth}
            strokeStyle={shapeToolbarTarget.strokeStyle}
            variant={shapeToolbarTarget.variant}
            text={shapeToolbarTarget.text}
            fontSize={shapeToolbarTarget.fontSize}
            fontFamily={shapeToolbarTarget.fontFamily}
            textColor={shapeToolbarTarget.textColor}
            textStyle={shapeToolbarTarget.textStyle}
            textAlign={shapeToolbarTarget.textAlign}
            style={{
              left: `calc(50% + ${canvasToScreen({ x: displayBox.x, y: displayBox.y }, viewport.zoom, viewport.pan).x}px)`,
              top: `calc(50% + ${canvasToScreen({ x: displayBox.x, y: displayBox.y }, viewport.zoom, viewport.pan).y - (displayBox.h / 2) * viewport.zoom - TOOLBAR_OFFSET_PX}px)`,
            }}
          />
        )}
        <ZoomControls zoom={viewport.zoom} onStep={viewport.stepZoom} onReset={() => viewport.setZoom(1)} />
        <CanvasDock viewport={viewport} />
      </div>
    </CanvasTextEditProvider>
  );
}

/**
 * The connector snap's stand (the hover snap and the preview end's snap —
 * the endpoint drag's parity): the green circle at the snapped edge point
 * (the dot's stand) + the Link badge outside along the port's outward
 * normal (the "the point is connected" indicator, the endpoint drag's
 * badge's parity). A world-space overlay (the 1x1 overflow-visible svg —
 * the ConnectorLayer's parity), so it scales with the zoom.
 */
function ConnectorSnapBadge({
  slot,
  point,
  port,
}: {
  slot: string;
  point: { x: number; y: number };
  port: "north" | "east" | "south" | "west";
}) {
  const normal = PORT_NORMAL[port];
  const badgeX = point.x + normal.nx * SNAP_BADGE_LIFT;
  const badgeY = point.y + normal.ny * SNAP_BADGE_LIFT;
  return (
    <svg
      data-slot={slot}
      className="pointer-events-none absolute top-1/2 left-1/2 overflow-visible"
      width={1}
      height={1}
    >
      <circle cx={point.x} cy={point.y} r={3.5} fill={CONNECT_COLOR} stroke={CONNECT_COLOR} strokeWidth={1} />
      <circle
        cx={badgeX}
        cy={badgeY}
        r={SNAP_BADGE_RADIUS}
        fill="var(--docblocks-canvas-surface-background, var(--card, #ffffff))"
        stroke={CONNECT_COLOR}
        strokeWidth={1.5}
      />
      <Link
        x={badgeX - 7}
        y={badgeY - 7}
        width={14}
        height={14}
        viewBox="0 0 24 24"
        fill="none"
        stroke={CONNECT_COLOR}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export { CanvasView };
