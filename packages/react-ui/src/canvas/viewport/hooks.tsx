/** The canvas viewport's owner hook: the zoom / pan / mode / tool state,
 *  the pending connector stand, and the placement / move / resize /
 *  endpoint-drag sessions over the doc. Pure view state per
 *  editor instance — it stands outside the doc and the awareness and
 *  resets on the canvas view's unmount. */
import { useCallback, useEffect, useRef, useState } from "react";

import type { Block, Doc } from "docblocks-core";

import { boxContains, effectiveGeometry, endpointPointOf, portOfNormal } from "../../blocks/canvas-geometry";
import type { CanvasPort } from "../../blocks/canvas-geometry";
import {
  findParentSurface,
  firstSurface,
  placeCanvasText,
  placeContainer,
  placeFrame,
  placePenStroke,
  placeShape,
} from "../insert";
import {
  TOOL_SIZES,
  marqueeRect,
  pinchZoom,
  resizeBox,
  screenDeltaToCanvas,
  screenToCanvas,
  stepZoom,
  unionBox,
} from "../viewport";
import type { Box, CanvasMode, CanvasPoint, CanvasTool, PenStroke, ResizeHandle, ScreenPoint } from "../viewport";
import { ENDPOINT_RELEASE_THRESHOLD_PX } from "./models";
import type {
  CanvasViewportState,
  DropIndicator,
  EndpointDrag,
  EndpointPreview,
  EndpointSession,
  EndpointSnap,
  MarqueeState,
  MovePreview,
  MoveSession,
  PlacePreview,
  ResizeSession,
} from "./models";
import { snapEdgePoint, snapEndpointEdge } from "./utils";
import { writeCanvasViewport, WRITE_DEBOUNCE_MS } from "./persistence";
import type { PersistedViewport } from "./persistence";

// The portT's commit rounding: the edge's fractional position stands at
// the 4-digit stand (0.0001 — sub-pixel on any sane edge at any zoom).
function roundPortT(t: number): number {
  return Number(t.toFixed(4));
}

/** The containers (the groups) of every surface, with their live box and
 * the stored members (the shared canvas space) — the drop's stand and the
 * release's membership commit share the one read. */
function containersOf(doc: Doc): { id: string; box: Box; members: string[] }[] {
  const containers: { id: string; box: Box; members: string[] }[] = [];
  for (const surfaceId of doc.getChildren(doc.meta.id)) {
    const surface = doc.getBlock(surfaceId);
    if (surface === null || surface.type !== "surface") continue;
    for (const childId of doc.getChildren(surfaceId)) {
      const child = doc.getBlock(childId);
      if (child === null || child.type !== "group") continue;
      containers.push({ id: childId, box: effectiveGeometry(child), members: child.attrs.members });
    }
  }
  return containers;
}

/**
 * The container's unit members — all the transitive members (a nested
 * container's members ride with the outer box, one delta). The connector
 * carries no box (never a member) and is skipped.
 */
function unitMembers(doc: Doc, groupId: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const block = doc.getBlock(id);
    if (block === null || block.type !== "group") return;
    for (const memberId of block.attrs.members) {
      const member = doc.getBlock(memberId);
      if (member === null || member.type === "connector") continue;
      result.push(memberId);
      if (member.type === "group") visit(memberId);
    }
  };
  visit(groupId);
  return result;
}

/**
 * The move's drop indicator: for each
 * dragged shape OR container, the container it joins (kind "in" — the
 * green icon, the fully-containing box it is not yet a member of) or the
 * container it leaves (kind "out" — the red icon, the member no longer
 * inside its own box). A member dragged into another container stands the
 * green stand of the new home (the release's commit moves it between the
 * two). A dragged container's unit members ride the box (no individual
 * indicator — the relative position is invariant).
 */
