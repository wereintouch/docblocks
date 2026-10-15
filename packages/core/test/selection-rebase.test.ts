import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createDoc, createSelection, loadDoc } from "../src/core";
import type { Doc, Selection } from "../src/core";
import type { TextDelta } from "../src/core/selection/deltas";
import { rebaseSelection } from "../src/core/selection/rebase";
import type { StructuralFacts } from "../src/core/selection/rebase";

/**
 * Selection rebase over document changes (spec selection-v1 §3 table):
 * offset shifts, range growth, clamping, collapse; cross-block chains
 * (recomputed on structural changes); kind "blocks" drop rules.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

const caret = (blockId: string, offset: number): Selection => ({ kind: "text", from: { blockId, offset }, to: null });

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

/** One paragraph "hello" (id "b0"). */
const withParagraph = (): Doc => {
  const doc = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
  doc.insertBlock("paragraph");
  doc.insertText("b0", 0, "hello");
  return doc;
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

/** Structural facts for the pure rebaseSelection unit tests. */
const factsFor = (lengths: Record<string, number>): StructuralFacts => ({
  deletedIds: new Set<string>(),
  linearization: ["d1", "b0", "b1", "b2"],
  textLength: (id) => lengths[id] ?? 0,
  isTextBlock: () => true,
});

describe("single-block offset rebase", () => {
  it("inserts before the caret shift it, at the caret do not move it, after do not move it", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);

    sel.set(caret("b0", 3));
    doc.insertText("b0", 1, "X"); // before the caret
    expect(asText(sel.get()).from.offset).toBe(4);

    sel.set(caret("b0", 2));
    doc.insertText("b0", 2, "Y"); // exactly at the caret
    expect(asText(sel.get()).from.offset).toBe(2);

    sel.set(caret("b0", 2));
    doc.insertText("b0", 5, "Z"); // after the caret
    expect(asText(sel.get()).from.offset).toBe(2);
  });

  it("an insert inside a range grows it (from fixed, to += delta)", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);

    doc.insertText("b0", 3, "ab"); // "hello" -> "helablo"
    sel.set(range("b0", 2, "b0", 5)); // [2,5) = "lab"
    doc.insertText("b0", 3, "XY"); // inside the range
    expect(doc.getText("b0")).toBe("helXYablo");
    expect(sel.get()).toEqual({
      kind: "text",
      from: { blockId: "b0", offset: 2 },
      to: { blockId: "b0", offset: 7 },
      blocks: ["b0"],
    });
  });

  it("multi-hunk changes in one transaction rebase correctly", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);

    sel.set(range("b0", 1, "b0", 4)); // "ell"
    doc.transact(() => {
      doc.insertText("b0", 0, "X"); // "Xhello"
      doc.deleteText("b0", 4, 5); // drop the second "l"
    });
    expect(doc.getText("b0")).toBe("Xhelo");
    expect(sel.get()).toEqual({
      kind: "text",
      from: { blockId: "b0", offset: 2 }, // the insert before the range pushes it
      to: { blockId: "b0", offset: 4 }, // the deleted "l" is inside the range
      blocks: ["b0"],
    });
  });

  it("a delete inside a range rebases both ends", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);

    doc.insertText("b0", 3, "ab"); // "hello" -> "helablo" (length 7)
    sel.set(range("b0", 2, "b0", 7)); // "lablo"
    doc.deleteText("b0", 3, 5); // drop "ab"
    expect(doc.getText("b0")).toBe("hello");
    expect(sel.get()).toEqual({
      kind: "text",
      from: { blockId: "b0", offset: 2 },
      to: { blockId: "b0", offset: 5 },
      blocks: ["b0"],
    });
  });

  it("a delete before the caret shifts it, a delete covering it keeps it at the deletion start", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);

    sel.set(caret("b0", 4));
    doc.deleteText("b0", 1, 3); // "hello" minus "el" -> "hlo"
    expect(doc.getText("b0")).toBe("hlo");
    expect(asText(sel.get()).from.offset).toBe(2); // 4 - 2

    sel.set(caret("b0", 1));
    doc.deleteText("b0", 0, 2); // deletion covers the caret
    expect(asText(sel.get()).from.offset).toBe(0);
  });

  it("a delete past the end clamps the caret to the new length", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);

    sel.set(caret("b0", 5)); // end of "hello"
    doc.deleteText("b0", 1, 5); // "h"
    expect(asText(sel.get()).from.offset).toBe(1);

    sel.set(caret("b0", 0));
    doc.deleteText("b0", 0, 1); // empty block
    expect(asText(sel.get()).from.offset).toBe(0);
  });

  it("a marked insert (run split + run add in one transaction) rebases the range correctly", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);

    sel.set(range("b0", 2, "b0", 5)); // "llo"
    doc.insertText("b0", 3, "XY", { bold: true }); // splits the run and adds a marked run
    expect(doc.getText("b0")).toBe("helXYlo");
    expect(sel.get()).toEqual({
      kind: "text",
      from: { blockId: "b0", offset: 2 },
      to: { blockId: "b0", offset: 7 },
      blocks: ["b0"],
    });

    // A mark-only change (no text length change) leaves the selection alone.
    const seen: Selection[] = [];
    const off = sel.onChange((s) => seen.push(s));
    doc.setMark("b0", 0, 2, { type: "italic" });
    expect(seen).toEqual([]);
    expect(asText(sel.get()).to).toEqual({ blockId: "b0", offset: 7 });
    off();
  });

  it("an inverted range collapses to a caret at the clamped from (pure rebase)", () => {
    const state: Selection = {
      kind: "text",
      from: { blockId: "b0", offset: 5 },
      to: { blockId: "b0", offset: 3 },
      blocks: ["b0"],
    };
    const noOp: TextDelta[] = [];
    const next = rebaseSelection(state, new Map([["b0", noOp]]), factsFor({ b0: 10 }));
    expect(next).toEqual({ kind: "text", from: { blockId: "b0", offset: 5 }, to: null, blocks: ["b0"] });

    // And with clamping: from past the new length collapses to a clamped caret.
    const shrunk = rebaseSelection(
      state,
      new Map([["b0", [{ pos: 0, inserted: 0, deleted: 4 }]]]),
      factsFor({ b0: 6 })
    );
    expect(shrunk).toEqual({ kind: "text", from: { blockId: "b0", offset: 1 }, to: null, blocks: ["b0"] });
  });
});

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

