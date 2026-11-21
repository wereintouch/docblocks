// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BlockId } from "docblocks-core";

import { innerOf, key, renderDoc, wrapperOf } from "./block-editing.helpers";

describe("Enter: block split", () => {
  it("resets an empty root list item to a plain paragraph (in place, one undo step)", () => {
    let intro: BlockId = "";
    let li: BlockId = "";
    const doc = renderDoc((d) => {
      intro = d.insertBlock("paragraph");
      d.insertText(intro, 0, "intro");
      li = d.insertBlock("list-item", { list: "bullet" });
    });

    // The empty item has no text node: the caret is the element offset 0.
    const inner = innerOf(li);
    const range = document.createRange();
    range.setStart(inner, 0);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    key(wrapperOf(li), "Enter");

    // The type resets in place (the block keeps its slot, no new block,
    // the list attr is dropped).
    const ids = doc.getChildren(doc.meta.id);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(li);
    expect(doc.getBlock(li)!.type).toBe("paragraph");
    expect(doc.getText(li)).toBe("");

    // One undo step restores the list item.
    act(() => {
      doc.undo();
    });
    expect(doc.getBlock(li)!.type).toBe("list-item");
  });

  it("resets an empty root list item at the sequence's start (the slot stands)", () => {
    let li: BlockId = "";
    let after: BlockId = "";
    const doc = renderDoc((d) => {
      li = d.insertBlock("list-item", { list: "bullet" });
      after = d.insertBlock("paragraph");
      d.insertText(after, 0, "after");
    });

    const innerEl = innerOf(li);
    const range = document.createRange();
    range.setStart(innerEl, 0);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    key(wrapperOf(li), "Enter");

    // The reset is in place: the first slot is now a paragraph, the
    // following block stands after it.
    const ids = doc.getChildren(doc.meta.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(li);
    expect(doc.getBlock(li)!.type).toBe("paragraph");
    expect(ids[1]).toBe(after);
  });

  it("keeps the sublist when an empty root list item resets to a paragraph", () => {
    let li: BlockId = "";
    let child: BlockId = "";
    let after: BlockId = "";
    const doc = renderDoc((d) => {
      li = d.insertBlock("list-item", { list: "bullet" });
      child = d.insertBlock("list-item", { list: "bullet", indent: 1 });
      after = d.insertBlock("paragraph");
    });

    const innerEl = innerOf(li);
    const range = document.createRange();
    range.setStart(innerEl, 0);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    key(wrapperOf(li), "Enter");

    // The derived segment stands under the paragraph (the type reset
    // never removes content): the item's slot is a paragraph, the child
    // and the following block stand.
    const ids = doc.getChildren(doc.meta.id);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe(li);
    expect(doc.getBlock(li)!.type).toBe("paragraph");
    expect(ids[1]).toBe(child);
    expect(ids[2]).toBe(after);
  });

  it("outdents a nested empty list item (depth 2): one level out, the type stands", () => {
    let outer: BlockId = "";
    let inner: BlockId = "";
    const doc = renderDoc((d) => {
      outer = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(outer, 0, "outer");
      inner = d.insertBlock("list-item", { list: "bullet", indent: 1 });
    });

    const innerEl = innerOf(inner);
    const range = document.createRange();
    range.setStart(innerEl, 0);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    key(wrapperOf(inner), "Enter");

    // The repeated-Enter climb back to the root: one level out (indent 0),
    // the type stands, no block is added or removed.
    const ids = doc.getChildren(doc.meta.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(outer);
    expect(ids[1]).toBe(inner);
    const innerJson = doc.getBlock(inner)!;
    expect(innerJson.type).toBe("list-item");
    expect((innerJson as { attrs?: { indent?: number } }).attrs?.indent ?? 0).toBe(0);
  });

  it("outdents a doubly-nested empty list item (depth 3): one level shallower, the rest stands", () => {
    let top: BlockId = "";
    let mid: BlockId = "";
    let deep: BlockId = "";
    const doc = renderDoc((d) => {
      top = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(top, 0, "top");
      mid = d.insertBlock("list-item", { list: "bullet", indent: 1 });
      deep = d.insertBlock("list-item", { list: "bullet", indent: 2 });
    });

    const deepEl = innerOf(deep);
    const range = document.createRange();
    range.setStart(deepEl, 0);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    key(wrapperOf(deep), "Enter");

    // One level shallower (indent 1, the middle item's level) — the
    // top-level list and the middle item stand, the type stands.
    const ids = doc.getChildren(doc.meta.id);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe(top);
    expect(ids[1]).toBe(mid);
    expect(ids[2]).toBe(deep);
    const deepJson = doc.getBlock(deep)!;
    expect(deepJson.type).toBe("list-item");
    expect((deepJson as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
  });
});
