// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";

import { moveSegmentInSequence } from "../src/editing/block-commands";
import { CREATED_AT } from "./block-editing.helpers";

describe("Segment move: the derived subtree as one contiguous range", () => {
  it("moves a segment past a shallower boundary to the end (the head-first landing commits)", () => {
    // A(0), B(1), C(2), D(0), E(0): the segment [B, C] (B is the head)
    // moves past the shallower boundary D/E to the end. A backwards move
    // (deepest first) lands C(2) after E(0) mid-transact — an indent jump
    // the core rejects and rolls back, dropping a valid gesture — while the
    // final [A, D, E, B, C] is valid.
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const root = doc.meta.id;
    const a = doc.insertBlock("paragraph");
    doc.insertText(a, 0, "a");
    const b = doc.insertBlock("paragraph", { indent: 1 });
    doc.insertText(b, 0, "b");
    const c = doc.insertBlock("paragraph", { indent: 2 });
    doc.insertText(c, 0, "c");
    const d = doc.insertBlock("paragraph");
    doc.insertText(d, 0, "d");
    const e = doc.insertBlock("paragraph");
    doc.insertText(e, 0, "e");

    // The segment [B, C] = indices 1..2 (start 1, length 2); the target is
    // the sequence's length (move to the end, nothing preceded).
    const ok = moveSegmentInSequence(doc, root, 1, 2, 5);

    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual([a, d, e, b, c]);
    // A reorder, not a re-nest: the indents stand and the doc still
    // validates strictly (the jump rule holds over the whole sequence).
    expect(validateDoc(doc.toJSON())).toEqual([]);
    const bJson = doc.toJSON().blocks[b]!;
    const cJson = doc.toJSON().blocks[c]!;
    expect((bJson as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    expect((cJson as { attrs?: { indent?: number } }).attrs?.indent).toBe(2);

    // One undo step restores the original order.
    expect(doc.canUndo).toBe(true);
    act(() => {
      doc.undo();
    });
    expect(doc.getChildren(root)).toEqual([a, b, c, d, e]);
  });
});
