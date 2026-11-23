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

describe("mod+a: the whole-document's selection (the nested-editables' stand)", () => {
  it("seats the selection over the page's text (the first text block's start → the last's end)", () => {
    let p1: BlockId = "";
    let divider: BlockId = "";
    let p2: BlockId = "";
    let p3: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "first line");
      divider = d.insertBlock("divider"); // a non-text middle (the selection's stand over it)
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "middle line");
      p3 = d.insertBlock("paragraph");
      d.insertText(p3, 0, "last line");
    });
    caretAtFlat(p1, 4);
    expect(key(wrapperOf(p1), { key: "a", ctrlKey: true })).toBe(false); // suppressed over the degenerate default

    // The DOM selection spans the first → the last inner (the cross's
    // stand — the native's degenerate caret's move stands replaced).
    const sel = window.getSelection()!;
    expect(sel.isCollapsed).toBe(false);
    expect(innerOf(p1).contains(sel.anchorNode)).toBe(true);
    expect(innerOf(p3).contains(sel.focusNode)).toBe(true);

    // The mapping's view: the cross text selection over the full range
    // (the chain stands the non-text middle's stand over it).
    fireSelectionChange();
    const view = context!.selection.view!;
    expect(view.get()).toEqual({
      kind: "text",
      from: { blockId: p1, offset: 0 },
      to: { blockId: p3, offset: 9 },
      blocks: [p1, divider, p2, p3],
    } as Selection);
  });

  it("over a single text block stands the block's whole text", () => {
    let p1: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "solo");
    });
    caretAtFlat(p1, 2);
    expect(key(wrapperOf(p1), { key: "a", ctrlKey: true })).toBe(false);
    const sel = window.getSelection()!;
    expect(sel.isCollapsed).toBe(false);
    fireSelectionChange();
    const view = context!.selection.view!;
    expect(view.get()).toEqual({
      kind: "text",
      from: { blockId: p1, offset: 0 },
      to: { blockId: p1, offset: 4 },
      blocks: [p1],
    } as Selection);
  });

  it("the form control's select-all keeps the default (no document's selection)", () => {
    let p1: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "first line");
    });
    const input = document.createElement("input");
    input.value = "draft";
    innerOf(p1).appendChild(input);
    const at = positionAt(p1, 2);
    const range = document.createRange();
    range.setStart(at.node, at.offset);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    // The input's own keydown (the default's keep's stand — no suppression,
    // no document's selection's seat).
    let result = true;
    act(() => {
      result = input.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "a", ctrlKey: true })
      );
    });
    expect(result).toBe(true);
    const sel = window.getSelection()!;
    expect(sel.isCollapsed).toBe(true); // the document's selection stands untouched
    expect(doc.getRuns(p1)).toEqual([{ text: "first line", marks: {} }]);
  });
});
