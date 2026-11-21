// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { createSelection } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { mapDomSelection } from "../src/editing/selection-mapping";
import { renderDoc, rootOf, selectAcross, selectElements, textNodeOf, wrapperOf } from "./selection-mapping.helpers";

describe("DOM selection mapping (cross-block ranges)", () => {
  it("maps a cross-block DOM range to a text range over both blocks", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta");
    });

    selectAcross(p1, 2, p2, 3);
    const mapped = mapDomSelection(rootOf(), window.getSelection(), doc);
    expect(mapped).toEqual({ kind: "text", from: { blockId: p1, offset: 2 }, to: { blockId: p2, offset: 3 } });
  });

  it("maps a right-to-left drag to the same points with reverse", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    // The anchor is the document-order-last endpoint (a right-to-left drag).
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta");
    });
    window.getSelection()!.setBaseAndExtent(textNodeOf(p2), 3, textNodeOf(p1), 2);
    const mapped = mapDomSelection(rootOf(), window.getSelection(), doc);
    expect(mapped).toEqual({
      kind: "text",
      from: { blockId: p1, offset: 2 },
      to: { blockId: p2, offset: 3 },
      reverse: true,
    });
  });

  it("maps the cross range from the range's endpoints when the focus reads clamped (the webkit's stand)", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one world");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "another world");
    });
    const a = textNodeOf(p1);
    const b = textNodeOf(p2);
    const range = document.createRange();
    range.setStart(a, 1);
    range.setEnd(b, 0);
    // The engine's clamped read-back: the anchor and the focus stand in the
    // anchor's own editable (the range carries the far endpoint).
    const clamped = {
      anchorNode: a,
      anchorOffset: 1,
      focusNode: a,
      focusOffset: 9,
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection;
    expect(mapDomSelection(rootOf(), clamped, doc)).toEqual({
      kind: "text",
      from: { blockId: p1, offset: 1 },
      to: { blockId: p2, offset: 0 },
    });
  });

  it("the engine fills the blocks chain on set (the mapping never computes it)", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta");
    });

    selectAcross(p1, 0, p2, 4);
    const mapped = mapDomSelection(rootOf(), window.getSelection(), doc);
    const view = createSelection(doc);
    view.set(mapped);
    const state = view.get();
    expect(state.kind).toBe("text");
    if (state.kind === "text") expect(state.blocks).toEqual([p1, p2]);
    view.destroy();
  });

  it("resolves a non-text first endpoint to the nearest text boundary in reading order", () => {
    // A leading divider has no preceding text: the endpoint takes the START
    // of the nearest following block.
    let d0: BlockId = "";
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      d0 = d.insertBlock("divider");
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta");
    });
    selectElements(wrapperOf(d0), textNodeOf(p2));
    const mapped = mapDomSelection(rootOf(), window.getSelection(), doc);
    expect(mapped).toEqual({ kind: "text", from: { blockId: p1, offset: 0 }, to: { blockId: p2, offset: 0 } });
  });

  it("a non-text first endpoint with preceding text takes the END of the nearest preceding block", () => {
    let p1: BlockId = "";
    let d1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      d1 = d.insertBlock("divider");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta");
    });

    selectElements(wrapperOf(d1), textNodeOf(p2));
    const mapped = mapDomSelection(rootOf(), window.getSelection(), doc);
    expect(mapped).toEqual({ kind: "text", from: { blockId: p1, offset: 5 }, to: { blockId: p2, offset: 0 } });
  });

  it("a non-text last endpoint over the guaranteed tail takes the START of the trailing paragraph", () => {
    let p1: BlockId = "";
    let d2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      d.insertBlock("paragraph");
      d2 = d.insertBlock("divider");
    });

    // The editor's tail guarantee stood the empty paragraph over the
    // divider's end (the non-text last block stands no caret home) — the
    // endpoint stands it (the following text's start).
    const tailId = doc.getChildren(doc.meta.id)[doc.getChildren(doc.meta.id).length - 1]!;
    selectElements(textNodeOf(p1), wrapperOf(d2));
    const mapped = mapDomSelection(rootOf(), window.getSelection(), doc);
    expect(mapped).toEqual({ kind: "text", from: { blockId: p1, offset: 0 }, to: { blockId: tailId, offset: 0 } });
  });

  it("the endpoint over the non-text tail resolves to the guaranteed trailing paragraph", () => {
    let p1: BlockId = "";
    let d1: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      d1 = d.insertBlock("divider");
    });

    // The tail guarantee stood the empty paragraph over the divider's end:
    // the end endpoint lands on it (the cross-block range over the seam —
    // the degenerate caret stands only over the no-following-text state,
    // which the rendered editor's tail never reaches).
    const tailId = doc.getChildren(doc.meta.id)[doc.getChildren(doc.meta.id).length - 1]!;
    const range = document.createRange();
    range.setStart(textNodeOf(p1), 5);
    range.setEnd(wrapperOf(d1), 0);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const mapped = mapDomSelection(rootOf(), window.getSelection(), doc);
    expect(mapped).toEqual({ kind: "text", from: { blockId: p1, offset: 5 }, to: { blockId: tailId, offset: 0 } });
  });

  it("a selection touching no text block maps to the blocks kind", () => {
    let p1: BlockId = "";
    let d1: BlockId = "";
    let d2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      d1 = d.insertBlock("divider");
      d2 = d.insertBlock("divider");
    });

    selectElements(wrapperOf(d1), wrapperOf(d2));
    const mapped = mapDomSelection(rootOf(), window.getSelection(), doc);
    expect(mapped).toEqual({ kind: "blocks", ids: [d1, d2], anchorId: d1 });
  });

  it("a non-editable selection inside the canvas view maps to none (the engine's focus default)", () => {
    let p1: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
    });

    // The canvas view's chrome over the root: the engine's focus move
    // over a canvas item (the mousedown's default focuses the
    // non-editable) leaves a collapsed selection over the item. The
    // canvas manages its own selection (the explicit press), so the
    // mapping must not flag the focused item over the page's selection.
    const root = rootOf();
    const canvasView = document.createElement("div");
    canvasView.setAttribute("data-slot", "docblocks/canvas-view");
    const item = document.createElement("div");
    item.setAttribute("data-slot", "docblocks/canvas-item");
    item.setAttribute("data-block-id", "shape-1");
    canvasView.appendChild(item);
    root.appendChild(canvasView);

    const range = document.createRange();
    range.setStart(item, 0);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(mapDomSelection(root, selection, doc)).toEqual({ kind: "none" });
  });

  it("a collapsed selection inside one block stays a caret", () => {
    let p1: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
    });

    selectAcross(p1, 3, p1, 3);
    const mapped = mapDomSelection(rootOf(), window.getSelection(), doc);
    expect(mapped).toEqual({ kind: "text", from: { blockId: p1, offset: 3 }, to: null });
  });

  it("an empty DOM selection maps to none", () => {
    let p1: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
    });

    const mapped = mapDomSelection(rootOf(), window.getSelection(), doc);
    expect(mapped).toEqual({ kind: "none" });
  });

  it("resolves a non-text endpoint over a nested editor to the nearest own-scope block", () => {
    let p1: BlockId = "";
    let divider: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      divider = d.insertBlock("divider");
    });

    // A nested sync-embed editor between the paragraph and the divider,
    // rendering a foreign doc's text block.
    const nested = document.createElement("div");
    nested.setAttribute("data-slot", "docblocks/editor");
    const foreign = document.createElement("div");
    foreign.setAttribute("data-block-id", "foreign-1");
    foreign.setAttribute("contenteditable", "true");
    foreign.textContent = "master text";
    nested.appendChild(foreign);
    wrapperOf(divider).before(nested);

    // The range spans from the paragraph into the divider (a non-text
    // endpoint) over the nested editor. The tail guarantee stood the
    // trailing paragraph over the divider's end — the endpoint stands it.
    const tailId = doc.getChildren(doc.meta.id)[doc.getChildren(doc.meta.id).length - 1]!;
    const range = document.createRange();
    range.setStart(textNodeOf(p1), 1);
    range.setEnd(wrapperOf(divider), 0);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const mapped = mapDomSelection(rootOf(), selection, doc);
    expect(mapped).toEqual({
      kind: "text",
      from: { blockId: p1, offset: 1 },
      to: { blockId: tailId, offset: 0 },
    });
    // The foreign block id must never reach the engine (its selection view
    // rejects the unknown id).
    expect(JSON.stringify(mapped)).not.toContain("foreign-1");
    const view = createSelection(doc);
    expect(() => view.set(mapped)).not.toThrow();
  });
});
