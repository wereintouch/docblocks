/**
 * Local typing of the untyped CJS subpath `y-websocket/bin/utils` (the
 * classic relay) — the exports the real-server spec uses, per the
 * package's `bin/utils.cjs`.
 */
declare module "y-websocket/bin/utils" {
  import type { IncomingMessage } from "node:http";
  import type { WebSocket } from "ws";

  /** The relay's shared doc (a WSSharedDoc: a Y.Doc with its name and its per-doc awareness). */
  interface WSSharedDoc {
    name: string;
    awareness: { destroy(): void };
    destroy(): void;
  }

  /** One shared doc per URL path, keyed by the doc name. */
  export const docs: Map<string, WSSharedDoc>;
  /** Wires one WebSocket connection into the relay (docName defaults to the URL path without the leading slash). */
  export function setupWSConnection(
    conn: WebSocket,
    req: IncomingMessage,
    opts?: { docName?: string; gc?: boolean }
  ): void;
}
