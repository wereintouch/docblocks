// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import {
  containerCaretNeedsReseat,
  isPageSurfaceInner,
  reseatContainerCaret,
  surfaceInnerOf,
} from "../src/editing/page-surface";
import { EditorProvider } from "../src/editor-provider";

/** jsdom's Range stands no getBoundingClientRect: the reseat's rect read
 *  falls back to the document order over the degenerate stand. */
function stubRangeRects(): void {
  if (typeof Range.prototype.getBoundingClientRect !== "function") {
    Range.prototype.getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => null }) as DOMRect;
  }
}

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

function renderDoc(prepare: (doc: TestDoc) => void): TestDoc {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider doc={doc}>
      <Editor />
    </EditorProvider>
  );
  return doc;
}

/** The editor root element. */
function rootOf(): HTMLElement {
  const root = document.querySelector<HTMLElement>('[data-slot="docblocks/editor"]');
  expect(root, "the editor root should be rendered").not.toBeNull();
  return root!;
}

/** The page container (the single editable of the edit mode). */
function pageOf(): HTMLElement {
  const page = rootOf().querySelector<HTMLElement>('[data-slot="docblocks/page"]');
  expect(page, "the page container should be rendered").not.toBeNull();
  return page!;
}

/** The inner editable of the block's wrapper. */
function innerOf(id: BlockId): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"] [data-slot="docblocks/block-content"]`);
  expect(el, `the block ${id}'s inner should be rendered`).not.toBeNull();
  return el!;
}

/** Seat a collapsed DOM caret at the element position (the container's gap). */
function seatAtElement(el: HTMLElement, index: number): void {
  const range = document.createRange();
  range.setStart(el, index);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Seat a collapsed DOM caret at the block's flat character offset. */
function seatInInner(id: BlockId, offset: number): void {
  const inner = innerOf(id);
  const range = document.createRange();
  range.selectNodeContents(inner);
  range.setStart(inner, 0);
  // Walk the text nodes over the offset (the runs' inlines).
  let remaining = offset;
  let node: Node | null = inner.firstChild;
  while (node !== null && remaining > 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.nodeValue?.length ?? 0;
      if (remaining <= length) {
        range.setStart(node, remaining);
        break;
      }
      remaining -= length;
    }
    node = node.nextSibling;
  }
  if (remaining === 0 && node !== null && node.nodeType === Node.TEXT_NODE) range.setStart(node, 0);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

describe("the page surface's single editable (the span model)", () => {
  it("the page container is the one editable of the edit mode (the inners nest inside it)", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });
    const page = pageOf();
    expect(page.getAttribute("contenteditable")).toBe("true");
    // The inners are nested editables of the same scope (the native
    // selection crosses the rows over one editable region).
    const inner1 = innerOf(p1);
    expect(page.contains(inner1)).toBe(true);
    expect(inner1.getAttribute("contenteditable")).toBe("true");
    // The inner's nearest contenteditable ancestor is the inner itself,
    // and the container's is the container: no ce=false island stands
    // between them for a page text block.
    expect(inner1.closest('[contenteditable="false"]')).toBeNull();
  });

  it("the isolated surfaces stand behind the contenteditable false boundary", () => {
    let tableId: BlockId = "";
    let cellId: BlockId = "";
    renderDoc((d) => {
      const a = d.insertBlock("paragraph");
      d.insertText(a, 0, "page");
      tableId = d.insertBlock("table");
      const row = d.insertBlock("table-row", undefined, { parent: tableId });
      cellId = d.insertBlock("table-cell", undefined, { parent: row });
      d.insertText(cellId, 0, "cell");
    });
    const page = pageOf();
    // The table's scroll wrapper isolates the grid (the cells' inners
    // stand their own focused editables, not the page surface's).
    const cellInner = innerOf(cellId);
    expect(page.contains(cellInner)).toBe(true);
    expect(isPageSurfaceInner(cellInner)).toBe(false);
    const island = cellInner.closest('[contenteditable="false"]')!;
    expect(island, "the cell inner should sit behind a ce=false island").not.toBeNull();
    expect(rootOf().contains(island)).toBe(true);
  });
});

describe("surfaceInnerOf", () => {
  it("resolves the block inner over the anchor and not the island's inner", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    let tableId: BlockId = "";
    let cellId: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      tableId = d.insertBlock("table");
      const row = d.insertBlock("table-row", undefined, { parent: tableId });
      cellId = d.insertBlock("table-cell", undefined, { parent: row });
      d.insertText(cellId, 0, "cell");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });
    const page = pageOf();
    // The anchor over p1's text: p1's inner.
    seatInInner(p1, 1);
    expect(surfaceInnerOf(page, window.getSelection()!.anchorNode)).toBe(innerOf(p1));
    // The anchor over the cell's inner: the island stands the null (the
    // cell's own handlers own its keys).
    const cellText = innerOf(cellId).firstChild;
    expect(cellText, "the cell should render its text").not.toBeNull();
    expect(surfaceInnerOf(page, cellText!)).toBeNull();
    // The anchor over a pure container position: the null.
    seatAtElement(page, 0);
    expect(surfaceInnerOf(page, window.getSelection()!.anchorNode)).toBeNull();
  });
});

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
    seatAtElement(page, 1);
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
