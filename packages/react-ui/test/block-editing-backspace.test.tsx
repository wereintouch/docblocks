// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { BlockId } from "docblocks-core";

import { caretOffsetIn } from "../src/editing/dom-offset";
import { blockCount, caretAtFlat, flushFrames, innerOf, key, renderDoc, wrapperOf } from "./block-editing.helpers";

describe("Backspace: block merge", () => {
  it("merges into the previous paragraph and keeps the marks", async () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "ab");
      d.setMark(p1, 0, 1, { type: "bold" });
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "cd");
    });

    caretAtFlat(p2, 0);
    key(wrapperOf(p2), "Backspace");

    expect(doc.getBlock(p2)).toBeNull();
    expect(doc.getText(p1)).toBe("abcd");
    expect(doc.getRuns(p1)).toEqual([
      { text: "a", marks: { bold: true } },
      { text: "bcd", marks: {} },
    ]);

    // The caret lands at the join point (the previous block's old length),
    // measured flat across the run inlines.
    await flushFrames();
    const sel = window.getSelection()!;
    expect(innerOf(p1).contains(sel.anchorNode)).toBe(true);
    expect(caretOffsetIn(innerOf(p1), sel.anchorNode!, sel.anchorOffset)).toBe(2);
  });

  it("removes a non-text previous sibling instead of merging", () => {
    let dividerId: BlockId = "";
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      dividerId = d.insertBlock("divider");
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "x");
    });

    caretAtFlat(p, 0);
    key(wrapperOf(p), "Backspace");

    expect(doc.getBlock(dividerId)).toBeNull();
    expect(doc.getBlock(p)).not.toBeNull();
    expect(doc.getText(p)).toBe("x");
  });

  it("is a no-op over the container previous (the surface's figures stand — no cascade)", async () => {
    // The empty-doc canvas: the figure's placement stands the surface,
    // the tail's guarantee stands the trailing paragraph after it. The
    // Backspace at the trailing paragraph's offset 0 (the caret's home
    // over the stand) must not remove the surface (the non-text branch's
    // cascade would delete the figures with it — the data loss).
    let surfaceId: BlockId = "";
    let shapeId: BlockId = "";
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      const a = d.insertBlock("paragraph");
      d.insertText(a, 0, "page");
      surfaceId = d.insertBlock("surface");
      shapeId = d.insertBlock("shape", { variant: "rect" }, { parent: surfaceId });
      d.setGeometry(shapeId, { x: 0, y: 0, w: 100, h: 60 });
      p = d.insertBlock("paragraph");
    });

    // The caret at the empty trailing paragraph's start (no text node —
    // the element's start position).
    const emptyInner = innerOf(p);
    const emptyRange = document.createRange();
    emptyRange.selectNodeContents(emptyInner);
    emptyRange.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(emptyRange);
    const prevented = key(wrapperOf(p), "Backspace");

    // Suppressed: the gesture found no merge, and the native default is
    // not run (the nested editable's line-backspace would mutate the page
    // container's DOM over the span model).
    expect(prevented).toBe(false);
    expect(doc.getBlock(surfaceId)).not.toBeNull();
    expect(doc.getBlock(shapeId)).not.toBeNull();
    expect(doc.getChildren(surfaceId)).toEqual([shapeId]);
    expect(doc.getBlock(p)).not.toBeNull();
  });

  it("the table's previous stands deleted (the rows' cascade over the Backspace's explicit deletion)", async () => {
    // Every block is Backspace-deletable: the table stands removed with
    // its rows (the core's removeBlock cascades the segment); the canvas
    // containers keep the no-op (the whole canvas / nested page's
    // deletion is not a single-Backspace gesture). The caret stands in
    // the surviving block.
    let tableId: BlockId = "";
    let rowId: BlockId = "";
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      const a = d.insertBlock("paragraph");
      d.insertText(a, 0, "page");
      tableId = d.insertBlock("table");
      rowId = d.insertBlock("table-row", undefined, { parent: tableId });
      d.insertBlock("table-cell", undefined, { parent: rowId });
      p = d.insertBlock("paragraph");
    });
    const tableEmptyInner = innerOf(p);
    const tableEmptyRange = document.createRange();
    tableEmptyRange.selectNodeContents(tableEmptyInner);
    tableEmptyRange.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(tableEmptyRange);
    const prevented = key(wrapperOf(p), "Backspace");

    // Suppressed (dispatchEvent stands false over the preventDefault): the
    // gesture found the merge (the no-op stand would have returned true).
    expect(prevented).toBe(false);
    expect(doc.getBlock(tableId)).toBeNull();
    expect(doc.getBlock(rowId)).toBeNull();
    expect(doc.getBlock(p)).not.toBeNull();
  });

  it("is a no-op when the current block is inside the previous block's segment (no data loss)", () => {
    // a / divider / x(indent 1): x sits inside the divider's derived
    // segment (the divider is x's attach parent). The old non-text branch
    // removed the divider's segment — which includes x — deleting its text
    // and re-seating the caret on the removed block. The merge is a no-op:
    // the caret stands, nothing is deleted, no doc write.
    let dividerId: BlockId = "";
    let x: BlockId = "";
    const doc = renderDoc((d) => {
      const a = d.insertBlock("paragraph");
      d.insertText(a, 0, "a");
      dividerId = d.insertBlock("divider");
      x = d.insertBlock("paragraph", { indent: 1 });
      d.insertText(x, 0, "x");
    });
    const before = blockCount(doc);
    const canUndoBefore = doc.canUndo;

    caretAtFlat(x, 0);
    const prevented = key(wrapperOf(x), "Backspace");

    // Suppressed: the gesture found no merge, and the native default is
    // not run (the nested editable's line-backspace would mutate the page
    // container's DOM over the span model).
    expect(prevented).toBe(false);
    expect(blockCount(doc)).toBe(before);
    expect(doc.getBlock(dividerId)).not.toBeNull();
    expect(doc.getBlock(x)).not.toBeNull();
    expect(doc.getText(x)).toBe("x");
    expect(doc.canUndo).toBe(canUndoBefore); // no doc write
  });

  it("is a no-op on the first root block", () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "x");
    });
    const before = blockCount(doc);

    caretAtFlat(p, 0);
    const prevented = key(wrapperOf(p), "Backspace");

    expect(prevented).toBe(false); // suppressed: the no-merge stand does not run the native default
    expect(blockCount(doc)).toBe(before);
    expect(doc.getText(p)).toBe("x");
  });
});
