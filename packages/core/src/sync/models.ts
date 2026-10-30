import type { BlockId } from "@docblocks-core/schema";

/** Unsubscribes a subscription. Safe to call more than once. */
type Unsubscribe = () => void;

/**
 * Selection in the presence wire form: a JSON-serializable subset of the
 * view selection — a caret, a range, or a block-level selection.
 * `reverse` (drag direction) is UX-only and never travels the wire.
 */
type PresenceSelection =
  | { blockId: BlockId; offset: number }
  | {
      from: { blockId: BlockId; offset: number };
      to: { blockId: BlockId; offset: number };
      blocks?: BlockId[];
    }
  | { blocks: BlockId[] };

/** Ephemeral state of a peer (awareness payload, per peer and document). */
interface PresenceState {
  /** Provider-assigned peer identifier. */
  peerId: string;
  selection: PresenceSelection | null;
  /** Unix milliseconds. Staleness handling (TTL) is a consumer concern. */
  updatedAt: number;
}

/**
 * Transport for syncing one document with peers.
 *
 * `sendUpdate` pushes local CRDT updates; `onUpdate` delivers incoming
 * REMOTE updates only — local edits must never come back through it.
 * `connect`/`disconnect` own the provider's lifecycle: the application
 * orchestrates them, `attach` never calls them. Awareness is a direct
 * application↔provider channel: `setAwareness` pushes the local ephemeral
 * peer state, `onAwareness` reports the remote peers'.
 *
 * Safe attach order: `attach` registers its remote subscription before
 * sending the bootstrap, so it works pre-connect (the bootstrap stands
 * buffered), mid-handshake, and after the handshake — a late attach over
 * a provider that already holds room state recovers the state through the
 * `onUpdate` accumulated-state delivery.
 */
interface SyncProvider {
  /** Establish the transport connection. Must complete before use. */
  connect(): Promise<void>;
  /** Release the transport connection. Idempotent. */
  disconnect(): void;
  /** Send a local document update to peers. */
  sendUpdate(bytes: Uint8Array): void;
  /**
   * Subscribe to incoming remote document updates. The provider's
   * accumulated state — the state it has received from the wire (if any) —
   * stands delivered once at subscribe time (a late attach must recover
   * the state the provider received before the subscription; the same
   * stand as `onAwareness` delivering the current list), then every remote
   * update as it arrives. A provider that has not received wire state yet
   * (pre-connect, its internal state stands the app doc's own buffered
   * bootstrap) stands nothing at subscribe time. Local edits must never
   * come back through it. Returns unsubscribe.
   */
  onUpdate(cb: (bytes: Uint8Array) => void): Unsubscribe;
  /** The local state vector (what the local document has seen). */
  getLocalStateVector(): Uint8Array;
  /** Push the local ephemeral peer state (presence). */
  setAwareness(state: Record<string, unknown>): void;
  /** Subscribe to remote peer states. Returns unsubscribe. */
  onAwareness(cb: (peers: PresenceState[]) => void): Unsubscribe;
}

export type { PresenceSelection, PresenceState, SyncProvider, Unsubscribe };
