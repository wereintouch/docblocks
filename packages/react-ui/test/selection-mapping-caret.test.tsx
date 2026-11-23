// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { BlockId } from "docblocks-core";

import { domSelectionInEditable, mapDomSelection } from "../src/editing/selection-mapping";
import { innerOf, renderDoc, rootOf } from "./selection-mapping.helpers";

describe("the page container's caret (the span model's transient)", () => {
  it("a caret over the page container's own flow is not a live text seat", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });
    const page = rootOf().querySelector<HTMLElement>('[data-slot="docblocks/page"]')!;
    expect(page.getAttribute("contenteditable")).toBe("true");
    // The caret over the container's position (a gap between the rows'
    // layer): the editable check stands the false (a pure container's
    // caret is a transient, not a text's seat — the blocks' selection
    // must not be clobbered over it).
    const range = document.createRange();
    range.setStart(page, page.childElementCount);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(domSelectionInEditable(selection)).toBe(false);
    expect(mapDomSelection(rootOf(), selection, doc)).toEqual({ kind: "none" });
  });

  it("a caret inside a block's inner stands the text mapping (the container's editable does not shadow it)", () => {
    let p1: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
    });
    const inner = innerOf(p1);
    const text = inner.firstChild as Text;
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.collapse(text, 1);
    expect(domSelectionInEditable(selection)).toBe(true);
  });
});
