/** The minimal WebSocket surface the provider drives (WsLike) + the
 *  provider's construction options (WsSyncOptions). */

/**
 * The minimal WebSocket surface the provider drives. Browsers and Node
 * expose a structural superset; tests inject fakes.
 */
interface WsLike {
  send(data: Uint8Array): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: Uint8Array }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

interface WsSyncOptions {
  /** Appended to the socket URL as `?token=` / `&token=` (browser WS auth convention). */
  token?: string;
  /** WebSocket factory; defaults to the global WebSocket. */
  webSocketImpl?: (url: string) => WsLike;
}

export type { WsLike, WsSyncOptions };
