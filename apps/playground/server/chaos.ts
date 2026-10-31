import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Per-room chaos for the dev relay: fault injection at the frame delivery
 * layer (drop or delay outgoing frames — the sockets stay up). A chaos
 * setting is a property of a live room: the room exists once a client
 * connects, so the HTTP control refuses to create rooms and answers 404
 * for unknown ones.
 *
 * The relay is a dev-only, loopback-bound server (see relay.ts): the
 * control surface accepts local origins only (no permissive CORS), and the
 * request body is bounded (an oversized body stands 413).
 */

type ChaosMode = "none" | "drop" | "delay";

/** Per-room chaos config (the /__chaos JSON shape). */
interface ChaosConfig {
  mode: ChaosMode;
  dropRate: number;
  delayMs: number;
}

/** Off: every frame goes out immediately. */
const DEFAULT_CHAOS: ChaosConfig = { mode: "none", dropRate: 0, delayMs: 0 };

/** The HTTP mode names mapped to a config (the POST /__chaos body values). */
const CHAOS_MODES: Record<"none" | "drop50" | "delay500", ChaosConfig> = {
  none: { mode: "none", dropRate: 0, delayMs: 0 },
  drop50: { mode: "drop", dropRate: 0.5, delayMs: 0 },
  delay500: { mode: "delay", dropRate: 0, delayMs: 500 },
};

/** Resolve a requested mode name to a config; null for an unknown mode. */
function chaosForMode(mode: string | undefined): ChaosConfig | null {
  if (mode === "none" || mode === "drop50" || mode === "delay500") return CHAOS_MODES[mode];
  return null;
}

/**
 * Apply a room's chaos gate to one outgoing frame. `drop` skips the frame
 * with probability dropRate; `delay` defers delivery by delayMs (a plain
 * setTimeout — delayed frames may interleave with other room traffic).
 * `deliver` performs the send itself, including the socket state check,
 * so a delayed frame to a closed socket is a no-op there.
 */
function maybeChaosSend(chaos: ChaosConfig, deliver: () => void): void {
  if (chaos.mode === "drop") {
    if (Math.random() < chaos.dropRate) return;
    deliver();
    return;
  }
  if (chaos.mode === "delay") {
    // unref: a pending delay must not keep the relay process alive after stop().
    setTimeout(deliver, chaos.delayMs).unref();
    return;
  }
  deliver();
}

/**
 * The relay's HTTP control surface on the ws port (the browser panes reach
 * it as a cross-origin fetch, so every answer carries CORS headers):
 *
 *   GET  /__chaos?room=<name> — the room's chaos JSON (404 for an unknown
 *                               room, the control does not create rooms)
 *   POST /__chaos             — body { room, mode }, mode one of
 *                               none | drop50 | delay500; applies the mode
 *                               and returns the room's chaos JSON
 */
function handleChaosRequest(
  req: IncomingMessage,
  res: ServerResponse,
  getChaos: (room: string) => ChaosConfig | undefined,
  setChaos: (room: string, chaos: ChaosConfig) => void
): void {
  const origin = req.headers.origin;
  // The local-origin gate: a foreign origin is refused before any answer
  // (403, no CORS headers) — a cross-origin page cannot drive the control.
  if (!isLocalOrigin(origin)) {
    respond(res, 403, { error: "forbidden origin" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/__chaos") {
    respond(res, 404, { error: "not found" }, origin);
    return;
  }
  if (req.method === "GET") {
    const room = url.searchParams.get("room");
    const chaos = room === null ? undefined : getChaos(room);
    if (chaos === undefined) {
      respond(res, 404, { error: "unknown room" }, origin);
      return;
    }
    respond(res, 200, chaos, origin);
    return;
  }
  if (req.method === "POST") {
    void readBody(req)
      .then(({ body, truncated }) => {
        if (truncated) {
          respond(res, 413, { error: "request body too large" }, origin);
          // Abort the (draining) upload once the 413 is flushed — destroying
          // the request before the response is written would stand ECONNRESET
          // instead of the 413.
          res.on("finish", () => req.destroy());
          res.on("close", () => req.destroy());
          return;
        }
        let parsed: { room?: unknown; mode?: unknown };
        try {
          parsed = JSON.parse(body) as { room?: unknown; mode?: unknown };
        } catch {
          respond(res, 400, { error: "invalid JSON body" }, origin);
          return;
        }
        const chaos = chaosForMode(typeof parsed.mode === "string" ? parsed.mode : undefined);
        if (typeof parsed.room !== "string" || chaos === null) {
          respond(res, 400, { error: "body needs a room name and a mode (none | drop50 | delay500)" }, origin);
          return;
        }
        if (getChaos(parsed.room) === undefined) {
          respond(res, 404, { error: "unknown room" }, origin);
          return;
        }
        setChaos(parsed.room, chaos);
        respond(res, 200, chaos, origin);
      })
      .catch(() => {
        respond(res, 500, { error: "internal error" }, origin);
      });
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, localCorsHeaders(origin));
    res.end();
    return;
  }
  respond(res, 405, { error: "method not allowed" }, origin);
}

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json",
};

/** The control body's ceiling (the chaos JSON is tiny; the cap bounds the
 * accumulated body — an oversized body stands 413, never an unbounded
 * buffer). */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * The local-origin gate: the relay is dev-only and loopback-bound, so a
 * request is local when its Origin is absent (a non-browser client: curl,
 * node) or its host is a loopback / localhost name. A foreign origin is
 * refused (the upgrade is dropped, the control answers 403 with no CORS
 * headers, so a cross-origin page cannot read or drive the control).
 */
function isLocalOrigin(origin: string | null | undefined): boolean {
  if (origin === null || origin === undefined) return true;
  try {
    // IPv6 loopback arrives bracketed ("[::1]") from URL.hostname.
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

/** The response headers for a local request: the standard CORS set with
 * the Origin echoed back (a cross-origin local page reads its own answer).
 * `origin` is the requesting origin (absent for a non-browser client). */
function localCorsHeaders(origin: string | null | undefined): Record<string, string> {
  if (origin === null || origin === undefined) return CORS_HEADERS;
  return { "access-control-allow-origin": origin, ...CORS_HEADERS };
}

function respond(res: ServerResponse, status: number, body: unknown, origin?: string | null): void {
  res.writeHead(status, localCorsHeaders(origin));
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<{ body: string; truncated: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    // Never reject (an unhandled rejection would tear the relay down); an
    // error / abort settles with what was read, and the caller always ends
    // the response. An oversized body stops buffering (the rest drains,
    // discarded) so the buffer stays bounded — the caller sends 413 and
    // destroys the request after the response is flushed.
    const settle = (truncated: boolean): void => {
      if (settled) return;
      settled = true;
      resolve({ body: Buffer.concat(chunks).toString("utf8"), truncated });
    };
    req.on("data", (chunk: Buffer) => {
      if (settled) return; // the body is draining; discard the rest
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settle(true);
        req.resume(); // keep draining (discarding) so the socket does not stall
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => settle(false));
    req.on("error", () => settle(false));
  });
}

export { DEFAULT_CHAOS, chaosForMode, handleChaosRequest, isLocalOrigin, maybeChaosSend };
export type { ChaosConfig, ChaosMode };
