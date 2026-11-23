import { describe, expect, it } from "vitest";

import { attach } from "../src/sync";
import { FakeProvider, baseState, deltaOf, loadPeer } from "./sync-attach.helpers";

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
