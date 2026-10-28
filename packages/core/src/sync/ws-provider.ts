import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { Awareness, applyAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";

import type { PresenceSelection, PresenceState, SyncProvider, Unsubscribe } from "./provider";
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  buildAwarenessFrame,
  buildSyncStep1Frame,
  buildSyncUpdateFrame,
  concatFrames,
} from "./ws-frames";

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

/**
 * Standard y-protocols over WebSocket (the y-websocket wire), wire-
 * compatible with a standard y-websocket server.
 *
 * The provider owns an internal Y.Doc: every sent and received update is
 * applied there, so `getLocalStateVector()` is honest with or without an
 * attached app document. App documents receive updates through `onUpdate`
 * (the attach glue applies them).
 *
 * `connect()` resolves when the socket is open and the step1 handshake is
 * sent; the initial state (step2) arrives through `onUpdate`. The promise
 * stands the CURRENT connection attempt: concurrent calls over the
 * CONNECTING window await the same attempt (they settle together on the
 * open), a cancel (`disconnect`) or a close before the open rejects it,
 * and a connect after that starts a fresh attempt. Updates sent while the
 * socket is not open (before `connect()`, or during the CONNECTING window)
 * are buffered and flushed on the next open. There is no auto-reconnect:
 * after an unexpected close the application calls `connect()` again and the
 * step1/step2 exchange resyncs.
 *
 * Safe attach order: `attach` registers its remote subscription before the
 * bootstrap send, so it stands correct pre-connect (the bootstrap buffered
 * until open), mid-handshake, and after the handshake — a late attach over
 * a provider that already holds room state recovers the state through the
 * `onUpdate` accumulated-state delivery.
 *
 * v1 scope cuts: no reconnect backoff, no periodic resync, no socket
 * watchdog, no sync-status reporting.
 */
