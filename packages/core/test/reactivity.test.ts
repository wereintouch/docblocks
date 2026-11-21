import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createDoc, loadDoc } from "../src/core";
import type { Change, Doc } from "../src/core";

/**
 * Fine-grained reactivity: one emission per Yjs transaction (local or
 * remote) — onChange first, then onBlock / observeText. Subscriptions are
 * lazy: the deep observer attaches on the first subscription and detaches
 * when the last one is removed.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

/** A fresh doc with one empty paragraph (id "b0"); root id is "d1". */
const withParagraph = (): Doc => {
  const doc = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
  doc.insertBlock("paragraph");
  return doc;
};

const idsOf = (change: Change | undefined): Set<string> => new Set(change?.blockIds ?? []);

describe("onChange", () => {
  it("fires once per local change with the affected block id", () => {
    const doc = withParagraph();
    const changes: Change[] = [];
    const off = doc.onChange((change) => changes.push(change));

    doc.insertText("b0", 0, "hello");

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ blockIds: ["b0"], metaChanged: false });
    off();
  });

  it("fires with metaChanged for a title change and no block ids", () => {
    const doc = withParagraph();
    const changes: Change[] = [];
    let blockFired = 0;
    let textFired = 0;
    const offChange = doc.onChange((change) => changes.push(change));
    const offBlock = doc.onBlock("b0", () => blockFired++);
    const offText = doc.observeText("b0", () => textFired++);

    doc.setTitle("New title");

    expect(changes).toEqual([{ blockIds: [], metaChanged: true }]);
    expect(blockFired).toBe(0);
    expect(textFired).toBe(0);
    offChange();
    offBlock();
    offText();
  });

  it("fires with metaChanged for an avatar change and no block ids", () => {
    const doc = withParagraph();
    const changes: Change[] = [];
    const off = doc.onChange((change) => changes.push(change));
    doc.setAvatar("🦊");
    expect(changes).toEqual([{ blockIds: [], metaChanged: true }]);
    // The clear is its own emission.
    changes.length = 0;
    doc.setAvatar(null);
    expect(changes).toEqual([{ blockIds: [], metaChanged: true }]);
    // The no-op stand (the same value) fires nothing.
    doc.setAvatar("🦊");
    changes.length = 0;
    doc.setAvatar("🦊");
    expect(changes).toHaveLength(0);
    off();
  });

  it("delivers the avatar change over the wire (the peer stands the value, the clear stands absent)", () => {
    const base = withParagraph();
    const state = base.encode();
    const doc = loadDoc(state);
    const peer = loadDoc(state);
    peer.setAvatar("🦊");
    doc.applyUpdate(peer.encodeUpdate(Y.encodeStateVector(doc.raw)));
    expect(doc.meta.avatar).toBe("🦊");
    peer.setAvatar(null);
    doc.applyUpdate(peer.encodeUpdate(Y.encodeStateVector(doc.raw)));
    expect(doc.meta.avatar).toBeUndefined();
  });

  it("fires for remote updates too", () => {
    const base = withParagraph();
    const state = base.encode();
    const doc = loadDoc(state);
    const peer = loadDoc(state);
    const changes: Change[] = [];
    const off = doc.onChange((change) => changes.push(change));

    peer.insertText("b0", 0, "remote");
    doc.applyUpdate(peer.encodeUpdate(Y.encodeStateVector(doc.raw)));

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ blockIds: ["b0"], metaChanged: false });
    off();
  });

  it("merges a local and a remote change in one Yjs transaction into a single emission", () => {
    const base = withParagraph();
    const state = base.encode();
    const doc = loadDoc(state);
    const peer = loadDoc(state);
    // The peer diverges on its own; its diff is the remote half of one local transaction.
    const remoteBlock = peer.insertBlock("paragraph");
    peer.insertText(remoteBlock, 0, "remote");
    const remote = peer.encodeUpdate(Y.encodeStateVector(doc.raw));
    const changes: Change[] = [];
    const off = doc.onChange((change) => changes.push(change));
    let localBlock = "";

    doc.transact(() => {
      localBlock = doc.insertBlock("paragraph");
      doc.applyUpdate(remote);
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]!.metaChanged).toBe(false);
    expect(idsOf(changes[0]!)).toEqual(new Set(["d1", localBlock, remoteBlock]));
    off();
  });

  it("lists the new block and its parent for an insertion under a parent", () => {
    const doc = withParagraph();
    const changes: Change[] = [];
    const off = doc.onChange((change) => changes.push(change));

    const id = doc.insertBlock("paragraph", undefined, { parent: doc.meta.id });

    expect(changes).toHaveLength(1);
    expect(idsOf(changes[0])).toEqual(new Set([id, doc.meta.id]));
    off();
  });

  it("reports every affected block of a mixed structural + text transaction", () => {
    const doc = withParagraph();
    const id = doc.insertBlock("paragraph", undefined, { after: "b0" }); // setup, before subscribing
    const changes: Change[] = [];
    const off = doc.onChange((change) => changes.push(change));

    // One transaction: a structural event (blocks-map add) and a text edit
    // of an unrelated block — both must reach the merged change.
    doc.transact(() => {
      doc.insertBlock("paragraph", undefined, { after: id });
      doc.insertText("b0", 0, "x");
    });

    expect(changes).toHaveLength(1);
    expect(idsOf(changes[0]).has("b0")).toBe(true);
    expect(idsOf(changes[0]).has(doc.meta.id)).toBe(true); // parent of the added block
    off();
  });

  it("lists the removed block and its parent for a removal", () => {
    const doc = withParagraph();
    const changes: Change[] = [];
    const offChange = doc.onChange((change) => changes.push(change));
    let blockFired = 0;
    const offBlock = doc.onBlock("b0", () => blockFired++);

    doc.removeBlock("b0");

    expect(idsOf(changes[0])).toEqual(new Set(["b0", doc.meta.id]));
    expect(changes[0]?.metaChanged).toBe(false);
    expect(blockFired).toBe(0); // a removed block emits nothing
    offChange();
    offBlock();
  });
});

