// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { BlockId } from "docblocks-core";

import { key, renderDoc, setViewSelection, viewSelection, wrapperOf } from "./keyboard.helpers";

describe("mod+shift+arrow: block move", () => {
  it("moves the selected block down one slot; the selection follows", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    let p3: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "a");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "b");
      p3 = d.insertBlock("paragraph");
      d.insertText(p3, 0, "c");
    });

    // A single-block blocks selection held on p1 (the wrapper-focused gutter selection).
    setViewSelection({ kind: "blocks", ids: [p1], anchorId: p1 });
    const prevented = key(wrapperOf(p1), { key: "ArrowDown", ctrlKey: true, shiftKey: true });

    expect(prevented).toBe(false);
    expect(doc.getChildren(doc.meta.id)).toEqual([p2, p1, p3]);
    // The selection is blocks-kind by id — it survived the move and is re-set.
    expect(viewSelection()).toEqual({ kind: "blocks", ids: [p1], anchorId: p1 });
  });

  it("moves the selected block up one slot", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "a");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "b");
    });

    setViewSelection({ kind: "blocks", ids: [p2], anchorId: p2 });
    expect(key(wrapperOf(p2), { key: "ArrowUp", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(doc.getChildren(doc.meta.id)).toEqual([p2, p1]);
    expect(viewSelection()).toEqual({ kind: "blocks", ids: [p2], anchorId: p2 });
  });

  it("clamps at the sibling edges and ignores a selection held elsewhere", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    let p3: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "a");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "b");
      p3 = d.insertBlock("paragraph");
      d.insertText(p3, 0, "c");
    });

    // Last block, ArrowDown: nothing to move into.
    setViewSelection({ kind: "blocks", ids: [p3], anchorId: p3 });
    expect(key(wrapperOf(p3), { key: "ArrowDown", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(doc.getChildren(doc.meta.id)).toEqual([p1, p2, p3]);

    // First block, ArrowUp: nothing to move into.
    setViewSelection({ kind: "blocks", ids: [p1], anchorId: p1 });
    expect(key(wrapperOf(p1), { key: "ArrowUp", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(doc.getChildren(doc.meta.id)).toEqual([p1, p2, p3]);

    // A blocks selection held on another block: this wrapper is a no-op.
    setViewSelection({ kind: "blocks", ids: [p2], anchorId: p2 });
    expect(key(wrapperOf(p1), { key: "ArrowDown", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(doc.getChildren(doc.meta.id)).toEqual([p1, p2, p3]);

    // A text selection (no blocks selection): the gesture does not apply.
    setViewSelection({ kind: "text", from: { blockId: p1, offset: 0 }, to: null });
    expect(key(wrapperOf(p1), { key: "ArrowDown", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(doc.getChildren(doc.meta.id)).toEqual([p1, p2, p3]);
  });
});
