// @vitest-environment jsdom
// The page row's anchor is not a block element: the selection mapping must
// not flag the row's block from a range over the row's own zone (the form
// control's focus residue).
import { describe, expect, it } from "vitest";

import type { BlockId } from "docblocks-core";

import { mapDomSelection } from "../src/editing/selection-mapping";
import { renderDoc, rootOf } from "./selection-mapping.helpers";

describe("DOM selection mapping (the row's anchor)", () => {
  it("a caret in the row's own zone (outside the block wrapper) maps to none, not blocks", () => {
    // The row carries the block's anchor (data-block-id) for the consumer's
    // navigation: it is not a block element. A range over the row's own
    // zone (the form control's focus residue — the collapsed document
    // caret the browser parks inside the row while its control holds the
    // focus) must not flag the block for the Delete/Backspace gesture.
    let p1: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
    });
    const row = document.querySelector<HTMLElement>('[data-slot="docblocks/row"][data-block-id]');
    expect(row, "the page row should carry the block's anchor").not.toBeNull();
    const range = document.createRange();
    range.setStart(row!, 0);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(mapDomSelection(rootOf(), selection, doc)).toEqual({ kind: "none" });
  });
});
