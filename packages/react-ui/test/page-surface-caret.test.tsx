// @vitest-environment jsdom
// The container's caret's reseat: the pure's container's position's flag
// (the inner's / the form's control's no flag, the island's collapsed's
// selection's keep) and the reseat (the nearest's block's edge, the
// beforeinput's suppression over the pure's position).
import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BlockId } from "docblocks-core";

import { containerCaretNeedsReseat, reseatContainerCaret } from "../src/editing/page-surface";
import { innerOf, pageOf, renderDoc, rootOf, seatAtElement, seatInInner, stubRangeRects } from "./page-surface.helpers";

describe("containerCaretNeedsReseat", () => {
  it("flags the pure container position and not the inner's or the form control's caret", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });
    const page = pageOf();
    // A pure container position (the anchor over the container's own
    // flow): the reseat stands.
    seatAtElement(page, 1);
    expect(containerCaretNeedsReseat(page, window.getSelection()!.anchorNode)).toBe(true);
    // The caret inside a block's inner: a valid seat, no reseat.
    seatInInner(p1, 1);
    expect(containerCaretNeedsReseat(page, window.getSelection()!.anchorNode)).toBe(false);
    // A form control inside the container (the caption's input): a
    // genuine landing, no reseat.
    const input = document.createElement("input");
    page.append(input);
    const anchor = document.createTextNode("x");
    input.append(anchor);
    expect(containerCaretNeedsReseat(page, anchor)).toBe(false);
    input.remove();
  });

  it("keeps the isolated surface's collapsed selection (the island stands its own pointer state)", () => {
    renderDoc((d) => {
      const p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
    });
    const page = pageOf();
    // A collapsed selection over the isolated (contenteditable=false)
    // island's element is the island's own pointer state (the grid's cell
    // selection's stand over the press): the reseat must not steal it
    // into the page text (the steal takes the island's focus with it).
    const island = document.createElement("div");
    island.setAttribute("contenteditable", "false");
    page.append(island);
    expect(containerCaretNeedsReseat(page, island)).toBe(false);
    const innerAnchor = document.createTextNode("x");
    island.append(innerAnchor);
    expect(containerCaretNeedsReseat(page, innerAnchor)).toBe(false);
    island.remove();
    // The pure container position over the non-isolated flow keeps the
    // reseat.
    seatAtElement(page, 1);
    expect(containerCaretNeedsReseat(page, window.getSelection()!.anchorNode)).toBe(true);
  });

  it("stands no reseat over the container's position residue while a form control inside holds the focus", () => {
    renderDoc((d) => {
      const p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
    });
    const page = pageOf();
    // The form control's focus's residue: while a control inside the
    // container holds the focus, the browser's document selection stands
    // a collapsed caret at a container position (the control's own caret
    // is the input's, the document's selection is the residue). The
    // residue's reseat would steal the control's focus (the seat's
    // focus's move blurs it — the caption's input's unmount's loop's
    // stand).
    const input = document.createElement("input");
    page.append(input);
    input.focus();
    seatAtElement(page, 1);
    expect(containerCaretNeedsReseat(page, window.getSelection()!.anchorNode)).toBe(false);
    // The focused control outside the container (the consumer's chrome's
    // field) stands the residue's no-parity: the reseat's stand keeps.
    // (The anchor stands explicit: jsdom's focus clears the document's
    // selection, the browser's focus move leaves it standing.)
    seatAtElement(page, 1);
    const anchor = window.getSelection()!.anchorNode;
    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();
    expect(containerCaretNeedsReseat(page, anchor)).toBe(true);
    outside.remove();
    input.remove();
  });
});

describe("reseatContainerCaret", () => {
  it("re-seats the stranded caret into the nearest block's edge (the preceding end over the unmeasurable y)", async () => {
    stubRangeRects();
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });
    const page = pageOf();
    // The caret stranded over the container's end position (the rows are
    // wrapped in the list's layer). Over jsdom the rects stand degenerate,
    // so the document order wins: the preceding block's end (the last
    // inner before the caret).
    seatAtElement(page, page.childElementCount);
    reseatContainerCaret(page, rootOf(), doc);
    await waitFor(() => {
      const selection = window.getSelection()!;
      expect(selection.isCollapsed).toBe(true);
      expect(innerOf(p1).contains(selection.anchorNode)).toBe(false);
      expect(innerOf(p2).contains(selection.anchorNode)).toBe(true);
      // The seat offset: the preceding block's text length (the end).
      expect(selection.anchorOffset).toBe(3);
    });
  });

  it("keeps the seat when the caret already stands in a block", async () => {
    stubRangeRects();
    let p1: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
    });
    const page = pageOf();
    seatInInner(p1, 2);
    reseatContainerCaret(page, rootOf(), doc);
    await waitFor(() => {
      const selection = window.getSelection()!;
      expect(innerOf(p1).contains(selection.anchorNode)).toBe(true);
      expect(selection.anchorOffset).toBe(2);
    });
  });

  it("suppresses the container's beforeinput over the pure position and re-seats (the guard's contract)", async () => {
    stubRangeRects();
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });
    const page = pageOf();
    // The caret stranded over the container's end position (the rows are
    // wrapped in the list's layer; the attributes' panel stands the first
    // child — the end position is over the page's child count). Over
    // jsdom the rects stand degenerate, so the document order wins: the
    // preceding block's end (the last inner before the caret).
    seatAtElement(page, page.childElementCount);
    const event = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "x",
      inputType: "insertText",
    });
    page.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    // The reseat landed the caret over the preceding block's end (the
    // document order over the unmeasurable y).
    await waitFor(() => {
      const selection = window.getSelection()!;
      expect(innerOf(p2).contains(selection.anchorNode)).toBe(true);
      expect(selection.anchorOffset).toBe(3);
    });

    // The input over a valid seat (the caret inside a block) is not
    // suppressed (the input proceeds to the block's commit).
    seatInInner(p2, 3);
    const allowed = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "x",
      inputType: "insertText",
    });
    page.dispatchEvent(allowed);
    expect(allowed.defaultPrevented).toBe(false);
  });
});
