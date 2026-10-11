import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";

import { type ChaosConfig, DEFAULT_CHAOS, handleChaosRequest, maybeChaosSend } from "./chaos.ts";

/**
 * Standard y-protocols relay hosted inside the playground dev server.
 *
 * One room per URL path; each room owns a Y.Doc and an Awareness instance.
 * The room doc is the merge of all clients' contributions: the relay
 * applies each client update to the room doc and sends the resulting
 * update frame to the OTHER room connections (the sender already holds
 * its own bytes). Awareness works the same way: a client awareness update
 * is applied to the room awareness, and a re-encoded frame for the changed
 * client ids is fanned out to the other connections. A query-awareness
 * frame is answered with the full room awareness state.
 *
 * Unknown frame types (e.g. auth) are ignored. Rooms persist for the
 * lifetime of the dev server, so a client reconnect resyncs against the
 * surviving room state instead of a fresh doc.
 *
 * The ws upgrade and the HTTP control (the per-room chaos API under
 * /__chaos, see chaos.ts) share one http.Server on the relay port. Every
 * outgoing room frame passes one send site (sendFrame), which applies the
 * room's chaos gate first: `drop` skips the frame with a probability,
 * `delay` defers it — chaos is a frame-delivery concern, the sockets stay
 * up.
 */

/** Standard y-websocket frame types. */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;

interface Room {
  doc: Y.Doc;
  awareness: Awareness;
  sockets: Set<WebSocket>;
  /** Awareness client ids each connection announced (removed on close). */
  controlled: Map<WebSocket, number[]>;
  /** The room's chaos gate (frame-delivery level); defaults to off. */
  chaos: ChaosConfig;
}

interface RelayHandle {
  stop(): Promise<void>;
}

/** A sync frame carrying the state vector of `doc` (the join handshake). */
function buildSyncStep1Frame(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  sync.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/** A sync frame carrying one CRDT update. */
function buildSyncUpdateFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  sync.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** An awareness frame carrying the given clients' states. */
function buildAwarenessFrame(awareness: Awareness, clientIDs: number[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, clientIDs));
  return encoding.toUint8Array(encoder);
}

/** Normalize a ws message payload (Buffer, fragment array, ArrayBuffer) to bytes. */
function toFrame(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data);
}

/**
 * The single outgoing-frame site for a room: the room's chaos gate
 * (drop/delay) first, then the send to the destination socket. The socket
 * state is re-checked at delivery, so a delayed frame to a closed socket
 * is a no-op there.
 */
function sendFrame(room: Room, socket: WebSocket, frame: Uint8Array): void {
  maybeChaosSend(room.chaos, () => {
    if (socket.readyState === WebSocket.OPEN) socket.send(frame);
  });
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

/** Server-side frame handling for one connection (one message per frame). */
function handleMessage(room: Room, socket: WebSocket, frame: Uint8Array): void {
  const decoder = decoding.createDecoder(frame);
  let type: number;
  try {
    type = decoding.readVarUint(decoder);
  } catch {
    return; // malformed frame: drop
  }
  if (type === MESSAGE_SYNC) {
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    try {
      sync.readSyncMessage(decoder, reply, room.doc, socket, swallowDecodeError);
    } catch {
      return;
    }
    if (encoding.length(reply) > 1) sendFrame(room, socket, encoding.toUint8Array(reply));
  } else if (type === MESSAGE_AWARENESS) {
    try {
      applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), socket);
    } catch {
      // malformed awareness frame: drop
    }
  } else if (type === MESSAGE_QUERY_AWARENESS) {
    sendFrame(room, socket, buildAwarenessFrame(room.awareness, [...room.awareness.getStates().keys()]));
  }
  // unknown frame types are ignored
}

/** Bounded bind retry: a previous relay instance may still be releasing the port. */
const MAX_BIND_ATTEMPTS = 50;
const BIND_RETRY_DELAY_MS = 100;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Start the relay on `port`; the promise rejects if the port stays taken. */
async function startRelay(port: number): Promise<RelayHandle> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await createRelay(port);
    } catch (error) {
      if (
        error instanceof Error &&
        (error as NodeJS.ErrnoException).code === "EADDRINUSE" &&
        attempt < MAX_BIND_ATTEMPTS
      ) {
        await delay(BIND_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }
}

function createRelay(port: number): Promise<RelayHandle> {
  // The ws upgrade and the HTTP control share one server (y-websocket
  // style), so the panes reach /__chaos on the relay port.
  const httpServer = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map<string, Room>();

  wss.on("connection", (socket, req) => {
    const name = new URL(req.url ?? "/", "http://localhost").pathname;
    const room = createRoom(rooms, name);
    room.sockets.add(socket);
    room.controlled.set(socket, []);
    // Standard join flow: state vector first, then the current awareness states.
    sendFrame(room, socket, buildSyncStep1Frame(room.doc));
    if (room.awareness.getStates().size > 0) {
      sendFrame(room, socket, buildAwarenessFrame(room.awareness, [...room.awareness.getStates().keys()]));
    }
    socket.on("message", (data: RawData) => handleMessage(room, socket, toFrame(data)));
    socket.on("close", () => {
      room.sockets.delete(socket);
      const ids = room.controlled.get(socket) ?? [];
      room.controlled.delete(socket);
      if (ids.length > 0) removeAwarenessStates(room.awareness, ids, null);
    });
  });

  httpServer.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (conn) => {
      wss.emit("connection", conn, req);
    });
  });

  httpServer.on("request", (req, res) => {
    handleChaosRequest(
      req,
      res,
      (name) => rooms.get(name)?.chaos,
      (name, chaos) => {
        const room = rooms.get(name);
        if (room !== undefined) room.chaos = chaos;
      }
    );
  });

  return new Promise((resolve, reject) => {
    const onListenError = (error: Error) => reject(error);
    httpServer.once("error", onListenError);
    httpServer.listen(port, () => {
      httpServer.removeListener("error", onListenError);
      resolve({
        async stop() {
          for (const socket of wss.clients) socket.close();
          await new Promise<void>((done) => wss.close(() => done()));
          for (const room of rooms.values()) room.doc.destroy(); // also destroys room.awareness
          await new Promise<void>((done) => {
            httpServer.closeAllConnections();
            httpServer.close(() => done());
          });
        },
      });
    });
  });
}

/** Decode errors inside a sync message must not tear the relay down. */
const swallowDecodeError = (): undefined => undefined;

export { startRelay };
export type { RelayHandle };
