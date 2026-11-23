// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BlockId, Selection } from "docblocks-core";

import {
  caretAtFlat,
  context,
  fireSelectionChange,
  innerOf,
  key,
  positionAt,
  renderDoc,
  wrapperOf,
} from "./keyboard.helpers";

describe("ctrl+home / ctrl+end: the document's edge's caret's seat (the nested-editables' stand)", () => {
  let p1: BlockId;
  let p2: BlockId;
  const renderThree = () =>
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "first line");
      d.insertBlock("divider"); // a non-text middle (the edge's stand over it)
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "last line");
    });

  it("ctrl+home seats the caret at the first text block's start (over the non-text middle's stand)", () => {
    renderThree();
    caretAtFlat(p2, 3);
    expect(key(wrapperOf(p2), { key: "Home", ctrlKey: true })).toBe(false); // the native's degenerate stand's suppression
    const sel = window.getSelection()!;
    expect(sel.isCollapsed).toBe(true);
    expect(innerOf(p1).contains(sel.anchorNode)).toBe(true);
    fireSelectionChange();
    const view = context!.selection.view!;
    expect(view.get()).toEqual({
      kind: "text",
      from: { blockId: p1, offset: 0 },
      to: null,
      blocks: [p1],
    } as Selection);
  });

  it("ctrl+end seats the caret at the last text block's end", () => {
    renderThree();
    caretAtFlat(p1, 2);
    expect(key(wrapperOf(p1), { key: "End", ctrlKey: true })).toBe(false);
    const sel = window.getSelection()!;
    expect(sel.isCollapsed).toBe(true);
    expect(innerOf(p2).contains(sel.focusNode)).toBe(true);
    fireSelectionChange();
    const view = context!.selection.view!;
    expect(view.get()).toEqual({
      kind: "text",
      from: { blockId: p2, offset: 9 },
      to: null,
      blocks: [p2],
    } as Selection);
  });

  it("the form control's ctrl+home keeps the default (no document's seat)", () => {
    const doc = renderThree();
    const input = document.createElement("input");
    input.value = "draft";
    innerOf(p1).appendChild(input);
    const at = positionAt(p2, 1);
    const range = document.createRange();
    range.setStart(at.node, at.offset);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    let result = true;
    act(() => {
      result = input.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Home", ctrlKey: true })
      );
    });
    expect(result).toBe(true); // the default's keep (no suppression)
    const sel = window.getSelection()!;
    expect(innerOf(p2).contains(sel.anchorNode)).toBe(true); // the seat stands untouched
    expect(doc.getRuns(p2)).toEqual([{ text: "last line", marks: {} }]);
  });
});
