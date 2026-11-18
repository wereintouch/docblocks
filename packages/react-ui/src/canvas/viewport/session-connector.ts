/** The connector's sessions (the pick / the commit / the endpoint's drag)
 * over the doc: the pending stand (the two-click's first endpoint — a
 * block ref, a block ref with the port, or a free point with the frozen
 * direction), the completion (the second pick creates the connector in
 * one transact), and the endpoint's drag (the selected line's handles —
 * the live preview in the store, the release commit in one updateBlock).
 * The session data lives in the factory's closure object; the press's
 * stand point rides the shared ref (the setPendingStand's write, the
 * commit's read). */
import type { Block, Doc } from "docblocks-core";

import { endpointPointOf, portOfNormal } from "../geometry";
import { findParentSurface, firstSurface } from "../insert";
import { ENDPOINT_RELEASE_THRESHOLD_PX } from "./constants";
import { screenToCanvas } from "./geometry";
import type { CanvasPoint, EndpointSession } from "./models";
import { snapEdgePoint, snapEndpointEdge } from "./utils";
import type { CanvasViewportStore } from "./viewport-store";

/** The portT's commit rounding: the edge's fractional position stands at
 * the 4-digit stand (0.0001 — sub-pixel on any sane edge at any zoom). */
function roundPortT(t: number): number {
  return Number(t.toFixed(4));
}

/** The pending stand's press point (world canvas px): the block stand's
 * port snap reads it at the commit (the non-render gesture data). */
type StandPointRef = { current: CanvasPoint | null };

/** The connector's session commands (the pick / the commit / the
 * endpoint's drag over the doc). */
function createConnectorSessions(store: CanvasViewportStore, doc: Doc, standPoint: StandPointRef) {
  const endpointRef: { current: EndpointSession | null } = { current: null };

  // The connector's completion (the two-click's second pick or the
  // press-drag's release): the connector lands between the pending stand
  // and the second stand. A block stand snaps to the block's port when
  // its pick point stands within the snap radius (the canvas point
  // against the ports — both in the world space); a free stand stands as
  // the pick point (the canvas px as-is). The surface is the second
  // block's (the first block's when the second is free, the first surface
  // when both stand free).
  const onConnectorCommit = (second: { blockId?: string; free?: CanvasPoint }, pickPoint: CanvasPoint) => {
    const state = store.getState();
    const firstBlock = state.pendingConnector;
    const firstFree = state.pendingFree;
    const firstPort = state.pendingPort;
    const firstFreePort = state.pendingFreePort;
    const stand = standPoint.current;
    state.setPendingStand(null);
    state.setActiveTool(null);
    state.setConnectorPreview(null);
    state.setConnectorHoverSnap(null);
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
    // edge point stands nearest to the pick point within the snap radius
    // (the canvas px, the zoom-blind space) — the continuous anchor; far
    // from the edge the ref stands the port-less block ref (the sticky
    // anchor).
    const snap = (blockId: string, world: CanvasPoint) => {
      const s = snapEdgePoint(doc, blockId, world);
      return s !== null ? { blockId, port: s.port, portT: roundPortT(s.t) } : { blockId };
    };

    // The START stand: the port stand stands the press's snap (the press's
    // port stand — the legacy port ref with the portT's 0.5 stand, no
    // re-snap), the plain block stand re-snaps at the press point (the
    // legacy path), the free stand stands the press point + the frozen
    // direction (the snapped side).
    const start =
      firstBlock !== null
        ? firstPort !== null
          ? { blockId: firstBlock, port: firstPort, portT: 0.5 }
          : snap(firstBlock, stand ?? pickPoint)
        : { ...firstFree!, ...(firstFreePort !== null ? { port: firstFreePort } : {}) };
    const end = second.blockId !== undefined ? snap(second.blockId, pickPoint) : { ...second.free! };
    try {
      doc.transact(() => {
        doc.insertBlock("connector", { start, end }, { parent: surfaceId });
      });
    } catch {
      // A rejected placement: the stand drops, nothing is created.
    }
  };

  const onConnectorPick = (id: string) => {
    const state = store.getState();
    // The first pick stands the pending endpoint (the two-click's first
    // click; the press-drag's press on an item).
    if (state.pendingConnector === null && state.pendingFree === null) {
      state.setPendingStand({ blockId: id });
    }
  };

  // The connector endpoint's drag session (the selected line's handles):
  // the press opens the session (the line re-draws live from the preview
  // point — pure render state, no doc write until the release), the
  // release commits the endpoint in one updateBlock (the edge snap — the
  // side + the fractional position along it — when released within the
  // snap radius of a sibling's edge, else the free point; a release over
  // the dragged endpoint's OWN block re-anchors it at the release's
  // projection — the continuous contract). The preview / commit points
  // stand in the SURFACE-LOCAL canvas space (the surface center's origin
  // — the geometry's space); the session carries the surface's world
  // offset.
  const beginConnectorEndpoint = (
    connectorId: string,
    which: "start" | "end",
    pointer: { x: number; y: number },
    startClientX: number,
    startClientY: number
  ) => {
    const state = store.getState();
    const block = doc.getBlock(connectorId);
    if (block === null || block.type !== "connector") return;
    const surfaceId = findParentSurface(doc, connectorId);
    if (surfaceId === null) return;
    const canvas = screenToCanvas(pointer, state.zoom, state.pan);
    // The frozen direction: the free point commit keeps the endpoint's
    // last direction (the port's side / the legacy anchor's edge / the
    // stored frozen port — the line stands its direction while the
    // endpoint is in the air).
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
    state.setConnectorEndpoint({ connectorId, which });
    state.setConnectorEndpointPreview(null);
  };

  const moveConnectorEndpoint = (pointer: { x: number; y: number }) => {
    const session = endpointRef.current;
    if (session === null) return;
    const state = store.getState();
    session.dragging = true;
    const point = screenToCanvas(pointer, state.zoom, state.pan);
    session.point = point;
    // The live edge snap: within the radius the preview stands at the
    // edge anchor (the side's point at the fractional position — the
    // stick effect); the release commits the same snap against the same
    // point.
    const snap = snapEndpointEdge(doc, session.surfaceId, point);
    state.setConnectorEndpointPreview({ point, snap });
  };

  const endConnectorEndpoint = (releaseClientX?: number, releaseClientY?: number) => {
    const session = endpointRef.current;
    endpointRef.current = null;
    const state = store.getState();
    state.setConnectorEndpoint(null);
    state.setConnectorEndpointPreview(null);
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
    // commits what the preview stood): the side + the fractional position
    // (the continuous anchor; the own block's edge re-anchors the
    // endpoint instead of detaching it).
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
  };

  const cancelConnectorEndpoint = () => {
    endpointRef.current = null;
    const state = store.getState();
    state.setConnectorEndpoint(null);
    state.setConnectorEndpointPreview(null);
  };

  return {
    onConnectorPick,
    onConnectorCommit,
    beginConnectorEndpoint,
    moveConnectorEndpoint,
    endConnectorEndpoint,
    cancelConnectorEndpoint,
  };
}

export { createConnectorSessions };
export type { StandPointRef };
