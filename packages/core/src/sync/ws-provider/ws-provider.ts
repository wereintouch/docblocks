/** The WebSocket sync provider: the WsSyncProvider class. The wire's frame
 *  helpers stand in ws-frames; the incoming message's handling stands in
 *  frame-handler, the awareness's handling in awareness, the offline
 *  buffer's bookkeeping in pending-buffer. */
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { DocBlocksError } from "@docblocks-core/core";

import type { PresenceState, SyncProvider, Unsubscribe } from "../models";
import { buildAwarenessFrame, buildSyncStep1Frame, buildSyncUpdateFrame } from "../ws-frames";
import { onAwarenessUpdate, remotePeers, teardownAwareness } from "./awareness";
import type { AwarenessUpdateEvent } from "./awareness";
import { handleIncomingMessage } from "./frame-handler";
import type { PendingStats, WsLike, WsSyncOptions } from "./models";
import { defaultWebSocketImpl } from "./parse";
import { PendingBuffer } from "./pending-buffer";

/**
 * Standard y-protocols over WebSocket (the y-websocket wire), wire-
 * compatible with a standard y-websocket server.
 *
 * The provider owns an internal Y.Doc: every sent and received update is
 * applied there, so `getLocalStateVector()` is honest with or without an
 * attached app document. A received update stands the app FIRST (through
 * `onUpdate`); the internal doc mirrors it only if no onUpdate listener
 * threw — a listener failure keeps the state vector behind, so the next
 * state vector exchange re-sends the missed bytes (the internal doc never
 * claims state the app's doc does not hold, or the divergence is
 * unrecoverable for the connection's life). A listener exception stands
 * visible (the app's own failure, not a malformed frame); the socket stands.
 *
 * `connect()` resolves when the socket is open and the step1 handshake is
 * sent; the initial state (step2) arrives through `onUpdate`. The promise
 * stands the current connection attempt (the concurrent/cancel/close
 * semantics stand the method's doc). Updates sent while the socket is not
 * open are buffered and flushed on the next open. There is no
 * auto-reconnect: after an unexpected close the application calls
 * `connect()` again and the step1/step2 exchange resyncs.
 *
 * Backpressure and budgets (client-side, not a security boundary — the
 * server stands the ACL and the quotas): the offline buffer holds a byte
 * count, not a copy of each update (the updates live in the internal doc
 * and are coalesced into ONE state update on the open — an offline edit
 * storm stands one flush frame); `maxPendingBytes` caps the count and sets
 * the overflow flag (getPendingStats) — the flush still sends the full
 * coalesced state. One incoming message over `maxFrameBytes` is dropped
 * whole (not decoded or applied).
 *
 * Safe attach order: `attach` registers its remote subscription before the
 * bootstrap send, so it stands correct pre-connect, mid-handshake, and
 * after the handshake (a late attach recovers the state through the
 * `onUpdate` accumulated-state delivery).
 *
 * v1 scope cuts: no reconnect backoff, no periodic resync, no socket
 * watchdog, no sync-status reporting.
 */

/** The default ceilings (4 MiB) for the offline buffer and an incoming frame. */
const DEFAULT_MAX_PENDING_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_FRAME_BYTES = 4 * 1024 * 1024;

class WsSyncProvider implements SyncProvider {
  #url: string;
  #token?: string;
  #webSocketImpl: (url: string) => WsLike;
  #doc: Y.Doc;
  #awareness: Awareness;
  #socket: WsLike | null = null;
  #open = false;
  /** The offline buffer's bookkeeping (see pending-buffer). */
  #pending: PendingBuffer;
  #maxFrameBytes: number;
  /**
   * The provider has received document state from the wire (a step2 or an
   * update). Gates the onUpdate accumulated-state delivery (a pre-connect
   * provider holds only the app doc's own buffered bootstrap — not
   * "incoming" state).
   */
  #receivedSync = false;
  /**
   * The current connection attempt (a shared Promise + its reject, while
   * the socket stands CONNECTING): concurrent connect() calls await the
   * same attempt, and a cancel/close before open settles it (reject) so
   * no caller stands pending past the attempt's end.
   */
  #connectPromise: Promise<void> | null = null;
  #connectReject: ((reason?: unknown) => void) | null = null;
  #updateListeners = new Set<(bytes: Uint8Array) => void>();
  #awarenessListeners = new Set<(peers: PresenceState[]) => void>();

  constructor(url: string, opts: WsSyncOptions = {}) {
    this.#url = url;
    this.#token = opts.token;
    this.#webSocketImpl = opts.webSocketImpl ?? defaultWebSocketImpl;
    this.#pending = new PendingBuffer(opts.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES);
    this.#maxFrameBytes = opts.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.#doc = new Y.Doc();
    this.#awareness = new Awareness(this.#doc);
    this.#awareness.on("update", this.#onAwarenessUpdate);
  }

