import { describe, expect, it } from "vitest";

import { createDoc, createSelection } from "../src/core";
import type { Doc, Selection } from "../src/core";

/**
 * Selection rebase over kind "blocks" (the sibling of
 * selection-rebase.test.ts): the deleted-id drop rules and the anchor's
 * collapse to none.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
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
