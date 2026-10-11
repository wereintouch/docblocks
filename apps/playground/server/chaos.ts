import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Per-room chaos for the dev relay: fault injection at the frame delivery
 * layer (drop or delay outgoing frames — the sockets stay up). A chaos
 * setting is a property of a live room: the room exists once a client
 * connects, so the HTTP control refuses to create rooms and answers 404
 * for unknown ones.
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
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/__chaos") {
    respond(res, 404, { error: "not found" });
    return;
  }
  if (req.method === "GET") {
    const room = url.searchParams.get("room");
    const chaos = room === null ? undefined : getChaos(room);
    if (chaos === undefined) {
      respond(res, 404, { error: "unknown room" });
      return;
    }
    respond(res, 200, chaos);
    return;
  }
  if (req.method === "POST") {
    void readBody(req).then((body) => {
      let parsed: { room?: unknown; mode?: unknown };
      try {
        parsed = JSON.parse(body) as { room?: unknown; mode?: unknown };
      } catch {
        respond(res, 400, { error: "invalid JSON body" });
        return;
      }
      const chaos = chaosForMode(typeof parsed.mode === "string" ? parsed.mode : undefined);
      if (typeof parsed.room !== "string" || chaos === null) {
        respond(res, 400, { error: "body needs a room name and a mode (none | drop50 | delay500)" });
        return;
      }
      if (getChaos(parsed.room) === undefined) {
        respond(res, 404, { error: "unknown room" });
        return;
      }
      setChaos(parsed.room, chaos);
      respond(res, 200, chaos);
    });
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  respond(res, 405, { error: "method not allowed" });
}

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json",
};

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, CORS_HEADERS);
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export { DEFAULT_CHAOS, chaosForMode, handleChaosRequest, maybeChaosSend };
export type { ChaosConfig, ChaosMode };