describe("onRemoteChange", () => {
  it("fires for the wire's applies and not for local transactions", () => {
    const base = withParagraph();
    const state = base.encode();
    const doc = loadDoc(state);
    const peer = loadDoc(state);
    const changes: Change[] = [];
    const off = doc.onRemoteChange((change) => changes.push(change));

    // The local half: commands and the undo manager never stand the
    // remote origin.
    doc.insertText("b0", 0, "local");
    doc.undo();
    expect(changes).toHaveLength(0);

    // The peer's write applied over the wire (no local origin): one
    // emission.
    peer.insertText("b0", 0, "remote");
    doc.applyUpdate(peer.encodeUpdate(Y.encodeStateVector(doc.raw)));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ blockIds: ["b0"], metaChanged: false });
    off();
  });

  it("a remote apply inside a local transaction keeps the local origin (no emission)", () => {
    const base = withParagraph();
    const state = base.encode();
    const doc = loadDoc(state);
    const peer = loadDoc(state);
    const remoteBlock = peer.insertBlock("paragraph");
    const remote = peer.encodeUpdate(Y.encodeStateVector(doc.raw));
    const changes: Change[] = [];
    const off = doc.onRemoteChange((change) => changes.push(change));
    let localBlock = "";

    // One Yjs transaction carrying both halves: the local transact stands
    // the local origin over the whole transaction, so the feed stays idle
    // (the gesture's own stand covers the local half).
    doc.transact(() => {
      localBlock = doc.insertBlock("paragraph");
      doc.applyUpdate(remote);
    });

    expect(changes).toHaveLength(0);
    expect(doc.getBlock(localBlock)).not.toBeNull();
    expect(doc.getBlock(remoteBlock)).not.toBeNull();
    off();
  });
});