function computeDropIndicators(doc: Doc, ids: string[], dx: number, dy: number): DropIndicator[] {
  const containers = containersOf(doc);
  if (containers.length === 0) return [];
  // The dragged containers stand their own membership indicator (the box's
  // delta); their unit's members ride the box (no individual indicator).
  const draggedGroups = ids.filter((id) => doc.getBlock(id)?.type === "group");
  const riders = new Set<string>();
  for (const gid of draggedGroups) for (const mid of unitMembers(doc, gid)) riders.add(mid);
  const indicators: DropIndicator[] = [];
  for (const id of ids) {
    const block = doc.getBlock(id);
    if (block === null || block.type === "connector") continue;
    if (riders.has(id)) continue; // the unit's member stands the box's delta
    // The membership's scope: the shapes and the containers (the
    // canvas-text / frame stand no membership).
    if (block.type !== "shape" && block.type !== "group") continue;
    const base = effectiveGeometry(block);
    const figure = { x: base.x + dx, y: base.y + dy, w: base.w, h: base.h };
    const owner = containers.find((c) => c.members.includes(id));
    // The target excludes the item's own box (a container's box stands
    // inside itself — the self-join is a no-op, never the home).
    const target = containers.find((c) => c.id !== id && boxContains(figure, c.box));
    if (target !== undefined && target.id !== owner?.id) {
      indicators.push({ id, containerId: target.id, kind: "in" });
    } else if (owner !== undefined && !boxContains(figure, owner.box)) {
      indicators.push({ id, containerId: owner.id, kind: "out" });
    }
  }
  return indicators;
}

