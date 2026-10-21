/** The canvas viewport's owner hook: the zoom / pan / mode / tool state,
 *  the pending connector stand, and the placement / move / resize /
 *  rotate / endpoint-drag sessions over the doc. Pure view state per
 *  editor instance — it stands outside the doc and the awareness and
 *  resets on the canvas view's unmount. */
import { useCallback, useRef, useState } from "react";

import type { Block, Doc } from "docblocks-core";

import { effectiveGeometry, endpointPointOf, portOfNormal, portsOf } from "../../blocks/canvas-geometry";
import { findParentSurface, firstSurface, placeCanvasText, placeFrame, placePenStroke, placeShape } from "../insert";
import {
  TOOL_SIZES,
  marqueeRect,
  resizeBox,
  rotateAngle,
  screenDeltaToCanvas,
  screenToCanvas,
  stepZoom,
} from "../viewport";
import type { Box, CanvasMode, CanvasPoint, CanvasTool, PenStroke, ResizeHandle, ScreenPoint } from "../viewport";
import { ENDPOINT_RELEASE_THRESHOLD_PX, ENDPOINT_SNAP_RADIUS } from "./models";
import type {
  CanvasViewportState,
  EndpointDrag,
  EndpointPreview,
  EndpointSession,
  MarqueeState,
  MovePreview,
  MoveSession,
  PlacePreview,
  ResizeSession,
  RotateSession,
} from "./models";
import { snapEndpointPort } from "./utils";

function useCanvasViewport(doc: Doc): CanvasViewportState {
  const [zoom, setZoomState] = useState(1);
  const [pan, setPan] = useState<ScreenPoint>({ x: 0, y: 0 });
  const [mode, setMode] = useState<CanvasMode>("default");
  const [activeTool, setActiveTool] = useState<CanvasTool | null>(null);
  const [pendingConnector, setPendingConnector] = useState<string | null>(null);
  const [pendingFree, setPendingFree] = useState<CanvasPoint | null>(null);
  // The pending stand's press point (world canvas px): the block stand's
  // port snap reads it at the commit (the non-render gesture data).
  const standPointRef = useRef<CanvasPoint | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [penPoints, setPenPoints] = useState<CanvasPoint[]>([]);
  const [movePreview, setMovePreview] = useState<MovePreview | null>(null);
  const [placePreview, setPlacePreview] = useState<PlacePreview | null>(null);
  const [connectorPreview, setConnectorPreview] = useState<CanvasPoint | null>(null);
  const [connectorEndpoint, setConnectorEndpoint] = useState<EndpointDrag | null>(null);
  const [connectorEndpointPreview, setConnectorEndpointPreview] = useState<EndpointPreview | null>(null);
  const [shapeTextEditing, setShapeTextEditing] = useState<string | null>(null);
  const endpointRef = useRef<EndpointSession | null>(null);
  const moveRef = useRef<MoveSession | null>(null);

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
    (stand: { blockId?: string; free?: CanvasPoint } | null, pressPoint: CanvasPoint | null = null) => {
      setPendingConnector(stand?.blockId ?? null);
      setPendingFree(stand?.free ?? null);
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
      const standPoint = standPointRef.current;
      setPendingStand(null);
      setActiveTool(null);
      setConnectorPreview(null);
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
      // The port snap: the nearest edge midpoint of the block within the
      // snap radius (the canvas px, the zoom-blind space).
      const snap = (
        blockId: string,
        world: CanvasPoint
      ): { blockId: string; port?: "north" | "east" | "south" | "west" } => {
        const block = doc.getBlock(blockId);
        if (block === null) return { blockId };
        const ports = portsOf(effectiveGeometry(block));
        let best: "north" | "east" | "south" | "west" | null = null;
        let bestDist = ENDPOINT_SNAP_RADIUS;
        for (const port of ["north", "east", "south", "west"] as const) {
          const p = ports[port];
          const dist = Math.hypot(p.x - world.x, p.y - world.y);
          if (dist < bestDist) {
            bestDist = dist;
            best = port;
          }
        }
        return best !== null ? { blockId, port: best } : { blockId };
      };

      const start = firstBlock !== null ? snap(firstBlock, standPoint ?? pickPoint) : { ...firstFree! };
      const end = second.blockId !== undefined ? snap(second.blockId, pickPoint) : { ...second.free! };
      try {
        doc.transact(() => {
          doc.insertBlock("connector", { start, end }, { parent: surfaceId });
        });
      } catch {
        // A rejected placement: the stand drops, nothing is created.
      }
    },
    [doc, pendingConnector, pendingFree, setPendingStand]
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
  // the release commits the endpoint in one updateBlock (the port snap
  // when released near a port, else the free point; a release on the
  // dragged endpoint's OWN block detaches to the free point — the owner
  // decision 2026-10-15). The preview / commit points stand in the
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
      // The live snap: within the radius the preview stands at the PORT
      // (the line's end sticks to it — the release commits the same snap
      // against the same point).
      const snap = snapEndpointPort(doc, session.surfaceId, session.connectorId, session.which, point);
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
      // The port snap (the same search as the live preview — the release
      // commits what the preview stood).
      const snap = snapEndpointPort(doc, session.surfaceId, session.connectorId, session.which, session.point);
      const ref =
        snap !== null
          ? { blockId: snap.blockId, port: snap.port }
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
      for (const id of ids) {
        const block = doc.getBlock(id);
        // The connector carries no geometry of its own (its endpoints
        // follow the blocks): it is never a move target. The group is the
        // same (its box is DERIVED from the members — the session over a
        // group selection feeds the MEMBERS' ids, the group itself is
        // never a target; a skipped id stands no snapshot, and the
        // release commit skips the snapshot-less ids).
        if (block === null || block.type === "connector" || block.type === "group") continue;
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
    // update. A vanished block (a concurrent removal) is skipped; a
    // vanished-everything session stands no transact at all (an empty
    // transact stamps the meta and emits an update for nothing).
    const targets = session.ids.filter((id) => session.snapshot[id] !== undefined && doc.getBlock(id) !== null);
    if (targets.length === 0) return;
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
    pendingFree,
    marquee,
    penPoints,
    movePreview,
    resizePreview,
    rotatePreview,
    placePreview,
    connectorPreview,
    connectorEndpoint,
    connectorEndpointPreview,
    shapeTextEditing,
    setShapeTextEditing,
    setConnectorPreview,
    setZoom,
    stepZoom: step,
    zoomAt,
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
    beginRotate,
    rotateDrag,
    endRotate,
    cancelRotate,
  };
}

export { useCanvasViewport };
