import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { PresenceState } from "docblocks-core";

import { createEditorStore } from "../src/state/store";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

function setup() {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  const store = createEditorStore(doc);
  // Wire the doc change feed exactly as the EditorProvider does.
  const unsubscribe = doc.onChange((change) => store.getState().applyChange(change));
  return { doc, store, unsubscribe };
}

describe("createEditorStore", () => {
  it("seeds the store with the doc's initial snapshot", () => {
    const { store } = setup();
    const state = store.getState();
    expect(state.meta).toEqual({ v: 1, id: "doc-1", title: "", createdAt: CREATED_AT });
    expect(state.blocks).toEqual({ "doc-1": { type: "root", children: [] } });
    expect(state.rootChildren).toEqual([]);
    expect(state.selection).toEqual({ kind: "none" });
    expect(state.presence).toEqual([]);
  });

  it("replaces the edited block's reference and keeps sibling blocks' references", () => {
    const { doc, store } = setup();
    const p1 = doc.insertBlock("paragraph");
    const p2 = doc.insertBlock("paragraph");
    const before = store.getState();
    const refP1 = before.blocks[p1];
    const refP2 = before.blocks[p2];
    const refRootChildren = before.rootChildren;

    doc.insertText(p1, 0, "hello");

    const after = store.getState();
    expect(after.blocks[p1]).not.toBe(refP1);
    expect(after.blocks[p1]).toMatchObject({
      type: "paragraph",
      content: [{ text: "hello", marks: {} }],
    });
    expect(after.blocks[p2]).toBe(refP2);
    expect(after.rootChildren).toBe(refRootChildren);
    expect(after.meta).toBe(before.meta);
  });

  it("adds a new block, replaces rootChildren, and keeps other blocks' references", () => {
    const { doc, store } = setup();
    const p1 = doc.insertBlock("paragraph");
    const p2 = doc.insertBlock("paragraph");
    const before = store.getState();
    const refP1 = before.blocks[p1];
    const refP2 = before.blocks[p2];

    const h = doc.insertBlock("heading", { level: 2 });

    const after = store.getState();
    expect(after.blocks[h]).toMatchObject({ type: "heading", attrs: { level: 2 } });
    expect(after.rootChildren).toEqual([p1, p2, h]);
    expect(after.blocks[p1]).toBe(refP1);
    expect(after.blocks[p2]).toBe(refP2);
    expect(after.meta).toBe(before.meta);
  });

  it("replaces meta on setTitle and keeps the blocks reference", () => {
    const { doc, store } = setup();
    doc.insertBlock("paragraph");
    const before = store.getState();

    doc.setTitle("A title");

    const after = store.getState();
    expect(after.meta).not.toBe(before.meta);
    expect(after.meta.title).toBe("A title");
    expect(after.blocks).toBe(before.blocks);
    expect(after.rootChildren).toBe(before.rootChildren);
  });

  it("drops a removed block and updates rootChildren", () => {
    const { doc, store } = setup();
    const p1 = doc.insertBlock("paragraph");
    const p2 = doc.insertBlock("paragraph");

    doc.removeBlock(p2);

    const after = store.getState();
    expect(after.blocks[p2]).toBeUndefined();
    expect(after.rootChildren).toEqual([p1]);
  });

  it("re-reads every reported block when a structural and a text edit share one transaction", () => {
    const { doc, store } = setup();
    const p1 = doc.insertBlock("paragraph");
    doc.insertText(p1, 0, "hello world");
    const before = store.getState();
    const refP1 = before.blocks[p1];

    // One transaction that adds a block AND trims p1's text: the change
    // report must list both, and the store must update p1's snapshot.
    doc.transact(() => {
      doc.insertBlock("paragraph", undefined, { parent: doc.meta.id, after: p1 });
      doc.deleteText(p1, 6, 11);
    });

    const after = store.getState();
    expect(after.blocks[p1]).not.toBe(refP1);
    expect(after.blocks[p1]).toMatchObject({
      type: "paragraph",
      content: [{ text: "hello ", marks: {} }],
    });
  });

  it("keeps selection and presence as independent slices", () => {
    const { doc, store } = setup();
    const p1 = doc.insertBlock("paragraph");
    doc.insertText(p1, 0, "x");
    const peer: PresenceState = { peerId: "peer-1", selection: { blockId: p1, offset: 1 }, updatedAt: 123 };

    store.getState().setPresence([peer]);
    store.getState().setSelection({ kind: "text", from: { blockId: p1, offset: 0 }, to: null });

    const state = store.getState();
    expect(state.presence).toEqual([peer]);
    expect(state.selection).toEqual({ kind: "text", from: { blockId: p1, offset: 0 }, to: null });
    expect(state.blocks[p1]).toMatchObject({ type: "paragraph" });

    // Each setter touches only its own slice's reference.
    const before = store.getState();
    store.getState().setPresence([]);
    expect(store.getState().blocks).toBe(before.blocks);
    expect(store.getState().selection).toBe(before.selection);
    store.getState().setSelection({ kind: "none" });
    expect(store.getState().presence).toEqual([]);
    expect(store.getState().blocks).toBe(before.blocks);
  });
});
