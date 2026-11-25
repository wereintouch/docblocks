/**
 * The dev relay's room lifecycle: the room shape (the Y.Doc + the Awareness
 * + the live sockets + the announced awareness client ids + the chaos
 * gate), the room's creation over the doc / awareness update fan-out (the
 * sender already holds its own bytes — the frame goes to the OTHER
 * connections), and the empty-room TTL (an idle room's doc + awareness are
 * destroyed once the last socket leaves, so rooms do not accumulate for
 * the dev server's lifetime).
 */
import { WebSocket } from "ws";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { type ChaosConfig, DEFAULT_CHAOS } from "./chaos.ts";
import { buildAwarenessFrame, buildSyncUpdateFrame, sendFrame } from "./relay-frames.ts";

/** A pending empty-room TTL destroys an idle room after this delay. */
const EMPTY_ROOM_TTL_MS = 60_000; // 60 s

interface Room {
  doc: Y.Doc;
  awareness: Awareness;
  sockets: Set<WebSocket>;
  /** Awareness client ids each connection announced (removed on close). */
  controlled: Map<WebSocket, number[]>;
  /** The room's chaos gate (frame-delivery level); defaults to off. */
  chaos: ChaosConfig;
  /** A pending empty-room TTL (cleared when a socket rejoins). */
  emptyTtl?: NodeJS.Timeout;
}

function createRoom(rooms: Map<string, Room>, name: string): Room {
  const existing = rooms.get(name);
  if (existing !== undefined) return existing;
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  awareness.setLocalState(null); // the relay itself has no presence
  const room: Room = { doc, awareness, sockets: new Set(), controlled: new Map(), chaos: { ...DEFAULT_CHAOS } };

  doc.on("update", (update: Uint8Array, origin: unknown) => {
    const frame = buildSyncUpdateFrame(update);
    for (const socket of room.sockets) {
      if (socket !== origin) sendFrame(room, socket, frame);
    }
  });

  awareness.on("update", (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    trackControlled(room, origin, changes.added, changes.removed);
    const changed = [...changes.added, ...changes.updated, ...changes.removed];
    if (changed.length === 0) return;
    const frame = buildAwarenessFrame(awareness, changed);
    for (const socket of room.sockets) {
      if (socket !== origin) sendFrame(room, socket, frame);
    }
  });

  rooms.set(name, room);
  return room;
}

/** Remember which awareness client ids a connection announced, so close can drop them. */
function trackControlled(room: Room, origin: unknown, added: number[], removed: number[]): void {
  if (typeof origin !== "object" || origin === null) return;
  const ids = room.controlled.get(origin as WebSocket);
  if (ids === undefined) return;
  for (const id of added) if (!ids.includes(id)) ids.push(id);
  for (const id of removed) {
    const index = ids.indexOf(id);
    if (index >= 0) ids.splice(index, 1);
  }
}

/**
 * Schedule the empty-room TTL: when a room's last socket leaves, the room
 * (its doc + awareness) is destroyed after the TTL so idle rooms do not
 * accumulate for the dev server's lifetime. A rejoining socket clears the
 * pending timer (createRoom / the connection handler). The timer is
 * unref'd so it never keeps the process alive.
 */
function scheduleEmptyRoomTtl(rooms: Map<string, Room>, name: string): void {
  const room = rooms.get(name);
  if (room === undefined) return;
  if (room.emptyTtl !== undefined) clearTimeout(room.emptyTtl);
  room.emptyTtl = setTimeout(() => {
    const current = rooms.get(name);
    if (current === undefined || current.sockets.size > 0) return; // a socket rejoined
    rooms.delete(name);
    current.doc.destroy(); // also destroys current.awareness
  }, EMPTY_ROOM_TTL_MS);
  room.emptyTtl.unref();
}

export { createRoom, scheduleEmptyRoomTtl };
export type { Room };
