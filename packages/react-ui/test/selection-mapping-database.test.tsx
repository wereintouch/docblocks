// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { mapDomSelection } from "../src/editing/selection-mapping";
import { renderDoc, rootOf } from "./selection-mapping.helpers";

describe("the database block's guard (the cells and the chrome map to none)", () => {
  // The block's DOM stand (the scroller's grid + the chrome's Add row
  // button OUTSIDE the grid — the layout that stood the original bug: a
  // double-click's word selection over the button's text escaped the
  // grid-only guard). The block wrapper carries a `data-block-id` (the
  // real stand), so without the guard the chrome's selection would stand
  // a `blocks` selection over the block.
  function withDatabaseChrome(): HTMLElement {
    const root = rootOf();
    const block = document.createElement("div");
    block.setAttribute("data-slot", "docblocks/database");
    block.setAttribute("data-block-id", "db-fake");
    const grid = document.createElement("div");
    grid.setAttribute("data-slot", "docblocks/database-grid");
    const cellText = document.createTextNode("cell value");
    grid.appendChild(cellText);
    const addRow = document.createElement("button");
    addRow.setAttribute("data-slot", "docblocks/database-add-row");
    const buttonLabel = document.createTextNode("+ Add row");
    addRow.appendChild(buttonLabel);
    block.appendChild(grid);
    block.appendChild(addRow);
    root.appendChild(block);
    return block;
  }

  it("a selection over the chrome (the Add row button's text) maps to none", () => {
    const doc = renderDoc((d) => {
      d.insertBlock("paragraph");
    });
    const block = withDatabaseChrome();
    const label = block.querySelector<HTMLElement>('[data-slot="docblocks/database-add-row"]')!.firstChild!;
    const range = document.createRange();
    range.setStart(label, 0);
    range.setEnd(label, 9);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(mapDomSelection(rootOf(), selection, doc)).toEqual({ kind: "none" });
  });

  it("a selection over the grid's cell text maps to none (the guard's original stand)", () => {
    const doc = renderDoc((d) => {
      d.insertBlock("paragraph");
    });
    const block = withDatabaseChrome();
    const cell = block.querySelector<HTMLElement>('[data-slot="docblocks/database-grid"]')!.firstChild!;
    const range = document.createRange();
    range.setStart(cell, 0);
    range.setEnd(cell, 5);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(mapDomSelection(rootOf(), selection, doc)).toEqual({ kind: "none" });
  });

  it("the chrome's collapsed caret (no range) maps to none", () => {
    const doc = renderDoc((d) => {
      d.insertBlock("paragraph");
    });
    const block = withDatabaseChrome();
    const label = block.querySelector<HTMLElement>('[data-slot="docblocks/database-add-row"]')!.firstChild!;
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.collapse(label, 3);
    expect(mapDomSelection(rootOf(), selection, doc)).toEqual({ kind: "none" });
  });
});