function useCanvasViewport(doc: Doc, initialViewport?: PersistedViewport | null): CanvasViewportState {
  // The viewport's stand: the restored
  // browser state (the storage's read) over the 100% / center's default.
  const [zoom, setZoomState] = useState(() => initialViewport?.zoom ?? 1);
  const [pan, setPan] = useState<ScreenPoint>(() => initialViewport?.pan ?? { x: 0, y: 0 });
  const [mode, setMode] = useState<CanvasMode>("default");
  const [activeTool, setActiveTool] = useState<CanvasTool | null>(null);
  const [pendingConnector, setPendingConnector] = useState<string | null>(null);
  const [pendingFree, setPendingFree] = useState<CanvasPoint | null>(null);
  const [pendingPort, setPendingPort] = useState<CanvasPort | null>(null);
  const [pendingFreePort, setPendingFreePort] = useState<CanvasPort | null>(null);
  const [pendingSource, setPendingSource] = useState<string | null>(null);
  // The pending stand's press point (world canvas px): the block stand's
  // port snap reads it at the commit (the non-render gesture data).
  const standPointRef = useRef<CanvasPoint | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [penPoints, setPenPoints] = useState<CanvasPoint[]>([]);
  const [movePreview, setMovePreview] = useState<MovePreview | null>(null);
  const [moveSession, setMoveSession] = useState(false);
  const [dropIndicators, setDropIndicators] = useState<DropIndicator[] | null>(null);
  const [placePreview, setPlacePreview] = useState<PlacePreview | null>(null);
  const [connectorPreview, setConnectorPreview] = useState<EndpointPreview | null>(null);
  const [connectorHoverSnap, setConnectorHoverSnap] = useState<EndpointSnap | null>(null);
  const [connectorEndpoint, setConnectorEndpoint] = useState<EndpointDrag | null>(null);
  const [connectorEndpointPreview, setConnectorEndpointPreview] = useState<EndpointPreview | null>(null);
  const [shapeTextEditing, setShapeTextEditing] = useState<string | null>(null);
  const [connectorLabelEditing, setConnectorLabelEditing] = useState<string | null>(null);
  const endpointRef = useRef<EndpointSession | null>(null);
  const moveRef = useRef<MoveSession | null>(null);
  const dropRef = useRef<DropIndicator[] | null>(null);

  const setZoom = useCallback((next: number) => setZoomState(next), []);
  const step = useCallback((direction: 1 | -1) => setZoomState((current) => stepZoom(current, direction)), []);

  // The wheel's zoom at the cursor: the canvas point under the screen
  // point stands fixed — the pan moves by the screen delta the point's
  // new position would bring (screen = zoom * canvas + pan). The step
  // stands no-op at the bounds (the zoom and the pan keep).
  const zoomAt = useCallback(
    (point: ScreenPoint, direction: 1 | -1) => {
      const next = stepZoom(zoom, direction);
      if (next === zoom) return;
      setZoomState(next);
      // The two-decimal round: the float drift of the ratio (the stop
      // grid's decimals stand the exact value) stands no phantom px.
      setPan({
        x: Number((point.x - (point.x - pan.x) * (next / zoom)).toFixed(2)),
        y: Number((point.y - (point.y - pan.y) * (next / zoom)).toFixed(2)),
      });
    },
    [zoom, pan]
  );

  // The pinch's continuous zoom at the cursor (the trackpad's smooth
  // stand): the zoom scales by the
  // wheel's delta (no step threshold — the pinch reacts on every event)
  // and the point under the cursor stands fixed (the pan compensates,
  // the same math as the step's zoomAt). The bound stands the no-op
  // (the zoom and the pan keep).
  const pinchAt = useCallback(
    (point: ScreenPoint, deltaY: number) => {
      const next = pinchZoom(zoom, deltaY);
      if (next === zoom) return;
      setZoomState(next);
      setPan({
        x: Number((point.x - (point.x - pan.x) * (next / zoom)).toFixed(2)),
        y: Number((point.y - (point.y - pan.y) * (next / zoom)).toFixed(2)),
      });
    },
    [zoom, pan]
  );

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
        }
      } catch {
        // A rejected placement: the tool resets, nothing is created.
      }
      setActiveTool(null);
    },
    [activeTool, doc]
  );

  // The drag-to-size place: the shape's box is the dragged size (the
  // marquee gesture), the center anchor is the drag's midpoint — one
  // transact (the insert + the setGeometry, like the click place).
  const onPlaceSize = useCallback(
    (tool: CanvasTool, point: CanvasPoint, size: { w: number; h: number }) => {
      setPlacePreview(null);
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
        }
      } catch {
        // A rejected placement (the size against a validator bound):
        // the tool resets, nothing is created.
      }
      setActiveTool(null);
    },
    [doc]
  );

  const setPendingStand = useCallback(
    (
      stand: { blockId?: string; free?: CanvasPoint; port?: CanvasPort; freePort?: CanvasPort; source?: string } | null,
      pressPoint: CanvasPoint | null = null
    ) => {
      setPendingConnector(stand?.blockId ?? null);
      setPendingFree(stand?.free ?? null);
      setPendingPort(stand?.port ?? null);
      setPendingFreePort(stand?.freePort ?? null);
      setPendingSource(stand?.source ?? null);
      setConnectorPreview(null);
      setConnectorHoverSnap(null);
      standPointRef.current = stand === null ? null : pressPoint;
    },
    []
  );

  // The connector's completion (the two-click's second pick or the
  // press-drag's release): the connector lands between the pending stand
  // and the second stand. A block stand snaps to the block's port when
  // its pick point stands within the snap radius (the canvas point
  // against the ports — both in the world space); a free stand stands as
  // the pick point (the canvas px as-is). The surface is the second
  // block's (the first block's when the second is free, the first surface
  // when both stand free).
  const onConnectorCommit = useCallback(
    (second: { blockId?: string; free?: CanvasPoint }, pickPoint: CanvasPoint) => {
      const firstBlock = pendingConnector;
      const firstFree = pendingFree;
      const firstPort = pendingPort;
      const firstFreePort = pendingFreePort;
      const standPoint = standPointRef.current;
      setPendingStand(null);
      setActiveTool(null);
      setConnectorPreview(null);
      setConnectorHoverSnap(null);
      if (firstBlock === null && firstFree === null) return;
      if (second.blockId !== undefined && second.blockId === firstBlock) return; // a self-pair

      let surfaceId: string | null;
      if (second.blockId !== undefined) {
        surfaceId = findParentSurface(doc, second.blockId);
      } else if (firstBlock !== null) {
        surfaceId = findParentSurface(doc, firstBlock);
      } else {
        surfaceId = firstSurface(doc);
      }
      if (surfaceId === null) return;
      // The edge snap: the block's side + the fractional position whose
      // edge point stands nearest to the pick point within the snap
      // radius (the canvas px, the zoom-blind space) — the continuous
      // anchor; far from the edge the
      // ref stands the port-less block ref (the sticky anchor).
      const snap = (blockId: string, world: CanvasPoint): { blockId: string; port?: CanvasPort; portT?: number } => {
        const s = snapEdgePoint(doc, blockId, world);
        return s !== null ? { blockId, port: s.port, portT: roundPortT(s.t) } : { blockId };
      };

      // The START stand: the port stand stands the press's snap (the
      // — the press's port stand, the legacy
      // port ref with the portT's 0.5 stand, no re-snap), the plain block
      // stand re-snaps at the press point (the legacy path), the free
      // stand stands the press point + the frozen direction (the snapped
      // side).
      const start =
        firstBlock !== null
          ? firstPort !== null
            ? { blockId: firstBlock, port: firstPort, portT: 0.5 }
            : snap(firstBlock, standPoint ?? pickPoint)
          : { ...firstFree!, ...(firstFreePort !== null ? { port: firstFreePort } : {}) };
      const end = second.blockId !== undefined ? snap(second.blockId, pickPoint) : { ...second.free! };
      try {
        doc.transact(() => {
          doc.insertBlock("connector", { start, end }, { parent: surfaceId });
        });
      } catch {
        // A rejected placement: the stand drops, nothing is created.
      }
    },
    [doc, pendingConnector, pendingFree, pendingPort, pendingFreePort, setPendingStand]
  );

  const onConnectorPick = useCallback(
    (id: string) => {
      // The first pick stands the pending endpoint (the two-click's first
      // click; the press-drag's press on an item).
      if (pendingConnector === null && pendingFree === null) {
        setPendingStand({ blockId: id });
      }
    },
    [pendingConnector, pendingFree, setPendingStand]
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

  // The connector endpoint's drag session (the selected line's handles):
  // the press opens the session (the line re-draws live from the
  // preview point — pure render state, no doc write until the release),
  // the release commits the endpoint in one updateBlock (the edge snap —
  // the side + the fractional position along it — when released within
  // the snap radius of a sibling's edge, else the free point; a release
  // over the dragged endpoint's OWN block re-anchors it at the release's
  // projection — the continuous contract).
  // The preview / commit points stand in the
  // SURFACE-LOCAL canvas space (the surface center's origin — the
  // geometry's space); the session carries the surface's world offset.
  const beginConnectorEndpoint = useCallback(
    (connectorId: string, which: "start" | "end", pointer: ScreenPoint, startClientX: number, startClientY: number) => {
      const block = doc.getBlock(connectorId);
      if (block === null || block.type !== "connector") return;
      const surfaceId = findParentSurface(doc, connectorId);
      if (surfaceId === null) return;
      const canvas = screenToCanvas(pointer, zoom, pan);
      // The frozen direction: the free
      // point commit keeps the endpoint's last direction (the port's side
      // / the legacy anchor's edge / the stored frozen port — the line
      // stands its direction while the endpoint is in the air).
      const attrs = block.attrs;
      const children = doc.getChildren(surfaceId);
      const blocks: Record<string, Block> = {};
      for (const childId of children) {
        const child = doc.getBlock(childId);
        if (child !== null) blocks[childId] = child;
      }
      const other = attrs[which === "start" ? "end" : "start"];
      const otherResolved = endpointPointOf(other, children, blocks, { x: 0, y: 0 });
      const toward = otherResolved !== null ? { x: otherResolved.x, y: otherResolved.y } : { x: 0, y: 0 };
      const resolved = endpointPointOf(attrs[which], children, blocks, toward);
      const direction = resolved !== null ? portOfNormal(resolved.nx, resolved.ny) : null;
      endpointRef.current = {
        connectorId,
        surfaceId,
        which,
        startClientX,
        startClientY,
        dragging: false,
        point: canvas,
        direction,
      };
      setConnectorEndpoint({ connectorId, which });
      setConnectorEndpointPreview(null);
    },
    [doc, zoom, pan]
  );

  const moveConnectorEndpoint = useCallback(
    (pointer: ScreenPoint) => {
      const session = endpointRef.current;
      if (session === null) return;
      session.dragging = true;
      const point = screenToCanvas(pointer, zoom, pan);
      session.point = point;
      // The live edge snap: within the radius the preview stands at the
      // edge anchor (the side's point at the fractional position — the
      // stick effect); the release commits the same snap against the
      // same point.
      const snap = snapEndpointEdge(doc, session.surfaceId, point);
      setConnectorEndpointPreview({ point, snap });
    },
    [doc, zoom, pan]
  );

  const endConnectorEndpoint = useCallback(
    (releaseClientX?: number, releaseClientY?: number) => {
      const session = endpointRef.current;
      endpointRef.current = null;
      setConnectorEndpoint(null);
      setConnectorEndpointPreview(null);
      if (session === null || !session.dragging) return;
      // The release threshold (the move / resize sessions' contract): a
      // sub-threshold press-release commits nothing (no wire traffic).
      if (
        releaseClientX !== undefined &&
        releaseClientY !== undefined &&
        Math.hypot(releaseClientX - session.startClientX, releaseClientY - session.startClientY) <
          ENDPOINT_RELEASE_THRESHOLD_PX
      ) {
        return;
      }
      // The edge snap (the same search as the live preview — the release
      // commits what the preview stood): the side + the fractional
      // position (the continuous anchor; the own block's edge re-anchors
      // the endpoint instead of detaching it ).
      const snap = snapEndpointEdge(doc, session.surfaceId, session.point);
      const ref =
        snap !== null
          ? { blockId: snap.blockId, port: snap.port, portT: roundPortT(snap.t) }
          : {
              x: Number(session.point.x.toFixed(2)),
              y: Number(session.point.y.toFixed(2)),
              ...(session.direction !== null ? { port: session.direction } : {}),
            };
      try {
        doc.transact(() => {
          doc.updateBlock(session.connectorId, session.which === "start" ? { start: ref } : { end: ref });
        });
      } catch {
        // A concurrent removal of the connector: the commit drops.
      }
    },
    [doc]
  );

  const cancelConnectorEndpoint = useCallback(() => {
    endpointRef.current = null;
    setConnectorEndpoint(null);
    setConnectorEndpointPreview(null);
  }, []);

  const beginMove = useCallback(
    (ids: string[], startClientX: number, startClientY: number) => {
      const snapshot: MoveSession["snapshot"] = {};
      const allIds: string[] = [];
      for (const id of ids) {
        const block = doc.getBlock(id);
        // The connector carries no geometry of its own (its endpoints
        // follow the blocks): it is never a move target.
        if (block === null || block.type === "connector") continue;
        if (block.type === "group") {
          // The container moves as a unit:
          // the box and the members stand the one delta (the members keep
          // their absolute coordinates — the union is not re-derived). A
          // nested container's members ride with the outer box (the
          // recursive unit). The dangling member (a concurrent removal) is
          // skipped, not rewritten.
          allIds.push(id);
          snapshot[id] = effectiveGeometry(block);
          for (const memberId of unitMembers(doc, id)) {
            const member = doc.getBlock(memberId);
            if (member === null || allIds.includes(memberId)) continue;
            allIds.push(memberId);
            snapshot[memberId] = effectiveGeometry(member);
          }
          continue;
        }
        if (allIds.includes(id)) continue;
        allIds.push(id);
        // The effective box the element stands at (the stored geometry or
        // the synthesized default) — the release commit writes a complete
        // x/y/w/h patch from it.
        snapshot[id] = effectiveGeometry(block);
      }
      moveRef.current = { ids: allIds, startClientX, startClientY, snapshot, dragging: false, dx: 0, dy: 0 };
      setMovePreview(null);
      setMoveSession(true);
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
      // The drop indicator (the green / red stand): the release commit reads the session's last stand.
      const indicators = computeDropIndicators(doc, session.ids, delta.x, delta.y);
      dropRef.current = indicators;
      setDropIndicators(indicators.length > 0 ? indicators : null);
    },
    [doc, zoom]
  );

  const endMove = useCallback(() => {
    const session = moveRef.current;
    moveRef.current = null;
    setMoveSession(false);
    const drops = dropRef.current;
    dropRef.current = null;
    setMovePreview(null);
    setDropIndicators(null);
    if (session === null || !session.dragging) return;
    // One transact for the whole (group) move + the drop's membership:
    // one undo step, one wire update. A vanished block (a concurrent
    // removal) is skipped; a vanished-everything session with no drop
    // stands no transact at all (an empty transact stamps the meta and
    // emits an update for nothing).
    const targets = session.ids.filter((id) => session.snapshot[id] !== undefined && doc.getBlock(id) !== null);
    if (targets.length === 0 && (drops === null || drops.length === 0)) return;
    doc.transact(() => {
      for (const id of targets) {
        const snap = session.snapshot[id];
        if (snap === undefined) continue;
        doc.setGeometry(id, {
          x: snap.x + session.dx,
          y: snap.y + session.dy,
          w: snap.w,
          h: snap.h,
        });
      }
      // The drop's membership (the shapes AND the containers): each
      // dragged shape / container's membership
      // stands its RELEASE position (the recompute, not the indicator — the
      // release's truth is the final box). The fully-containing container
      // is the home (the item joins it, leaving any previous owner); no
      // fully-containing container stands the removal from the owner (the
      // drag-out). A dragged container's unit members ride the box (the
      // relative position is invariant — no individual membership change).
      // The members' reads are FRESH (the doc's own state) so several items
      // joining one container compose.
      const containers = containersOf(doc);
      const draggedGroups = targets.filter((id) => doc.getBlock(id)?.type === "group");
      const riders = new Set<string>();
      for (const gid of draggedGroups) for (const mid of unitMembers(doc, gid)) riders.add(mid);
      for (const id of targets) {
        const block = doc.getBlock(id);
        if (block === null || block.type === "connector") continue;
        if (riders.has(id)) continue;
        if (block.type !== "shape" && block.type !== "group") continue;
        const snap = session.snapshot[id];
        if (snap === undefined) continue;
        const finalBox = { x: snap.x + session.dx, y: snap.y + session.dy, w: snap.w, h: snap.h };
        // The home excludes the item's own box (the self-join is a no-op).
        const target = containers.find((c) => c.id !== id && boxContains(finalBox, c.box));
        // Leave the owner(s) it no longer stands in (the home excepted).
        for (const container of containers) {
          const fresh = doc.getBlock(container.id);
          if (fresh === null || fresh.type !== "group" || !fresh.attrs.members.includes(id)) continue;
          if (target !== undefined && container.id === target.id) continue;
          doc.updateBlock(container.id, { members: fresh.attrs.members.filter((m) => m !== id) });
        }
        // Join the home (the fresh read — the members list is the doc's own).
        if (target !== undefined) {
          const home = doc.getBlock(target.id);
          if (home !== null && home.type === "group" && !home.attrs.members.includes(id)) {
            doc.updateBlock(target.id, { members: [...home.attrs.members, id] });
          }
        }
      }
    });
  }, [doc]);

  const cancelMove = useCallback(() => {
    moveRef.current = null;
    dropRef.current = null;
    setMovePreview(null);
    setDropIndicators(null);
    setMoveSession(false);
  }, []);

  const resizeRef = useRef<ResizeSession | null>(null);
  const [resizePreview, setResizePreview] = useState<{ id: string; box: Box } | null>(null);
  const [resizeSession, setResizeSession] = useState(false);

  const beginResize = useCallback(
    (id: string, handle: ResizeHandle, startClientX: number, startClientY: number) => {
      const block = doc.getBlock(id);
      if (block === null || block.type === "connector") return;
      // The container's members' union stand (the resize's per-edge clamp);
      // the shape's resize (the absent members) stands the plain floor.
      let memberUnion: Box | undefined;
      if (block.type === "group") {
        const memberBoxes: Box[] = [];
        for (const memberId of block.attrs.members) {
          const member = doc.getBlock(memberId);
          if (member === null || member.type === "connector") continue;
          memberBoxes.push(effectiveGeometry(member));
        }
        memberUnion = unionBox(memberBoxes) ?? undefined;
      }
      resizeRef.current = {
        id,
        handle,
        snapshot: effectiveGeometry(block),
        startClientX,
        startClientY,
        dragging: false,
        box: null,
        memberUnion,
      };
      setResizePreview(null);
      setResizeSession(true);
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
      session.box = resizeBox(session.snapshot, session.handle, delta.x, delta.y, shift, session.memberUnion);
      setResizePreview({ id: session.id, box: session.box });
    },
    [zoom]
  );

  const endResize = useCallback(() => {
    const session = resizeRef.current;
    resizeRef.current = null;
    setResizePreview(null);
    setResizeSession(false);
    if (session === null || !session.dragging || session.box === null) return;
    doc.transact(() => {
      if (doc.getBlock(session.id) === null) return;
      doc.setGeometry(session.id, { x: session.box!.x, y: session.box!.y, w: session.box!.w, h: session.box!.h });
    });
  }, [doc]);

  const cancelResize = useCallback(() => {
    resizeRef.current = null;
    setResizePreview(null);
    setResizeSession(false);
  }, []);

  // The viewport's browser persistence:
  // the zoom / pan's commit over the debounced write (the wheel's / the
  // pan's / the fit's last stand coalesces over the trailing edge) + the
  // unmount's flush (the leave-within-the-window's last change stands
  // committed). The doc's own data stands untouched.
  const persistedRef = useRef({ docId: doc.meta.id, zoom, pan });
  persistedRef.current = { docId: doc.meta.id, zoom, pan };
  useEffect(() => {
    const handle = setTimeout(() => writeCanvasViewport(doc.meta.id, { zoom, pan }), WRITE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [doc, zoom, pan]);
  useEffect(() => {
    return () => {
      const latest = persistedRef.current;
      writeCanvasViewport(latest.docId, { zoom: latest.zoom, pan: latest.pan });
    };
  }, [doc]);

  return {
    zoom,
    pan,
    mode,
    activeTool,
    pendingConnector,
    pendingFree,
    pendingPort,
    pendingFreePort,
    pendingSource,
    marquee,
    penPoints,
    movePreview,
    moveSession,
    dropIndicators,
    resizePreview,
    resizeSession,
    placePreview,
    connectorPreview,
    connectorHoverSnap,
    connectorEndpoint,
    connectorEndpointPreview,
    shapeTextEditing,
    setShapeTextEditing,
    connectorLabelEditing,
    setConnectorLabelEditing,
    setConnectorPreview,
    setConnectorHoverSnap,
    setZoom,
    stepZoom: step,
    zoomAt,
    pinchAt,
    setPan,
    setMode,
    setActiveTool,
    setPendingConnector,
    setPendingStand,
    setMarquee,
    setPenPoints,
    marqueeRect: marquee === null ? null : marqueeRect(marquee.start, marquee.end),
    onPlace,
    onPlaceSize,
    setPlacePreview,
    onConnectorPick,
    onConnectorCommit,
    onPen,
    beginConnectorEndpoint,
    moveConnectorEndpoint,
    endConnectorEndpoint,
    cancelConnectorEndpoint,
    beginMove,
    moveDrag,
    endMove,
    cancelMove,
    beginResize,
    resizeDrag,
    endResize,
    cancelResize,
  };
}

export { unitMembers, useCanvasViewport };
