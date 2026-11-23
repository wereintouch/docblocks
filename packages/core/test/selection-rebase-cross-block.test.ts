import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createDoc, createSelection, loadDoc } from "../src/core";
import type { Doc, Selection } from "../src/core";

/**
 * Selection rebase over cross-block chains (the sibling of
 * selection-rebase.test.ts): the DFS chain's recompute on structural
 * changes and the remote-update parity over the same base state.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

const range = (fromId: string, from: number, toId: string, to: number): Selection => ({
  kind: "text",
  from: { blockId: fromId, offset: from },
  to: { blockId: toId, offset: to },
});

/** Narrow a text selection for assertions (get() returns the union). */
const asText = (s: Selection): Extract<Selection, { kind: "text" }> => {
  if (s.kind !== "text") throw new Error(`expected a text selection, got ${s.kind}`);
  return s;
};

/** Three top-level paragraphs: b0 "aaa", b1 "xxx", b2 "bbb". */
const withThreeParagraphs = (): Doc => {
  const doc = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
  for (const text of ["aaa", "xxx", "bbb"]) {
    const id = doc.insertBlock("paragraph");
    doc.insertText(id, 0, text);
  }
  return doc;
};

describe("cross-block selections", () => {
  const fromTo = (fromOffset: number, toOffset: number): Selection => range("b0", fromOffset, "b2", toOffset);

  it("computes the DFS chain across blocks, ordered from-block first", () => {
    const doc = withThreeParagraphs();
    const sel = createSelection(doc);

    sel.set(fromTo(1, 2));
    expect(sel.get()).toEqual({
      kind: "text",
      from: { blockId: "b0", offset: 1 },
      to: { blockId: "b2", offset: 2 },
      blocks: ["b0", "b1", "b2"],
    });
  });

  it("inserting before the from-block shifts only the from offset", () => {
    const doc = withThreeParagraphs();
    const sel = createSelection(doc);
    sel.set(fromTo(1, 2));

    doc.insertText("b0", 0, "Z");
    expect(sel.get()).toEqual({
      kind: "text",
      from: { blockId: "b0", offset: 2 },
      to: { blockId: "b2", offset: 2 },
      blocks: ["b0", "b1", "b2"],
    });
  });

  it("a delete in the from-block covering the from-point clamps it", () => {
    const doc = withThreeParagraphs();
    const sel = createSelection(doc);
    sel.set(fromTo(1, 2));

    doc.deleteText("b0", 0, 3); // b0 becomes empty; from clamps to 0
    expect(sel.get()).toEqual({
      kind: "text",
      from: { blockId: "b0", offset: 0 },
      to: { blockId: "b2", offset: 2 },
      blocks: ["b0", "b1", "b2"],
    });
  });

  it("deleting a middle block recomputes the chain (points unchanged)", () => {
    const doc = withThreeParagraphs();
    const sel = createSelection(doc);
    sel.set(fromTo(1, 2));

    doc.removeBlock("b1");
    expect(sel.get()).toEqual({
      kind: "text",
      from: { blockId: "b0", offset: 1 },
      to: { blockId: "b2", offset: 2 },
      blocks: ["b0", "b2"],
    });
  });

  it("deleting an in-between sibling under an ancestor recomputes the chain", () => {
    const doc = withThreeParagraphs();
    const sel = createSelection(doc);
    sel.set(fromTo(1, 2));

    // A new block lands between b1 and b2: the span gains it, the chain grows.
    doc.insertBlock("paragraph", undefined, { after: "b1" });
    expect(asText(sel.get()).blocks).toEqual(["b0", "b1", "b3", "b2"]);

    // And removing it again shrinks the chain back.
    doc.removeBlock("b3");
    expect(asText(sel.get()).blocks).toEqual(["b0", "b1", "b2"]);
  });

  it("deleting the from-block collapses the selection to none", () => {
    const doc = withThreeParagraphs();
    const sel = createSelection(doc);
    sel.set(fromTo(1, 2));

    doc.removeBlock("b0");
    expect(sel.get()).toEqual({ kind: "none" });
  });

  it("deleting the to-block of a cross-block selection collapses it to none", () => {
    const doc = withThreeParagraphs();
    const sel = createSelection(doc);
    sel.set(fromTo(1, 2));

    doc.removeBlock("b2");
    expect(sel.get()).toEqual({ kind: "none" });
  });

  it("deleting the block of a single-block selection collapses it to none", () => {
    const doc = withThreeParagraphs();
    const sel = createSelection(doc);
    sel.set(range("b0", 1, "b0", 3));

    doc.removeBlock("b0");
    expect(sel.get()).toEqual({ kind: "none" });
  });

  it("a block move keeps the points and recomputes the chain", () => {
    const doc = withThreeParagraphs();
    const sel = createSelection(doc);
    sel.set(fromTo(1, 2));

    doc.moveBlock("b1", doc.meta.id, 0); // b1 moves in front of b0
    expect(sel.get()).toEqual({
      kind: "text",
      from: { blockId: "b0", offset: 1 },
      to: { blockId: "b2", offset: 2 },
      blocks: ["b0", "b2"],
    });
  });

  it("a flat segment with a deeper-indented subtree reads in sequence order (the chain includes it)", () => {
    const doc = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
    // b0 "aaa" (0), b1 "sub" (1), b2 "sub2" (2), b3 "bbb" (0): the flat page
    // sequence with a two-level subtree (the nesting is the indent attr).
    for (const [text, indent] of [
      ["aaa", 0],
      ["sub", 1],
      ["sub2", 2],
      ["bbb", 0],
    ] as const) {
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, text);
      if (indent > 0) doc.updateBlock(id, { indent });
    }
    const sel = createSelection(doc);
    sel.set(range("b0", 1, "b3", 2));

    // The chain is the contiguous sequence segment: the deeper-indented
    // subtree blocks read between the endpoints (no descent of their own).
    expect(asText(sel.get()).blocks).toEqual(["b0", "b1", "b2", "b3"]);

    // Moving the deeper segment out of the span recomputes the chain (the
    // outdent keeps the jump rule; the landing spot must honor it too).
    doc.updateBlock("b2", { indent: 0 });
    doc.moveBlock("b2", doc.meta.id, 4);
    expect(asText(sel.get()).blocks).toEqual(["b0", "b1", "b3"]);
  });

  it("an unrelated change outside the span leaves the selection untouched", () => {
    const doc = withThreeParagraphs();
    const sel = createSelection(doc);
    const b3 = doc.insertBlock("paragraph"); // after b2: outside the span
    doc.insertText(b3, 0, "later");
    sel.set(fromTo(1, 2));

    const seen: Selection[] = [];
    const off = sel.onChange((s) => seen.push(s));
    doc.insertText(b3, 5, " more");
    expect(seen).toEqual([]);
    expect(sel.get()).toEqual({
      kind: "text",
      from: { blockId: "b0", offset: 1 },
      to: { blockId: "b2", offset: 2 },
      blocks: ["b0", "b1", "b2"],
    });
    off();
  });

  it("rebases cross-block selections for remote updates (same rules, local or remote)", () => {
    const base = withThreeParagraphs().encode();
    const doc = loadDocWithParagraphs(base);
    const peer = loadDocWithParagraphs(base);
    const sel = createSelection(doc);
    sel.set(fromTo(1, 2));

    peer.insertText("b0", 0, "Z");
    doc.applyUpdate(peer.encodeUpdate(Y.encodeStateVector(doc.raw)));
    expect(asText(sel.get()).from.offset).toBe(2);
    expect(asText(sel.get()).to).toEqual({ blockId: "b2", offset: 2 });
  });
});

/** Both peers import the same base state (fresh block ids per doc are not needed). */
function loadDocWithParagraphs(bytes: Uint8Array): Doc {
  return loadDoc(bytes);
}
