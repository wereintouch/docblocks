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
 * outgoing room frame passes one send site (sendFrame over relay-frames),
 * which applies the room's chaos gate first: `drop` skips the frame with a
 * probability, `delay` defers it — chaos is a frame-delivery concern, the
 * sockets stay up. The room's lifecycle stands over relay-rooms, the frame
 * plumbing over relay-frames, and the trust gate over relay-auth.
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import type { RawData } from "ws";
import { removeAwarenessStates } from "y-protocols/awareness";

import { handleChaosRequest, isLocalOrigin } from "./chaos.ts";
import { firstHeader, isLoopbackHost, tokenMatches } from "./relay-auth.ts";
import { buildAwarenessFrame, buildSyncStep1Frame, handleMessage, sendFrame, toFrame } from "./relay-frames.ts";
import { createRoom, scheduleEmptyRoomTtl } from "./relay-rooms.ts";
import type { Room } from "./relay-rooms.ts";

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

export { startRelay };
export type { RelayHandle, RelayOptions };
