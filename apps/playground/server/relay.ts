import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";

import { type ChaosConfig, DEFAULT_CHAOS, handleChaosRequest, isLocalOrigin, maybeChaosSend } from "./chaos.ts";

/**
 * Standard y-protocols relay hosted inside the playground dev server.
 *
 * Dev-only: the relay is a local sync harness for the playground panes and
 * the E2E suite — it is not a network service. It binds loopback
 * (127.0.0.1) by default; an explicit non-loopback bind requires a token
 * (see startRelay / vite.config.ts), which gates the ws upgrade and the HTTP
 * control. The ws upgrade and the HTTP control additionally accept local
 * origins only (a foreign page cannot open a room or drive the control),
 * and the relay is bounded: a per-frame payload ceiling, caps on the live
 * rooms and sockets, a TTL that destroys empty rooms, and a bounded HTTP
 * control body (see the constants below and chaos.ts).
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

/**
 * The dev relay's resource limits + trust boundary (it must not be a
 * network DoS vector): a per-frame ceiling on ws messages, caps on the
 * live rooms and sockets, and a TTL that destroys a room once its last
 * socket leaves. The relay binds loopback by default; an explicit
 * non-loopback bind requires a token (see startRelay), which gates the ws
 * upgrade and the HTTP control.
 */
const MAX_FRAME_BYTES = 4 * 1024 * 1024; // 4 MiB per ws frame
const MAX_ROOMS = 200; // live rooms
const MAX_CONNECTIONS = 500; // live sockets
const EMPTY_ROOM_TTL_MS = 60_000; // destroy an empty room after 60 s

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

interface RelayHandle {
  stop(): Promise<void>;
}

interface RelayOptions {
  /** Bind host (default 127.0.0.1 — loopback only). */
  host?: string;
  /**
   * An auth token required on the ws upgrade (a `?token=` query param) and
   * the HTTP control (an `x-relay-token` header). Required — and enforced
   * — whenever the host is non-loopback; ignored (and rejected) otherwise,
   * so the loopback dev default stays tokenless.
   */
  token?: string;
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

/**
 * Schedule the empty-room TTL: when a room's last socket leaves, the room
 * (its doc + awareness) is destroyed after EMPTY_ROOM_TTL_MS so idle rooms
 * do not accumulate for the dev server's lifetime. A rejoining socket
 * clears the pending timer (createRoom / the connection handler). The timer
 * is unref'd so it never keeps the process alive.
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

/** True when the bind host is a loopback address (127.0.0.1 / ::1 / localhost). */
function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/** The token gate for a non-loopback bind: the ws upgrade carries the token
 * as a `?token=` query param, the HTTP control as an `x-relay-token` header. */
function tokenMatches(url: string | null | undefined, header: string | undefined, token: string): boolean {
  if (header === token) return true;
  if (url !== null && url !== undefined) {
    try {
      return new URL(url, "http://localhost").searchParams.get("token") === token;
    } catch {
      return false;
    }
  }
  return false;
}

/** Normalize a (possibly multi-valued) header to its first string value. */
function firstHeader(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header;
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

/** Start the relay on `port` (loopback by default; see RelayOptions). The promise rejects if the port stays taken. */
async function startRelay(port: number, options: RelayOptions = {}): Promise<RelayHandle> {
  const host = options.host ?? "127.0.0.1";
  // The trust boundary: an explicit non-loopback bind requires a token. The
  // loopback default (the dev harness) is tokenless. Fail fast rather than
  // expose an open relay.
  if (!isLoopbackHost(host) && (options.token === undefined || options.token === "")) {
    throw new Error(`the relay cannot bind ${host} (non-loopback) without a token`);
  }
  const token = options.token;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await createRelay(port, host, token);
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

function createRelay(port: number, host: string, token: string | undefined): Promise<RelayHandle> {
  // The ws upgrade and the HTTP control share one server (y-websocket
  // style), so the panes reach /__chaos on the relay port.
  const httpServer = createServer();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const rooms = new Map<string, Room>();
  let liveSockets = 0;

  // The trust gate for the ws upgrade: the token (when a non-loopback bind
  // is configured) and the local-origin check (a foreign page cannot open a
  // room). Non-browser clients carry no Origin and are admitted.
  const upgradeAuthorized = (
    url: string | null | undefined,
    origin: string | null | undefined,
    header: string | undefined
  ): boolean => {
    if (token !== undefined && !tokenMatches(url, header, token)) return false;
    return isLocalOrigin(origin);
  };

  wss.on("connection", (socket, req) => {
    liveSockets += 1;
    const reject = (reason: string): void => {
      liveSockets -= 1;
      try {
        socket.close(1013, reason);
      } catch {
        socket.terminate();
      }
    };
    if (liveSockets > MAX_CONNECTIONS) {
      reject("connection limit");
      return;
    }
    const name = new URL(req.url ?? "/", "http://localhost").pathname;
    // Room cap: enforced for a not-yet-existing room only (an empty room
    // pending its TTL still counts until it is destroyed).
    if (!rooms.has(name) && rooms.size >= MAX_ROOMS) {
      reject("room limit");
      return;
    }
    const room = createRoom(rooms, name);
    if (room.emptyTtl !== undefined) {
      clearTimeout(room.emptyTtl);
      room.emptyTtl = undefined; // a socket rejoined: cancel the empty-room TTL
    }
    room.sockets.add(socket);
    room.controlled.set(socket, []);
    // Standard join flow: state vector first, then the current awareness states.
    sendFrame(room, socket, buildSyncStep1Frame(room.doc));
    if (room.awareness.getStates().size > 0) {
      sendFrame(room, socket, buildAwarenessFrame(room.awareness, [...room.awareness.getStates().keys()]));
    }
    socket.on("message", (data: RawData) => handleMessage(room, socket, toFrame(data)));
    socket.on("close", () => {
      liveSockets -= 1;
      room.sockets.delete(socket);
      const ids = room.controlled.get(socket) ?? [];
      room.controlled.delete(socket);
      if (ids.length > 0) removeAwarenessStates(room.awareness, ids, null);
      if (room.sockets.size === 0) scheduleEmptyRoomTtl(rooms, name);
    });
  });

  httpServer.on("upgrade", (req, socket, head) => {
    if (!upgradeAuthorized(req.url, req.headers.origin, firstHeader(req.headers["x-relay-token"]))) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (conn) => {
      wss.emit("connection", conn, req);
    });
  });

  httpServer.on("request", (req, res) => {
    // The token gate for the HTTP control (the local-origin check stands
    // inside handleChaosRequest).
    if (token !== undefined && !tokenMatches(req.url, firstHeader(req.headers["x-relay-token"]), token)) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "forbidden" }));
      return;
    }
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
    httpServer.listen(port, host, () => {
      httpServer.removeListener("error", onListenError);
      resolve({
        async stop() {
          for (const socket of wss.clients) socket.close();
          await new Promise<void>((done) => wss.close(() => done()));
          for (const room of rooms.values()) {
            if (room.emptyTtl !== undefined) clearTimeout(room.emptyTtl);
            room.doc.destroy(); // also destroys room.awareness
          }
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
export type { RelayHandle, RelayOptions };
