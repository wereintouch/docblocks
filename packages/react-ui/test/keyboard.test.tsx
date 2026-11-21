// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { BlockId } from "docblocks-core";

import { caretOffsetIn } from "../src/editing/dom-offset";
import {
  caretAtFlat,
  expectCaret,
  fireSelectionChange,
  flushFrames,
  innerOf,
  key,
  rangeAtFlat,
  renderDoc,
  setViewSelection,
  viewSelection,
  wrapperOf,
} from "./keyboard.helpers";

describe("cross-block arrow navigation", () => {
  it("ArrowUp at offset 0 moves the caret to the end of the previous block", async () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });

    caretAtFlat(p2, 0);
    const prevented = key(wrapperOf(p2), { key: "ArrowUp" });

    expect(prevented).toBe(false); // the browser default is suppressed
    await flushFrames();
    const inner1 = innerOf(p1);
    const sel = window.getSelection()!;
    expect(inner1.contains(sel.anchorNode)).toBe(true);
    expect(caretOffsetIn(inner1, sel.anchorNode!, sel.anchorOffset)).toBe(3);

    // The selectionchange mapping updates the view selection.
    fireSelectionChange();
    expectCaret(p1, 3);
  });

  it("ArrowDown at the text end moves the caret to the start of the next block", async () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });

    caretAtFlat(p1, 3);
    const prevented = key(wrapperOf(p1), { key: "ArrowDown" });

    expect(prevented).toBe(false);
    await flushFrames();
    const inner2 = innerOf(p2);
    const sel = window.getSelection()!;
    expect(inner2.contains(sel.anchorNode)).toBe(true);
    expect(caretOffsetIn(inner2, sel.anchorNode!, sel.anchorOffset)).toBe(0);
    fireSelectionChange();
    expectCaret(p2, 0);
  });

  it("skips a non-text sibling in both directions", async () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      d.insertBlock("divider");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });
    caretAtFlat(p2, 0);
    expect(key(wrapperOf(p2), { key: "ArrowUp" })).toBe(false);
    await flushFrames();
    expect(caretOffsetIn(innerOf(p1), window.getSelection()!.anchorNode!, window.getSelection()!.anchorOffset)).toBe(3);

    caretAtFlat(p1, 3);
    expect(key(wrapperOf(p1), { key: "ArrowDown" })).toBe(false);
    await flushFrames();
    expect(caretOffsetIn(innerOf(p2), window.getSelection()!.anchorNode!, window.getSelection()!.anchorOffset)).toBe(0);
  });

  it("navigates across the flat sequence over the indented list item (the render-only nesting is not the data parent)", async () => {
    // The sublist item renders inside the parent item's derived segment
    // (the flat model's nesting is render-only): the DOM parent is the
    // parent item, but the data parent is the root's flat sequence. The
    // arrows stand the data sequence (the former DOM-parent lookup hit
    // the parent item's empty children — the dead navigation).
    let item1: BlockId = "";
    let item2: BlockId = "";
    renderDoc((d) => {
      item1 = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(item1, 0, "parent");
      item2 = d.insertBlock("list-item", { list: "bullet", indent: 1 });
      d.insertText(item2, 0, "child");
    });

    // The child's up edge: the caret lands at the parent item's text end.
    caretAtFlat(item2, 0);
    expect(key(wrapperOf(item2), { key: "ArrowUp" })).toBe(false);
    await flushFrames();
    const selUp = window.getSelection()!;
    const inner1 = innerOf(item1);
    expect(inner1.contains(selUp.anchorNode)).toBe(true);
    expect(caretOffsetIn(inner1, selUp.anchorNode!, selUp.anchorOffset)).toBe(6);
    fireSelectionChange();
    expectCaret(item1, 6);

    // The parent's down edge: the caret lands at the child item's start.
    caretAtFlat(item1, 6);
    expect(key(wrapperOf(item1), { key: "ArrowDown" })).toBe(false);
    await flushFrames();
    const selDown = window.getSelection()!;
    const inner2 = innerOf(item2);
    expect(inner2.contains(selDown.anchorNode)).toBe(true);
    expect(caretOffsetIn(inner2, selDown.anchorNode!, selDown.anchorOffset)).toBe(0);
    fireSelectionChange();
    expectCaret(item2, 0);
  });

  it("is a no-op at the edges and for a mid-block caret", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });

    // First block, offset 0: nothing above.
    caretAtFlat(p1, 0);
    expect(key(wrapperOf(p1), { key: "ArrowUp" })).toBe(true); // default runs
    fireSelectionChange();
    expectCaret(p1, 0);

    // Last block, text end: nothing below.
    caretAtFlat(p2, 3);
    expect(key(wrapperOf(p2), { key: "ArrowDown" })).toBe(true);
    fireSelectionChange();
    expectCaret(p2, 3);

    // Mid-block: the browser line-move default runs (single line: a no-op).
    caretAtFlat(p1, 1);
    expect(key(wrapperOf(p1), { key: "ArrowDown" })).toBe(true);
  });

  it("yields to a blocks selection: the plain arrows keep the selection navigation", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });

    // The gutter flow: a blocks selection on p1 with a leftover DOM caret
    // at p1's text end. ArrowDown must move the SELECTION (input-safety),
    // not the caret (cross-block navigation).
    setViewSelection({ kind: "blocks", ids: [p1], anchorId: p1 });
    caretAtFlat(p1, 3);
    const prevented = key(wrapperOf(p1), { key: "ArrowDown" });

    expect(prevented).toBe(false);
    const selection = viewSelection();
    expect(selection.kind).toBe("blocks");
    if (selection.kind === "blocks") expect(selection.ids).toEqual([p2]);
    // The caret gesture did not run: the DOM selection left p1 (the focus
    // park collapses it to the editor root over the span model's
    // unfocusable wrappers) and did not land inside p2's inner editable.
    const sel = window.getSelection()!;
    expect(innerOf(p1).contains(sel.anchorNode)).toBe(false);
    expect(innerOf(p2).contains(sel.anchorNode)).toBe(false);
  });

  it("ignores a range selection and an out-of-block caret", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });

    // An in-block range is not a collapsed caret.
    rangeAtFlat(p1, 0, 1);
    expect(key(wrapperOf(p1), { key: "ArrowDown" })).toBe(true);

    // No DOM selection at all.
    window.getSelection()!.removeAllRanges();
    expect(key(wrapperOf(p1), { key: "ArrowUp" })).toBe(true);
  });
});