describe('kind "blocks"', () => {
  it("drops a deleted id from ids (anchor kept)", () => {
    const doc = withThreeParagraphs();
    const sel = createSelection(doc);
    sel.set({ kind: "blocks", ids: ["b0", "b1", "b2"], anchorId: "b0" });

    doc.removeBlock("b1");
    expect(sel.get()).toEqual({ kind: "blocks", ids: ["b0", "b2"], anchorId: "b0" });
  });

  it("collapses to none when the anchor is deleted", () => {
    const doc = withThreeParagraphs();
    const sel = createSelection(doc);
    sel.set({ kind: "blocks", ids: ["b0", "b1", "b2"], anchorId: "b1" });

    doc.removeBlock("b1");
    expect(sel.get()).toEqual({ kind: "none" });
  });

  it("collapses to none when all selected blocks are deleted", () => {
    const doc = withThreeParagraphs();
    const sel = createSelection(doc);
    sel.set({ kind: "blocks", ids: ["b0", "b1"], anchorId: "b1" });

    doc.removeBlock("b0");
    expect(sel.get()).toEqual({ kind: "blocks", ids: ["b1"], anchorId: "b1" }); // b1 survives
    doc.removeBlock("b1");
    expect(sel.get()).toEqual({ kind: "none" });
  });

  it("ignores changes of unselected blocks (no rebase emission)", () => {
    const doc = withThreeParagraphs();
    const sel = createSelection(doc);
    sel.set({ kind: "blocks", ids: ["b0"], anchorId: "b0" });

    const seen: Selection[] = [];
    const off = sel.onChange((s) => seen.push(s));
    doc.insertText("b1", 0, "x");
    expect(seen).toEqual([]);
    expect(sel.get()).toEqual({ kind: "blocks", ids: ["b0"], anchorId: "b0" });
    off();
  });
});
