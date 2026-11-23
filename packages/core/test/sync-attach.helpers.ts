import * as Y from "yjs";

import { createDoc, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
import type { PresenceState, SyncProvider, Unsubscribe } from "../src/sync";

/**
 * attach: doc <-> provider routing, origin-based echo suppression, detach.
 * A FakeProvider records every sent update and drives remote delivery.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

/** Encoded base state: a fresh doc with one empty paragraph (id "b0"). */
const baseState = (): Uint8Array => {
  const doc = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
  doc.insertBlock("paragraph");
  return doc.encode();
};

/** A peer loaded from the base state. */
const loadPeer = (state: Uint8Array): Doc => loadDoc(state);

/** Delta of the sender's state that the receiver is still missing. */
const deltaOf = (sender: Doc, receiver: Doc): Uint8Array => sender.encodeUpdate(Y.encodeStateVector(receiver.raw));

/**
 * A recording transport: keeps every sent update (the first is the session
 * bootstrap that attach sends at attach time) and drives remote delivery,
 * and counts lifecycle and awareness-channel calls (attach must never
 * make any of them). With `internalState()` the provider stands the
 * SyncProvider accumulated-state stand: it holds an internal Y.Doc, and
 * each new onUpdate subscription receives its full state first — but only
 * after `receiveFromWire()` marks that the provider received state from
 * the wire (the pre-connect buffered bootstrap is not "incoming").
 */
class FakeProvider implements SyncProvider {
  readonly sent: Uint8Array[] = [];
  /** Every state passed to setAwareness (attach must never call it). */
  readonly setAwarenessStates: Array<Record<string, unknown>> = [];
  /** onAwareness subscriptions (attach must never make any). */
  readonly onAwarenessCallbacks = new Set<(peers: PresenceState[]) => void>();
  connectCalls = 0;
  disconnectCalls = 0;
  #remoteCallbacks = new Set<(bytes: Uint8Array) => void>();
  #internalDoc: Y.Doc | null = null;
  #receivedSync = false;

  connect(): Promise<void> {
    this.connectCalls += 1;
    return Promise.resolve();
  }
  disconnect(): void {
    this.disconnectCalls += 1;
  }
  /**
   * Opt into the accumulated-state stand (the SyncProvider contract):
   * the provider keeps an internal doc that every sendUpdate feeds (and
   * `receiveFromWire` marks the wire reception).
   */
  internalState(): Y.Doc {
    this.#internalDoc ??= new Y.Doc();
    return this.#internalDoc;
  }
  /**
   * Simulate the socket receiving document state (a post-handshake
   * update):
   * the internal doc accumulates it, the wire-received gate stands for
   * the accumulated-state delivery at the next onUpdate subscription, and
   * the current subscribers stand the update (as the wire delivers it).
   */
  receiveFromWire(bytes: Uint8Array): void {
    this.#internalDoc ??= new Y.Doc();
    Y.applyUpdate(this.#internalDoc, bytes);
    this.#receivedSync = true;
    this.deliver(bytes);
  }
  sendUpdate(bytes: Uint8Array): void {
    this.sent.push(bytes);
    if (this.#internalDoc !== null) Y.applyUpdate(this.#internalDoc, bytes);
  }
  onUpdate(cb: (bytes: Uint8Array) => void): Unsubscribe {
    this.#remoteCallbacks.add(cb);
    if (this.#receivedSync && this.#internalDoc !== null) {
      const accumulated = Y.encodeStateAsUpdate(this.#internalDoc);
      if (accumulated.byteLength > 0) cb(accumulated);
    }
    return () => {
      this.#remoteCallbacks.delete(cb);
    };
  }
  getLocalStateVector(): Uint8Array {
    return new Uint8Array(0);
  }
  setAwareness(state: Record<string, unknown>): void {
    this.setAwarenessStates.push(state);
  }
  onAwareness(cb: (peers: PresenceState[]) => void): Unsubscribe {
    this.onAwarenessCallbacks.add(cb);
    return () => {
      this.onAwarenessCallbacks.delete(cb);
    };
  }
  /** Deliver a remote update to every registered remote callback. */
  deliver(bytes: Uint8Array): void {
    for (const cb of [...this.#remoteCallbacks]) cb(bytes);
  }
}

export { CREATED_AT, FakeProvider, baseState, deltaOf, loadPeer, makeIds };
