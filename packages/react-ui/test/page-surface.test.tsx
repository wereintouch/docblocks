// @vitest-environment jsdom
// The page surface's single editable (the span's model): the page's
// container's one editable's stand (the inners' nesting, the isolated's
// surface's ce=false's boundary) and the surfaceInnerOf's resolution
// (the anchor's inner, the island's / the container's null).
import { describe, expect, it } from "vitest";

import type { BlockId } from "docblocks-core";

import { isPageSurfaceInner, surfaceInnerOf } from "../src/editing/page-surface";
import { innerOf, pageOf, renderDoc, rootOf, seatAtElement, seatInInner } from "./page-surface.helpers";

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
