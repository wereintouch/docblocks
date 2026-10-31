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
  /**
   * Client-side ceiling (bytes) on the local updates buffered while the
   * socket is not open. The buffer holds a byte count and a flag (the
   * updates themselves live in the provider's internal doc and are
   * coalesced into a single state update on the open), so the count is
   * bounded bookkeeping, not a second copy of the data. When the count
   * passes the ceiling the provider sets the overflow flag (observable via
   * `getPendingStats`) — the buffered state is still flushed in full on the
   * open (nothing is dropped); the flag stands the overflow for the
   * application to surface. Defaults to 4 MiB.
   */
  maxPendingBytes?: number;
  /**
   * Client-side ceiling (bytes) on one incoming socket message. A message
   * over the ceiling is dropped whole (not decoded or applied). The
   * provider's limits are client-side backpressure, not a security
   * boundary — the server stands the ACL and the quotas. Defaults to 4 MiB.
   */
  maxFrameBytes?: number;
}

/** The provider's pending-buffer stats (the observable backpressure). */
interface PendingStats {
  /** The buffered (not-yet-flushed) local update bytes. */
  pendingBytes: number;
  /** True once `pendingBytes` passed `maxPendingBytes` (cleared on the flush). */
  overflow: boolean;
}

export type { PendingStats, WsLike, WsSyncOptions };
