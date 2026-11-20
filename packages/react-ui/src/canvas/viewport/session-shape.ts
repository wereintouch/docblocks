/** The figure's gesture sessions (the move / the resize) over the doc:
 * the session data (the snapshot, the containers' read, the last
 * delta / box) lives in the factory's closure objects (the per-gesture
 * mutable refs — the render state is the preview only), the release
 * commits one transact (one undo step, one wire update), the cancel
 * drops the session without a write. The previews stand in the
 * viewport's store (the per-item narrow subscriptions: a pointermove
 * re-renders the moved / resized items only). */
import type { Doc } from "docblocks-core";

import { boxContains, effectiveGeometry } from "../geometry";
import { resizeBox, screenDeltaToCanvas, unionBox } from "./geometry";
import type { Box, DropIndicator, MoveSession, ResizeHandle, ResizeSession } from "./models";
import { computeDropIndicators, containersOf } from "./session-shape-drop";
import type { CanvasViewportStore } from "./viewport-store";

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

/** The shape's session commands (the move / the resize over the doc). */
function createShapeSessions(store: CanvasViewportStore, doc: Doc) {
  // The per-gesture session data (the mutable refs — the render state is
  // the store's preview only; the release commit reads the session).
  const moveRef: { current: MoveSession | null } = { current: null };
  const dropRef: { current: DropIndicator[] | null } = { current: null };
  const resizeRef: { current: ResizeSession | null } = { current: null };

  const beginMove = (ids: string[], startClientX: number, startClientY: number) => {
    const snapshot: MoveSession["snapshot"] = {};
    const types: MoveSession["types"] = {};
    const groupMembers: MoveSession["groupMembers"] = {};
    const allIds: string[] = [];
    for (const id of ids) {
      const block = doc.getBlock(id);
      // The connector carries no geometry of its own (its endpoints
      // follow the blocks): it is never a move target.
      if (block === null || block.type === "connector") continue;
      types[id] = block.type;
      if (block.type === "group") {
        // The container moves as a unit: the box and the members stand the
        // one delta (the members keep their absolute coordinates — the
        // union is not re-derived). A nested container's members ride with
        // the outer box (the recursive unit). The dangling member (a
        // concurrent removal) is skipped, not rewritten.
        allIds.push(id);
        snapshot[id] = effectiveGeometry(block);
        groupMembers[id] = unitMembers(doc, id);
        for (const memberId of groupMembers[id]) {
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
    // The session stand over the doc reads (the pointermove's indicator
    // pass is pure — the containers' membership / geometry stand stable
    // over the drag, the release's commit stands the fresh read).
    moveRef.current = {
      ids: allIds,
      startClientX,
      startClientY,
      snapshot,
      types,
      containers: containersOf(doc),
      groupMembers,
      dragging: false,
      dx: 0,
      dy: 0,
    };
    store.getState().setMovePreview(null);
    store.getState().setMoveSession(true);
  };

  const moveDrag = (clientX: number, clientY: number) => {
    const session = moveRef.current;
    if (session === null) return;
    const delta = screenDeltaToCanvas(
      clientX - session.startClientX,
      clientY - session.startClientY,
      store.getState().zoom
    );
    if (delta === null) return;
    session.dragging = true;
    // A drag drops the drill-down's session (the press was a move, not a
    // step): the next press over the spot stands a fresh plain select.
    store.getState().setCycle(null);
    store.getState().setCycleIndicator(null);
    // The session carries the delta (the render state is the preview
    // only — the release commit reads the session, not the closure).
    session.dx = delta.x;
    session.dy = delta.y;
    store.getState().setMovePreview({ ids: session.ids, idSet: new Set(session.ids), dx: delta.x, dy: delta.y });
    // The drop indicator (the green / red stand): the release commit
    // reads the session's last stand.
    const indicators = computeDropIndicators(
      session.types,
      session.snapshot,
      session.containers,
      session.groupMembers,
      session.ids,
      delta.x,
      delta.y
    );
    dropRef.current = indicators;
    store.getState().setDropIndicators(indicators.length > 0 ? indicators : null);
  };

  const endMove = () => {
    const session = moveRef.current;
    moveRef.current = null;
    store.getState().setMoveSession(false);
    const drops = dropRef.current;
    dropRef.current = null;
    store.getState().setMovePreview(null);
    store.getState().setDropIndicators(null);
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
      // The drop's membership (the shapes, the canvas-text, AND the
      // containers; the frame stands no membership): each dragged
      // figure's membership stands its RELEASE position (the recompute,
      // not the indicator — the release's truth is the final box). The
      // fully-containing container is the home (the item joins it,
      // leaving any previous owner); no fully-containing container
      // stands the removal from the owner (the drag-out). A dragged
      // container's unit members ride the box (the relative position is
      // invariant — no individual membership change). The members' reads
      // are FRESH (the doc's own state) so several items joining one
      // container compose.
      const containers = containersOf(doc);
      const draggedGroups = targets.filter((id) => doc.getBlock(id)?.type === "group");
      const riders = new Set<string>();
      for (const gid of draggedGroups) for (const mid of unitMembers(doc, gid)) riders.add(mid);
      for (const id of targets) {
        const block = doc.getBlock(id);
        if (block === null || block.type === "connector") continue;
        if (riders.has(id)) continue;
        if (block.type !== "shape" && block.type !== "canvas-text" && block.type !== "group") continue;
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
  };

  const cancelMove = () => {
    moveRef.current = null;
    dropRef.current = null;
    store.getState().setMovePreview(null);
    store.getState().setDropIndicators(null);
    store.getState().setMoveSession(false);
  };

  const beginResize = (id: string, handle: ResizeHandle, startClientX: number, startClientY: number) => {
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
    store.getState().setResizePreview(null);
    store.getState().setResizeSession(true);
  };

  const resizeDrag = (clientX: number, clientY: number, shift: boolean) => {
    const session = resizeRef.current;
    if (session === null) return;
    const delta = screenDeltaToCanvas(
      clientX - session.startClientX,
      clientY - session.startClientY,
      store.getState().zoom
    );
    if (delta === null) return;
    session.dragging = true;
    store.getState().setCycle(null);
    store.getState().setCycleIndicator(null);
    // The session carries the box (the release commit reads the session,
    // not the render state).
    session.box = resizeBox(session.snapshot, session.handle, delta.x, delta.y, shift, session.memberUnion);
    store.getState().setResizePreview({ id: session.id, box: session.box });
  };

  const endResize = () => {
    const session = resizeRef.current;
    resizeRef.current = null;
    store.getState().setResizePreview(null);
    store.getState().setResizeSession(false);
    if (session === null || !session.dragging || session.box === null) return;
    doc.transact(() => {
      if (doc.getBlock(session.id) === null) return;
      const box = session.box;
      if (box === null) return;
      doc.setGeometry(session.id, { x: box.x, y: box.y, w: box.w, h: box.h });
    });
  };

  const cancelResize = () => {
    resizeRef.current = null;
    store.getState().setResizePreview(null);
    store.getState().setResizeSession(false);
  };

  return { beginMove, moveDrag, endMove, cancelMove, beginResize, resizeDrag, endResize, cancelResize };
}

export { createShapeSessions, unitMembers };