  /**
   * Open the socket and start the sync handshake. Idempotent over an open
   * socket; concurrent calls over the CONNECTING window share one attempt
   * (the same Promise), so they settle together on the open. A cancel or
   * a close before the open rejects the shared attempt; a connect after
   * that starts a fresh one.
   */
  connect(): Promise<void> {
    if (this.#connectPromise !== null) return this.#connectPromise;
    if (this.#socket !== null) return Promise.resolve();
    const socket = this.#webSocketImpl(this.#socketUrl());
    this.#socket = socket;
    let opened = false;
    const attempt = new Promise<void>((resolve, reject) => {
      socket.onopen = () => {
        if (this.#socket !== socket) return;
        opened = true;
        this.#open = true;
        socket.send(buildSyncStep1Frame(this.#doc));
        if (this.#awareness.getLocalState() !== null) {
          socket.send(buildAwarenessFrame(this.#awareness, [this.#awareness.clientID]));
        }
        // The offline buffer's flush: the internal doc holds every buffered
        // update, so ONE coalesced state update stands the whole queue.
        if (this.#pending.hasPending) {
          socket.send(buildSyncUpdateFrame(Y.encodeStateAsUpdate(this.#doc)));
          this.#pending.flush();
        }
        // The attempt is settled: a later connect stands over the open socket.
        this.#connectPromise = null;
        this.#connectReject = null;
        resolve();
      };
      socket.onmessage = (ev) => {
        if (this.#socket !== socket) return; // stale event from a superseded socket
        this.#onMessage(ev.data);
      };
      socket.onclose = () => {
        if (this.#socket !== socket) return; // stale event from a superseded socket
        this.#onClose();
        if (!opened) {
          // An unexpected close before the open: settle the shared attempt
          // (disconnect's cancel stands the same reject; a second settle is
          // a no-op).
          this.#connectPromise = null;
          const rejectAttempt = this.#connectReject;
          this.#connectReject = null;
          if (rejectAttempt !== null) rejectAttempt(new DocBlocksError("the sync connection closed before the open"));
        }
      };
      socket.onerror = () => undefined; // transport failures surface via onclose
      // The raw reject, stored for the attempt's cancel paths (a promise
      // settles once: a second settle is a no-op). The callers clear the
      // attempt's fields before they settle it.
      this.#connectReject = reject;
    });
    this.#connectPromise = attempt;
    return attempt;
  }

  /** Close the socket. Idempotent. */
  disconnect(): void {
    if (this.#socket === null) return;
    const socket = this.#socket;
    this.#socket = null;
    this.#open = false;
    teardownAwareness(this.#awareness); // a connection ending ⇒ all remote peers left
    socket.close();
    // A cancel before the open stands the shared attempt's reject (the
    // socket's onclose guard — the cleared #socket — does not reach it).
    const cancel = this.#connectReject;
    this.#connectPromise = null;
    this.#connectReject = null;
    if (cancel !== null) cancel(new DocBlocksError("the sync connection was cancelled before the open"));
  }

  /**
   * Terminal teardown: disconnects and releases the awareness state
   * machine (including its staleness interval). Do not use the provider
   * afterwards — create a new instance instead.
   */
  destroy(): void {
    this.disconnect();
    this.#awareness.destroy();
    this.#doc.destroy(); // release the internal doc's state (terminal)
  }

  /** Send a local document update to peers (buffered while the socket is not open). */
  sendUpdate(bytes: Uint8Array): void {
    Y.applyUpdate(this.#doc, bytes);
    // The socket stands CONNECTING between connect() and the open: a raw
    // send there throws (the browser's WebSocket rejects pre-open sends),
    // so the open flag — not the socket's presence — stands the gate.
    if (this.#open && this.#socket !== null) {
      this.#socket.send(buildSyncUpdateFrame(bytes));
    } else {
      this.#pending.count(bytes.byteLength);
    }
  }

  /** The offline buffer's stats (the observable backpressure). */
  getPendingStats(): PendingStats {
    return this.#pending.stats;
  }

  /**
   * Subscribe to incoming remote document updates. The accumulated state
   * stands delivered once at subscribe time (when the provider has
   * received state from the wire — a late attach's recovery; a pre-connect
   * provider stands nothing), then every remote update as it arrives.
   * Returns unsubscribe.
   */
  onUpdate(cb: (bytes: Uint8Array) => void): Unsubscribe {
    this.#updateListeners.add(cb);
    if (this.#receivedSync) {
      const accumulated = Y.encodeStateAsUpdate(this.#doc);
      if (accumulated.byteLength > 0) cb(accumulated);
    }
    return () => {
      this.#updateListeners.delete(cb);
    };
  }

  /** The local state vector (everything sent and seen so far). */
  getLocalStateVector(): Uint8Array {
    return Y.encodeStateVector(this.#doc);
  }

  /** Push the local ephemeral peer state (presence); also works pre-connect. */
  setAwareness(state: Record<string, unknown>): void {
    this.#awareness.setLocalState(state);
  }

  /**
   * Subscribe to remote peer states (full list per change; the current
   * list stands delivered once at subscribe time). Returns unsubscribe.
   */
  onAwareness(cb: (peers: PresenceState[]) => void): Unsubscribe {
    this.#awarenessListeners.add(cb);
    cb(remotePeers(this.#awareness));
    return () => {
      this.#awarenessListeners.delete(cb);
    };
  }

  #socketUrl(): string {
    if (this.#token === undefined) return this.#url;
    const sep = this.#url.includes("?") ? "&" : "?";
    return `${this.#url}${sep}token=${encodeURIComponent(this.#token)}`;
  }

  #onClose(): void {
    if (this.#socket === null) return; // already torn down by disconnect()
    this.#socket = null;
    this.#open = false;
    teardownAwareness(this.#awareness); // a connection ending ⇒ all remote peers left
  }

  #onMessage(frame: Uint8Array): void {
    handleIncomingMessage(
      frame,
      this.#socket,
      this.#maxFrameBytes,
      this.#doc,
      this.#awareness,
      this.#updateListeners,
      () => {
        this.#receivedSync = true;
      }
    );
  }

  #onAwarenessUpdate = (event: AwarenessUpdateEvent): void => {
    onAwarenessUpdate(this.#awareness, this.#open, this.#socket, this.#awarenessListeners, event);
  };
}

export { WsSyncProvider };
