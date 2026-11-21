import { describe, expect, it } from "vitest";

import { attach } from "../src/sync";
import { FakeProvider, baseState, deltaOf, loadPeer } from "./sync-attach.helpers";

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
