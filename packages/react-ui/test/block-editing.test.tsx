// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BlockId } from "docblocks-core";

import { blockCount, caretAtFlat, flushFrames, innerOf, key, renderDoc, wrapperOf } from "./block-editing.helpers";

describe("Enter: block split", () => {
  it("splits a paragraph mid-text and the tail keeps its mark", async () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "helloworld");
      d.setMark(p, 5, 10, { type: "bold" });
    });
    const before = blockCount(doc);
    const rootId = doc.meta.id;

    caretAtFlat(p, 5);
    key(wrapperOf(p), "Enter");

    const ids = doc.getChildren(rootId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(p);
    const tailId = ids[1]!;
    expect(doc.getText(p)).toBe("hello");
    expect(doc.getText(tailId)).toBe("world");
    expect(doc.getRuns(tailId)).toEqual([{ text: "world", marks: { bold: true } }]);

    // The store rebuilds the DOM: the tail block renders the bold run, and
    // the caret lands at its start (the gesture's DOM-only focus move).
    await flushFrames();
    expect(innerOf(tailId).querySelector("strong")?.textContent).toBe("world");
    const sel = window.getSelection()!;
    expect(innerOf(tailId).contains(sel.anchorNode)).toBe(true);
    expect(sel.anchorOffset).toBe(0);

    // One undo step restores the single block with the full text and mark.
    expect(doc.canUndo).toBe(true);
    act(() => {
      doc.undo();
    });
    expect(blockCount(doc)).toBe(before);
    expect(doc.getRuns(p)).toEqual([
      { text: "hello", marks: {} },
      { text: "world", marks: { bold: true } },
    ]);
    expect(innerOf(p).textContent).toBe("helloworld");
  });

  it("keeps the heading level when splitting", () => {
    let h: BlockId = "";
    const doc = renderDoc((d) => {
      h = d.insertBlock("heading", { level: 2 });
      d.insertText(h, 0, "ab");
    });

    caretAtFlat(h, 1);
    key(wrapperOf(h), "Enter");

    const ids = doc.getChildren(doc.meta.id);
    expect(ids).toHaveLength(2);
    const second = doc.toJSON().blocks[ids[1]!];
    expect(second).toMatchObject({ type: "heading", attrs: { level: 2 } });
    expect(doc.getText(ids[0]!)).toBe("a");
    expect(doc.getText(ids[1]!)).toBe("b");
  });

  it("Enter on the empty last line consumes the trailing soft break (no ghost line)", async () => {
    let li: BlockId = "";
    const doc = renderDoc((d) => {
      li = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(li, 0, "abc\n");
    });
    const before = blockCount(doc);

    // The caret stands on the empty last line (after the trailing soft
    // break — the rendered line anchor carries no logical character).
    caretAtFlat(li, 4);
    key(wrapperOf(li), "Enter");

    const ids = doc.getChildren(doc.meta.id);
    expect(ids).toHaveLength(2);
    const tailId = ids[1]!;
    // The gesture consumes the trailing break (the exit parity over the
    // gesture family): the first block stands without the ghost line, the
    // new sibling is empty (same type and attrs).
    expect(doc.getText(li)).toBe("abc");
    expect(doc.getText(tailId)).toBe("");
    const tail = doc.getBlock(tailId);
    expect(tail?.type).toBe("list-item");

    // One undo step restores the single block with the soft break.
    act(() => {
      doc.undo();
    });
    expect(blockCount(doc)).toBe(before);
    expect(doc.getText(li)).toBe("abc\n");

    // A mid-text split over a soft break keeps the current stand (the new
    // block's leading break is the caret's new line — no data is dropped).
    let p: BlockId = "";
    const doc2 = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "abc\ndef");
    });
    caretAtFlat(p, 3);
    key(wrapperOf(p), "Enter");
    const ids2 = doc2.getChildren(doc2.meta.id);
    expect(doc2.getText(p)).toBe("abc");
    expect(doc2.getText(ids2[1]!)).toBe("\ndef");
  });

  it("a checked task's split spawns an UNCHECKED sibling (the check is not inherited)", () => {
    let t: BlockId = "";
    const doc = renderDoc((d) => {
      t = d.insertBlock("list-item", { list: "task", checked: true });
      d.insertText(t, 0, "ab");
    });

    caretAtFlat(t, 2);
    key(wrapperOf(t), "Enter");

    const ids = doc.getChildren(doc.meta.id);
    expect(ids).toHaveLength(2);
    const next = doc.getBlock(ids[1]!);
    expect(next?.type).toBe("list-item");
    if (next?.type !== "list-item") throw new Error("expected a list-item sibling");
    expect(next.attrs.list).toBe("task");
    // The new item's check stands unset (a checked task's Enter must not
    // spawn a checked sibling — its placeholder would stand struck).
    expect(next.attrs.checked).toBeUndefined();
    // The source item keeps its checked state.
    const src = doc.getBlock(t);
    expect(src?.type).toBe("list-item");
    if (src?.type === "list-item") expect(src.attrs).toMatchObject({ list: "task", checked: true });
  });

  it("is a no-op over an in-block range selection", () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "hello");
    });
    const before = blockCount(doc);
    const inner = innerOf(p);
    const textNode = inner.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(textNode, 3);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    const prevented = key(wrapperOf(p), "Enter");

    expect(prevented).toBe(false); // the browser line split is still suppressed
    expect(blockCount(doc)).toBe(before);
    expect(doc.getText(p)).toBe("hello");
  });
});