class WsSyncProvider implements SyncProvider {
  #url: string;
  #token?: string;
  #webSocketImpl: (url: string) => WsLike;
  #doc: Y.Doc;
  #awareness: Awareness;
  #socket: WsLike | null = null;
  #open = false;
  #pending: Uint8Array[] = [];
  /**
   * The provider has received document state from the wire (a step2 or an
   * update). Gates the onUpdate accumulated-state delivery: a pre-connect
   * provider holds only the app doc's own buffered bootstrap, which is not
   * "incoming" state — delivering it would stand the doc's own bytes as a
   * remote update.
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
        const pending = this.#pending;
        this.#pending = [];
        for (const update of pending) socket.send(buildSyncUpdateFrame(update));
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
          if (rejectAttempt !== null) rejectAttempt(new Error("sync connection closed before open"));
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
    this.#teardown();
    socket.close();
    // A cancel before the open stands the shared attempt's reject (the
    // socket's onclose guard — the cleared #socket — does not reach it).
    const cancel = this.#connectReject;
    this.#connectPromise = null;
    this.#connectReject = null;
    if (cancel !== null) cancel(new Error("sync connection cancelled before open"));
  }

  /**
   * Terminal teardown: disconnects and releases the awareness state
   * machine (including its staleness interval). Do not use the provider
   * afterwards — create a new instance instead.
   */
  destroy(): void {
    this.disconnect();
    this.#awareness.destroy();
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
      this.#pending.push(bytes);
    }
  }

  /**
   * Subscribe to incoming remote document updates. The provider's
   * accumulated state stands delivered once at subscribe time, when the
   * provider has received state from the wire (`#receivedSync`) — a late
   * attach recovers the room's state over the CRDT merge (the app doc's own
   * items stand a no-op re-apply); a pre-connect provider stands nothing
   * (its internal state is the app doc's own buffered bootstrap, not
   * incoming state). Then every remote update stands as it arrives.
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
   * Subscribe to remote peer states (full list per change). The current
   * list is delivered once at subscribe time, then on every change.
   * Returns unsubscribe.
   */
  onAwareness(cb: (peers: PresenceState[]) => void): Unsubscribe {
    this.#awarenessListeners.add(cb);
    cb(this.#remotePeers());
    return () => {
      this.#awarenessListeners.delete(cb);
    };
  }

  #socketUrl(): string {
    if (this.#token === undefined) return this.#url;
    const sep = this.#url.includes("?") ? "&" : "?";
    return `${this.#url}${sep}token=${encodeURIComponent(this.#token)}`;
  }

  /** A connection ending (either side) ⇒ all remote peers of the room left. */
  #teardown(): void {
    const own = this.#awareness.clientID;
    const remotes = [...this.#awareness.states.keys()].filter((id) => id !== own);
    if (remotes.length > 0) removeAwarenessStates(this.#awareness, remotes, "socket closed");
  }

  #onClose(): void {
    if (this.#socket === null) return; // already torn down by disconnect()
    this.#socket = null;
    this.#open = false;
    this.#teardown();
  }

  #onMessage(frame: Uint8Array): void {
    if (this.#socket === null) return;
    const decoder = decoding.createDecoder(frame);
    const replies: Uint8Array[] = [];
    try {
      // A socket message may carry several concatenated frames.
      while (decoding.hasContent(decoder)) {
        const type = decoding.readVarUint(decoder);
        if (type === MESSAGE_SYNC) {
          const syncPos = decoder.pos;
          const reply = encoding.createEncoder();
          encoding.writeVarUint(reply, MESSAGE_SYNC);
          const syncType = sync.readSyncMessage(decoder, reply, this.#doc, this, swallowDecodeError);
          if (encoding.length(reply) > 1) replies.push(encoding.toUint8Array(reply));
          if (syncType === sync.messageYjsSyncStep2 || syncType === sync.messageYjsUpdate) {
            // The provider holds wire state now: the late attach's
            // accumulated-state delivery stands (the onUpdate contract).
            this.#receivedSync = true;
            // The app applies the same raw update bytes attach receives.
            const sub = decoding.createDecoder(frame);
            sub.pos = syncPos;
            decoding.readVarUint(sub); // sync message type
            this.#emitUpdate(decoding.readVarUint8Array(sub));
          }
        } else if (type === MESSAGE_AWARENESS) {
          applyAwarenessUpdate(this.#awareness, decoding.readVarUint8Array(decoder), null);
        } else if (type === MESSAGE_QUERY_AWARENESS) {
          replies.push(buildAwarenessFrame(this.#awareness, [this.#awareness.clientID]));
        }
        // auth and unknown types are ignored (forward compatibility)
      }
    } catch {
      return; // malformed frame: drop the rest of the batch, keep the connection
    }
    const out = concatFrames(replies);
    if (out !== null) this.#socket.send(out);
  }

  #onAwarenessUpdate = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }): void => {
    const changed = [...added, ...updated, ...removed];
    // The open flag's gate (as in sendUpdate): the pre-open awareness
    // stands resent over the open handshake (the local state's frame).
    if (changed.length > 0 && this.#open && this.#socket !== null) {
      this.#socket.send(buildAwarenessFrame(this.#awareness, changed));
    }
    this.#emitAwareness();
  };

  #remotePeers(): PresenceState[] {
    const own = this.#awareness.clientID;
    const peers: PresenceState[] = [];
    this.#awareness.states.forEach((state, clientID) => {
      if (clientID === own) return;
      peers.push({
        peerId: String(clientID),
        selection: parseSelection(state.selection),
        updatedAt: typeof state.updatedAt === "number" ? state.updatedAt : 0,
      });
    });
    return peers;
  }

  #emitUpdate(bytes: Uint8Array): void {
    for (const cb of [...this.#updateListeners]) cb(bytes);
  }

  #emitAwareness(): void {
    const peers = this.#remotePeers();
    for (const cb of [...this.#awarenessListeners]) cb(peers);
  }
}

/** Decode errors inside a sync message do not tear the connection down. */
const swallowDecodeError = (): undefined => undefined;

const isPoint = (value: unknown): value is { blockId: string; offset: number } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).blockId === "string" &&
  typeof (value as Record<string, unknown>).offset === "number";

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

/** Validate an untrusted wire selection; null when the shape is not one of the wire forms. */
function parseSelection(value: unknown): PresenceSelection | null {
  if (typeof value !== "object" || value === null) return null;
  const sel = value as Record<string, unknown>;
  if (typeof sel.blockId === "string" && typeof sel.offset === "number") {
    return { blockId: sel.blockId, offset: sel.offset };
  }
  if (isPoint(sel.from) && isPoint(sel.to)) {
    const range: PresenceSelection = { from: sel.from, to: sel.to };
    if (isStringArray(sel.blocks)) range.blocks = [...sel.blocks];
    return range;
  }
  if (isStringArray(sel.blocks)) return { blocks: [...sel.blocks] };
  return null;
}

/** The default socket factory: the global WebSocket, normalized to WsLike. */
const defaultWebSocketImpl = (url: string): WsLike => {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const like: WsLike = {
    send: (data: Uint8Array) => ws.send(data as Uint8Array<ArrayBuffer>),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.onopen = (ev) => like.onopen?.(ev);
  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) like.onmessage?.({ data: new Uint8Array(ev.data) });
    // non-binary frames carry no sync payload
  };
  ws.onclose = (ev) => like.onclose?.(ev);
  ws.onerror = (ev) => like.onerror?.(ev);
  return like;
};

export { WsSyncProvider };
export type { WsLike, WsSyncOptions };
