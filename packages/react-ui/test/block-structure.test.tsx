// @vitest-environment jsdom
// The block's structure's keyboard stand: the list's nesting's Tab /
// Shift+Tab (the flat's indent's update, the segment's outdent, the
// attach's rule) and the block's selection (the gutter's click, the
// Delete's cascade, the shift's range, the arrow's move, the Escape's
// clear).
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { validateDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { caretAtFlat, key, renderDoc, storeSelection, wrapperOf } from "./block-structure.helpers";

describe("Tab: list nesting", () => {
  it("nests the second item under the first (an indent attr update); Shift+Tab undoes it", () => {
    let l1: BlockId = "";
    let l2: BlockId = "";
    const doc = renderDoc((d) => {
      l1 = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(l1, 0, "one");
      l2 = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(l2, 0, "two");
    });

    caretAtFlat(l2, 0);
    key(wrapperOf(l2), "Tab");

    // The flat model: Tab is one indent attr update — the sequence stands,
    // no children field is written.
    const nested = doc.toJSON();
    expect((nested.blocks[l2]! as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    expect(doc.getChildren(doc.meta.id)).toEqual([l1, l2]);
    // The flat stand: the nested item is its own row at the deeper indent
    // step, the marker's cycle following the level.
    const marker = wrapperOf(l2).querySelector<HTMLElement>('[data-slot="docblocks/row-marker"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-cycle")).toBe("2");

    key(wrapperOf(l2), "Tab", { shiftKey: true });

    const flat = doc.toJSON();
    expect((flat.blocks[l2]! as { attrs?: { indent?: number } }).attrs?.indent ?? 0).toBe(0);
    expect(doc.getChildren(doc.meta.id)).toEqual([l1, l2]);
  });

  it("Shift+Tab outdents the whole derived segment (the head and its follower step out together)", () => {
    let l1: BlockId = "";
    let l2: BlockId = "";
    let l3: BlockId = "";
    const doc = renderDoc((d) => {
      l1 = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(l1, 0, "one");
      l2 = d.insertBlock("list-item", { list: "bullet", indent: 1 });
      d.insertText(l2, 0, "two");
      l3 = d.insertBlock("list-item", { list: "bullet", indent: 2 });
      d.insertText(l3, 0, "three");
    });

    caretAtFlat(l2, 0);
    const before = doc.toJSON();
    const prevented = key(wrapperOf(l2), "Tab", { shiftKey: true });

    // Suppressed: the structural gesture ran. The head AND its follower
    // step out one level (the relative indents stand — a lone-head outdent
    // would leave l3 at head + 2, a jump the doc would no longer validate).
    expect(prevented).toBe(false);
    const after = doc.toJSON();
    expect((after.blocks[l2]! as { attrs?: { indent?: number } }).attrs?.indent ?? 0).toBe(0);
    expect((after.blocks[l3]! as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    expect(validateDoc(after)).toEqual([]);
    expect(doc.getChildren(doc.meta.id)).toEqual([l1, l2, l3]); // the order stands

    // One undo step restores the pre-gesture indents.
    act(() => {
      doc.undo();
    });
    expect(doc.toJSON()).toEqual(before);
  });

  it("nests the list item under a previous paragraph (the attach rule holds any page block)", () => {
    let p: BlockId = "";
    let l1: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "x");
      l1 = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(l1, 0, "one");
    });

    caretAtFlat(l1, 0);
    const prevented = key(wrapperOf(l1), "Tab");

    expect(prevented).toBe(false); // suppressed: the structural move ran
    expect(doc.getChildren(doc.meta.id)).toEqual([p, l1]);
    const l1Json = doc.toJSON().blocks[l1]!;
    expect((l1Json as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    // The flat stand: the indented item is its own row at the deeper
    // indent step (the nested slot stands no element — the sequence owns
    // the nesting), the marker's cycle following the level.
    const marker = wrapperOf(l1).querySelector<HTMLElement>('[data-slot="docblocks/row-marker"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-cycle")).toBe("2");
  });
});

describe("blocks selection (gutter)", () => {
  it("a gutter click selects the block and Delete removes it", () => {
    let p1: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
    });
    const wrapper = wrapperOf(p1);
    const gutter = wrapper.querySelector<HTMLElement>('[data-slot="docblocks/gutter"]');
    expect(gutter).not.toBeNull();

    act(() => {
      gutter!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(storeSelection()).toEqual({ kind: "blocks", ids: [p1], anchorId: p1 });
    expect(wrapper.getAttribute("data-selected")).toBe("true");

    key(wrapper, "Delete");

    expect(doc.getBlock(p1)).toBeNull();
    expect(storeSelection()).toEqual({ kind: "none" });
  });

  it("Delete on a gutter-selected segment head removes the whole derived segment (one undo step)", () => {
    let head: BlockId = "";
    let child: BlockId = "";
    const doc = renderDoc((d) => {
      const anchor = d.insertBlock("paragraph");
      d.insertText(anchor, 0, "anchor");
      head = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(head, 0, "head");
      child = d.insertBlock("list-item", { list: "bullet", indent: 1 });
      d.insertText(child, 0, "child");
    });

    const wrapper = wrapperOf(head);
    act(() => {
      wrapper
        .querySelector<HTMLElement>('[data-slot="docblocks/gutter"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(storeSelection()).toEqual({ kind: "blocks", ids: [head], anchorId: head });

    const before = doc.toJSON();
    // The head's core cascade removes the child with it: the handler must
    // skip the already-removed follower — a re-removal would throw the
    // typed error and un-roll the gesture.
    key(wrapper, "Delete");

    expect(doc.getBlock(head)).toBeNull();
    expect(doc.getBlock(child)).toBeNull();
    expect(storeSelection()).toEqual({ kind: "none" });

    // One undo step restores the whole segment (one transact).
    act(() => {
      doc.undo();
    });
    expect(doc.toJSON()).toEqual(before);
  });

  it("shift+click extends the selection to a sibling range", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    let p3: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      p2 = d.insertBlock("paragraph");
      p3 = d.insertBlock("paragraph");
    });

    act(() => {
      wrapperOf(p1)
        .querySelector<HTMLElement>('[data-slot="docblocks/gutter"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    act(() => {
      wrapperOf(p3)
        .querySelector<HTMLElement>('[data-slot="docblocks/gutter"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
    });

    // The range is ordered by siblings, anchored at the first click.
    expect(storeSelection()).toEqual({ kind: "blocks", ids: [p1, p2, p3], anchorId: p1 });
  });

  it("the arrows move a single-block selection and Escape clears it", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      p2 = d.insertBlock("paragraph");
    });

    act(() => {
      wrapperOf(p1)
        .querySelector<HTMLElement>('[data-slot="docblocks/gutter"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(storeSelection()).toEqual({ kind: "blocks", ids: [p1], anchorId: p1 });

    key(wrapperOf(p1), "ArrowDown");
    expect(storeSelection()).toEqual({ kind: "blocks", ids: [p2], anchorId: p2 });
    // The focus's park (the span model: the wrappers are not focusable,
    // the editor root holds the focus over the blocks' navigation).
    expect(document.activeElement).toBe(wrapperOf(p2).closest('[data-slot="docblocks/editor"]'));

    key(wrapperOf(p2), "ArrowUp");
    expect(storeSelection()).toEqual({ kind: "blocks", ids: [p1], anchorId: p1 });

    key(wrapperOf(p1), "Escape");
    expect(storeSelection()).toEqual({ kind: "none" });
    expect(doc.getChildren(doc.meta.id)).toEqual([p1, p2]);
  });
});
