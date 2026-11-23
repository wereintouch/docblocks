import { describe, expect, it } from "vitest";

import { createDoc } from "../src/core";
import { attach } from "../src/sync";
import { CREATED_AT, FakeProvider, baseState, deltaOf, loadPeer, makeIds } from "./sync-attach.helpers";

describe("late attach", () => {
  it("a fresh doc attached after the provider already holds room state converges", () => {
    const provider = new FakeProvider();
    provider.internalState(); // the provider stands the accumulated-state stand

    // The provider's internal doc holds the room state from a completed
    // handshake with the other peer (the accumulated-state stand); the app doc is
    // created and attached only now.
    const room = loadPeer(baseState());
    room.insertText("b0", 0, "remote text");
    provider.receiveFromWire(room.encode());

    // The app doc is a FRESH joiner (no blocks of its own — only the
    // concurrent meta init, which stands the same values on both sides;
    // a second load of the same state would stand a non-deterministic
    // concurrent-init collision on the block entries).
    const doc1 = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
    attach(doc1, provider);

    expect(doc1.getText("b0")).toBe("remote text");
    expect(doc1.toJSON()).toEqual(room.toJSON());
    expect(provider.sent).toHaveLength(1); // the bootstrap only: the recovery stands no echo
  });

  it("a synchronous provider reply to the bootstrap send is captured by the session", () => {
    const provider = new FakeProvider();
    const state = baseState();
    const doc1 = loadPeer(state);
    const doc2 = loadPeer(state);
    doc2.insertText("b0", 0, "remote");
    const delta = deltaOf(doc2, doc1);
    // A relay that answers synchronously inside the send path: the
    // reply stands lost over a send-first order (the subscription is
    // not live yet).
    const originalSend = provider.sendUpdate.bind(provider);
    provider.sendUpdate = (bytes: Uint8Array) => {
      originalSend(bytes);
      provider.deliver(delta);
    };

    attach(doc1, provider);

    expect(doc1.getText("b0")).toBe("remote");
    expect(provider.sent).toHaveLength(1); // the bootstrap only: the reply is not re-sent
  });

  it("a reattach after detach recovers the state the provider received while detached", () => {
    const provider = new FakeProvider();
    provider.internalState();
    const state = baseState();
    const doc1 = loadPeer(state);
    const session = attach(doc1, provider);
    session.detach();

    // The provider keeps receiving the room state while the doc is out
    // of the loop (the socket stands connected).
    const doc2 = loadPeer(state);
    doc2.insertText("b0", 0, "missed while detached");
    provider.receiveFromWire(deltaOf(doc2, loadPeer(state)));

    attach(doc1, provider); // the fresh session's subscription receives the accumulated state

    expect(doc1.getText("b0")).toBe("missed while detached");
    expect(doc1.toJSON()).toEqual(doc2.toJSON());
  });

  it("the pre-connect buffered bootstrap stands no accumulated delivery (the wire-received gate)", () => {
    const provider = new FakeProvider();
    provider.internalState();
    const state = baseState();
    const doc1 = loadPeer(state);
    const session = attach(doc1, provider); // the bootstrap stands buffered into the provider's internal doc

    // A consumer that keys off "the first incoming update": over the
    // pre-connect buffered bootstrap it must stand no delivery — the bootstrap is the doc's
    // own state, not incoming state.
    const seen: number[] = [];
    const unsubscribe = provider.onUpdate((bytes) => seen.push(bytes.byteLength));
    expect(seen).toHaveLength(0);

    // The wire state arrives: the subscriber stands it (the gate is open
    // now, and a fresh subscription would stand the accumulated state).
    const doc2 = loadPeer(state);
    doc2.insertText("b0", 0, "remote");
    provider.receiveFromWire(deltaOf(doc2, loadPeer(state)));

    expect(seen).toHaveLength(1);
    expect(doc1.getText("b0")).toBe("remote");

    unsubscribe();
    session.detach();
  });

  it("two docs on one provider each recover the accumulated state at their attach", () => {
    const provider = new FakeProvider();
    provider.internalState();
    const state = baseState();

    const first = loadPeer(state);
    attach(first, provider);
    first.insertText("b0", 0, "first edit");
    // The wire echo: the relay/peers deliver the edit back to the
    // provider (the internal doc accumulates it from the wire, not from
    // the send path).
    provider.receiveFromWire(deltaOf(first, loadPeer(state)));

    // A second doc joins the same provider after the first has written.
    const second = loadPeer(state);
    attach(second, provider);

    expect(second.getText("b0")).toBe("first edit");
    expect(second.toJSON()).toEqual(first.toJSON());
  });
});
