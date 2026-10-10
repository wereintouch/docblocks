import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createDoc, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
import { attach } from "../src/sync";
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
 * make any of them).
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

  connect(): Promise<void> {
    this.connectCalls += 1;
    return Promise.resolve();
  }
  disconnect(): void {
    this.disconnectCalls += 1;
  }
  sendUpdate(bytes: Uint8Array): void {
    this.sent.push(bytes);
  }
  onUpdate(cb: (bytes: Uint8Array) => void): Unsubscribe {
    this.#remoteCallbacks.add(cb);
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

describe("local -> provider routing", () => {
  it("sends a local edit exactly once, and the sent bytes converge a fresh peer", () => {
    const state = baseState();
    const doc1 = loadPeer(state);
    const provider = new FakeProvider();
    attach(doc1, provider);
    expect(provider.sent).toHaveLength(1); // the attach bootstrap

    doc1.insertText("b0", 0, "hello");

    expect(provider.sent).toHaveLength(2); // bootstrap + the edit
    const peer = loadPeer(state);
    for (const update of provider.sent) peer.applyUpdate(update);
    expect(peer.toJSON()).toEqual(doc1.toJSON());
  });

  it("N commands inside one transact produce exactly one sendUpdate", () => {
    const state = baseState();
    const doc1 = loadPeer(state);
    const provider = new FakeProvider();
    attach(doc1, provider);

    doc1.transact(() => {
      doc1.insertText("b0", 0, "hello ");
      doc1.insertText("b0", 6, "world");
      doc1.setMark("b0", 0, 5, { type: "bold" });
    });

    expect(provider.sent).toHaveLength(2); // bootstrap + one batched batch
    expect(doc1.getText("b0")).toBe("hello world");
  });

  it("two providers attached to one doc both receive every local edit", () => {
    const state = baseState();
    const doc1 = loadPeer(state);
    const a = new FakeProvider();
    const b = new FakeProvider();
    attach(doc1, a);
    attach(doc1, b);

    doc1.insertText("b0", 0, "hello");

    expect(a.sent).toHaveLength(2);
    expect(b.sent).toHaveLength(2);
    expect(a.sent[0]).toEqual(b.sent[0]); // same bootstrap state
  });
});

describe("provider -> doc routing (remote)", () => {
  it("applies a remote update and sends nothing back (no echo)", () => {
    const state = baseState();
    const doc1 = loadPeer(state);
    const doc2 = loadPeer(state);
    const provider = new FakeProvider();
    attach(doc1, provider);

    doc2.insertText("b0", 0, "remote");
    provider.deliver(deltaOf(doc2, doc1));

    expect(doc1.getText("b0")).toBe("remote");
    expect(provider.sent).toHaveLength(1); // the bootstrap only: no echo of the remote delivery
  });

  it("a double delivery of the same bytes is a no-op and still sends nothing", () => {
    const state = baseState();
    const doc1 = loadPeer(state);
    const doc2 = loadPeer(state);
    const provider = new FakeProvider();
    attach(doc1, provider);

    doc2.insertText("b0", 0, "remote");
    const delta = deltaOf(doc2, doc1);
    provider.deliver(delta);
    const after = doc1.toJSON();
    provider.deliver(delta);

    expect(doc1.toJSON()).toEqual(after);
    expect(provider.sent).toHaveLength(1); // the bootstrap only
  });

  it("remote updates do not pollute the local undo history", () => {
    const state = baseState();
    const doc1 = loadPeer(state);
    const doc2 = loadPeer(state);
    const provider = new FakeProvider();
    attach(doc1, provider);

    doc1.insertText("b0", 0, "local");
    expect(doc1.canUndo).toBe(true);

    doc2.insertText("b0", 0, "remote");
    provider.deliver(deltaOf(doc2, doc1));
    expect(provider.sent).toHaveLength(2); // bootstrap + local edit; the remote delivery does not echo

    doc1.undo();

    // The local edit is undone and the remote one survives: doc1
    // converges exactly to doc2's state.
    expect(doc1.toJSON()).toEqual(doc2.toJSON());
    expect(provider.sent).toHaveLength(3); // the undo's inverse is sent as an update
  });

  it("a local undo after a remote edit sends the inverse, and a third peer converges", () => {
    const state = baseState();
    const doc1 = loadPeer(state);
    const doc2 = loadPeer(state);
    const provider = new FakeProvider();
    attach(doc1, provider);

    doc1.insertText("b0", 0, "local");
    doc2.insertText("b0", 0, "remote");
    const remoteDelta = deltaOf(doc2, doc1);
    provider.deliver(remoteDelta);
    expect(provider.sent).toHaveLength(2); // bootstrap + local edit

    doc1.undo();
    expect(provider.sent).toHaveLength(3);

    // A third peer that receives every update on the wire (the remote edit
    // plus everything doc1 sent) converges to doc1's final state.
    const peer = loadPeer(state);
    for (const update of [remoteDelta, ...provider.sent]) peer.applyUpdate(update);
    expect(peer.toJSON()).toEqual(doc1.toJSON());
  });
});

describe("detach", () => {
  it("stops both routing directions, is idempotent, and leaves the provider connected", () => {
    const state = baseState();
    const doc1 = loadPeer(state);
    const doc2 = loadPeer(state);
    const provider = new FakeProvider();
    const session = attach(doc1, provider);

    doc1.insertText("b0", 0, "a");
    expect(provider.sent).toHaveLength(2); // bootstrap + edit

    session.detach();
    session.detach(); // idempotent
    expect(provider.disconnectCalls).toBe(0);

    doc1.insertText("b0", 1, "b");
    expect(provider.sent).toHaveLength(2); // no more sends

    doc2.insertText("b0", 0, "r");
    provider.deliver(deltaOf(doc2, doc1));
    expect(doc1.getText("b0")).toBe("ab"); // remote bytes no longer applied
  });

  it("a fresh attach after detach routes again", () => {
    const state = baseState();
    const doc1 = loadPeer(state);
    const doc2 = loadPeer(state);
    const first = new FakeProvider();
    const session = attach(doc1, first);
    session.detach();

    const second = new FakeProvider();
    attach(doc1, second);

    doc1.insertText("b0", 0, "c");
    expect(second.sent).toHaveLength(2); // the second attach's bootstrap + the edit
    expect(first.sent).toHaveLength(1); // the first session's bootstrap only; detach stopped routing

    doc2.insertText("b0", 0, "r");
    second.deliver(deltaOf(doc2, doc1));
    expect(doc1.getText("b0")).toContain("r");
    expect(second.sent).toHaveLength(2); // no echo of the remote edit
  });
});

describe("attach boundaries", () => {
  it("never touches the provider lifecycle or the awareness channel", () => {
    const state = baseState();
    const doc1 = loadPeer(state);
    const doc2 = loadPeer(state);
    const provider = new FakeProvider();
    const session = attach(doc1, provider);

    doc1.insertText("b0", 0, "hi");
    doc2.insertText("b0", 0, "yo");
    provider.deliver(deltaOf(doc2, doc1));
    session.detach();

    expect(provider.connectCalls).toBe(0);
    expect(provider.disconnectCalls).toBe(0);
    expect(provider.setAwarenessStates).toHaveLength(0);
    expect(provider.onAwarenessCallbacks).toHaveLength(0);
  });
});

describe("synchronous re-entrancy (relay merges inside sendUpdate)", () => {
  it("cross-delivery inside the send path is applied remotely without a loop or double-send", () => {
    const state = baseState();
    const doc1 = loadPeer(state);
    const doc2 = loadPeer(state);
    const p1 = new FakeProvider();
    const p2 = new FakeProvider();
    attach(doc1, p1);
    attach(doc2, p2);
    // A relay: doc1's sends are delivered to doc2's session synchronously.
    p1.sendUpdate = (bytes) => {
      p1.sent.push(bytes);
      p2.deliver(bytes);
    };

    doc1.insertText("b0", 0, "local");

    expect(p1.sent).toHaveLength(2); // bootstrap + edit; the echo did not re-enter the send path
    expect(p2.sent).toHaveLength(1); // p2's bootstrap only: doc2 received the edit remotely
    expect(doc2.getText("b0")).toBe("local");
  });

  it("foreign bytes a relay merges inside the send path are not re-sent", () => {
    const state = baseState();
    const doc1 = loadPeer(state);
    const doc3 = loadPeer(state);
    const provider = new FakeProvider();
    attach(doc1, provider);
    doc3.insertText("b0", 0, "other");
    const foreignDelta = deltaOf(doc3, doc1);
    // The relay merges other peers' bytes into doc1 while doc1 is sending.
    provider.sendUpdate = (bytes) => {
      provider.sent.push(bytes);
      provider.deliver(foreignDelta);
    };

    doc1.insertText("b0", 0, "local");

    expect(provider.sent).toHaveLength(2); // bootstrap + local edit; the merged foreign delta is not re-sent
    const text = doc1.getText("b0");
    expect(text).toContain("local");
    expect(text).toContain("other"); // the foreign delta was applied
  });
});

describe("faulty delivery", () => {
  it("malformed remote bytes propagate to the delivery caller and leave the session healthy", () => {
    const state = baseState();
    const doc1 = loadPeer(state);
    const doc2 = loadPeer(state);
    const provider = new FakeProvider();
    attach(doc1, provider);

    expect(() => provider.deliver(new Uint8Array([1, 2, 3]))).toThrow();

    doc1.insertText("b0", 0, "a");
    expect(provider.sent).toHaveLength(2); // the session still routes local edits

    doc2.insertText("b0", 0, "b");
    provider.deliver(deltaOf(doc2, doc1));
    expect(doc1.getText("b0")).toContain("b"); // and applies valid bytes
    expect(provider.sent).toHaveLength(2); // without echoing them
  });

  it("a failed transact sends the partial batch and the rollback inverse", () => {
    const state = baseState();
    const doc1 = loadPeer(state);
    const provider = new FakeProvider();
    attach(doc1, provider);

    expect(() =>
      doc1.transact(() => {
        doc1.insertText("b0", 0, "partial");
        throw new Error("boom");
      })
    ).toThrow("boom");

    expect(provider.sent).toHaveLength(3); // bootstrap + partial batch + rollback inverse (CRDT wire property)
    expect(doc1.getText("b0")).toBe(""); // the batch did not stick
  });
});
