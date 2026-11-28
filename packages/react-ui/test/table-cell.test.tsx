// @vitest-environment jsdom
// The cell-level editing (the table-cell context): the empty-cell
// activation layer (the view-local caret, the first input materializes the
// paragraph), the cell gestures (Enter = the soft break only, Backspace at
// the line start a no-op), and the cell chrome suppression (no
// placeholder, no gutter).
import { act, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { mapDomSelection } from "../src/editing/selection-mapping";
import { activationOf, caretAt, cellParagraphOf, editorContext, innerOf, renderTableDoc } from "./table-cell.helpers";

describe("the empty-cell activation layer", () => {
  it("stands in every empty cell and only there", () => {
    const { tableId, firstCellId } = renderTableDoc(true);
    const table = document.querySelector<HTMLElement>(`[data-block-id="${tableId}"]:not([data-slot="docblocks/row"])`);
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll("tr").length).toBe(2);
    expect(table!.querySelectorAll("td").length).toBe(4);
    // The first cell holds a paragraph (no activation); the other three
    // stand the activation layer (no block-content yet).
    expect(
      table!.querySelector(
        `[data-slot="docblocks/table-cell"][data-block-id="${firstCellId}"] [data-slot="docblocks/cell-activation"]`
      )
    ).toBeNull();
    expect(table!.querySelectorAll("[data-slot='docblocks/cell-activation']").length).toBe(3);
    expect(table!.querySelectorAll("[data-slot='docblocks/block-content']").length).toBe(1);
  });

  it("the empty cell's footprint stands the materialized paragraph's (the first input grows no padding)", () => {
    // The v1 stand: the empty cell's caret sat at the top (the activation
    // layer's own zero margin), the first input's paragraph stood the
    // block's vertical rhythm — the cell grew by the margins' 2×.
    // The layer stands the same rhythm: no jump over the materialization.
    const { tableId } = renderTableDoc(true);
    const filledParagraph = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/block"][data-block-type="paragraph"]`
    );
    expect(filledParagraph).not.toBeNull();
    expect(filledParagraph!.className).toContain("my-(--docblocks-block-spacing)");
    // An empty cell's activation layer (the first empty td's one).
    const emptyTd = document.querySelector(
      `[data-block-id="${tableId}"] [data-slot="docblocks/table-cell"]:not(:has([data-slot='docblocks/block']))`
    );
    expect(emptyTd).not.toBeNull();
    const activation = emptyTd!.querySelector<HTMLElement>("[data-slot='docblocks/cell-activation']");
    expect(activation).not.toBeNull();
    expect(activation!.className).toContain("my-(--docblocks-block-spacing)");
  });

  it("the first input materializes the paragraph with the typed text (one undo step)", () => {
    const { doc, firstCellId } = renderTableDoc(false);
    expect(doc.getChildren(firstCellId)).toEqual([]);
    const activation = activationOf(firstCellId);

    act(() => {
      activation.focus();
      activation.textContent = "typed";
      fireEvent.input(activation);
    });

    // One paragraph child with the typed text.
    const children = doc.getChildren(firstCellId);
    expect(children).toHaveLength(1);
    expect(doc.getTextLength(children[0]!)).toBe(5);
    expect(doc.getText(children[0]!)).toBe("typed");
    // The real paragraph replaces the layer in the DOM.
    expect(activation.isConnected).toBe(false);
    const paragraph = cellParagraphOf(firstCellId);
    expect(innerOf(paragraph).textContent).toBe("typed");
    // One undo step: the whole materialize (the block + the text) rolls
    // back to the empty cell.
    doc.undo();
    expect(doc.getChildren(firstCellId)).toEqual([]);
  });

  it("keeps no data while it stands: focusing and moving the caret writes nothing", () => {
    const { doc, firstCellId } = renderTableDoc(false);
    const before = Object.keys(doc.toJSON().blocks).length;
    const activation = activationOf(firstCellId);
    act(() => {
      activation.focus();
    });
    // The doc is untouched: the cell holds no blocks, no new block stands.
    expect(doc.getChildren(firstCellId)).toEqual([]);
    expect(Object.keys(doc.toJSON().blocks).length).toBe(before);
  });

  it("Enter on the empty layer is a no-op (the cell stays empty)", () => {
    const { doc, firstCellId } = renderTableDoc(false);
    const activation = activationOf(firstCellId);
    act(() => {
      activation.focus();
    });
    act(() => {
      activation.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    // The cell holds no blocks and the layer stands without a line break.
    expect(doc.getChildren(firstCellId)).toEqual([]);
    expect(activation.querySelectorAll("br, div").length).toBe(0);
  });

  it("merges into a concurrently arrived paragraph (the empty paragraphs do not multiply)", () => {
    const { doc, firstCellId } = renderTableDoc(false);
    const activation = activationOf(firstCellId);
    act(() => {
      activation.focus();
      // A peer activates the same cell before this client's input commits:
      // the paragraph stands in the doc while the layer is still mounted.
      const peerId = doc.insertBlock("paragraph", undefined, { parent: firstCellId });
      doc.insertText(peerId, 0, "peer");
      activation.textContent = "after";
      fireEvent.input(activation);
    });
    // The input landed in the arrived paragraph (no second one).
    const children = doc.getChildren(firstCellId);
    expect(children).toHaveLength(1);
    expect(doc.getText(children[0]!)).toBe("peerafter");
  });

  it("the layer's caret maps to no doc selection: Backspace and Delete write nothing", () => {
    const { doc, tableId, firstCellId } = renderTableDoc(false);
    const before = Object.keys(doc.toJSON().blocks).length;
    const activation = activationOf(firstCellId);
    act(() => {
      activation.focus();
    });
    // The DOM caret stands in the layer (the browser seats it there on the
    // focus of an empty editable).
    const range = document.createRange();
    range.selectNodeContents(activation);
    range.collapse(true);
    const domSelection = window.getSelection();
    expect(domSelection).not.toBeNull();
    domSelection!.removeAllRanges();
    domSelection!.addRange(range);
    // The mapping yields `none` (a `blocks` selection would flag the table
    // row as selected and hand it to the delete gesture).
    const root = document.querySelector<HTMLElement>('[data-slot="docblocks/editor"]');
    expect(root).not.toBeNull();
    expect(mapDomSelection(root!, window.getSelection()!, doc)).toEqual({ kind: "none" });
    const selectionView = editorContext?.selection.view;
    expect(selectionView?.get().kind).toBe("none");
    // Backspace and Delete in the layer are no-ops (the doc is untouched).
    act(() => {
      activation.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    });
    act(() => {
      activation.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    });
    expect(Object.keys(doc.toJSON().blocks).length).toBe(before);
    expect(doc.getBlock(tableId)?.type).toBe("table");
    expect(doc.getChildren(firstCellId)).toEqual([]);
  });
});

describe("the cell chrome", () => {
  it("the cell paragraph stands without the slash hint and the row grip", () => {
    const { doc, pageId, firstCellId } = renderTableDoc(true);
    const cellParagraphId = doc.getChildren(firstCellId)[0]!;
    const cellInner = document.querySelector<HTMLElement>(
      `[data-block-id="${cellParagraphId}"][data-slot="docblocks/block-content"]`
    );
    expect(cellInner, "the cell paragraph inner should be rendered").not.toBeNull();
    expect(cellInner!.dataset.placeholder, "no slash hint in a cell").toBeUndefined();
    expect(
      cellInner!.closest("[data-slot='docblocks/block']")!.querySelector("[data-slot='docblocks/gutter']"),
      "no grip in a cell"
    ).toBeNull();
    // The page paragraph keeps both (the context is cell-only).
    const pageInner = document.querySelector<HTMLElement>(
      `[data-block-id="${pageId}"][data-slot="docblocks/block-content"]`
    );
    expect(pageInner!.dataset.placeholder).toBe("Type '/' for commands");
    expect(
      pageInner!.closest("[data-slot='docblocks/block']")!.querySelector("[data-slot='docblocks/gutter']")
    ).not.toBeNull();
  });
});

describe("the cell keyboard gestures", () => {
  it("Enter is a soft line break at every position (no split, no exit)", () => {
    const { doc, firstCellId } = renderTableDoc(true);
    const paragraphId = doc.getChildren(firstCellId)[0]!;
    const wrapper = cellParagraphOf(firstCellId);
    const inner = innerOf(wrapper);
    caretAt(inner, 5);

    act(() => {
      wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    // One `\n` at the caret; the cell still holds a single paragraph.
    expect(doc.getChildren(firstCellId)).toHaveLength(1);
    expect(doc.getText(paragraphId)).toBe("cell \ntext");
    expect(inner.querySelectorAll("br, div").length).toBe(0);
  });

  it("Backspace at the line start is a no-op (no merge with the previous paragraph)", () => {
    const { doc, firstCellId } = renderTableDoc(true);
    let secondParagraph = "";
    act(() => {
      secondParagraph = doc.insertBlock("paragraph", undefined, { parent: firstCellId });
      doc.insertText(secondParagraph, 0, "second line");
    });
    // The store projects the new child (the provider's doc subscription),
    // so the second paragraph stands in the DOM after the act flush.
    const cell = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/table-cell"][data-block-id="${firstCellId}"]:not([data-slot="docblocks/row"])`
    );
    const inner = cell!.querySelector<HTMLElement>(
      `[data-block-id="${secondParagraph}"] [data-slot="docblocks/block-content"]`
    );
    expect(inner, "the second paragraph should render").not.toBeNull();
    const secondInner = inner!;
    caretAt(secondInner, 0);

    act(() => {
      secondInner.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    });

    // Nothing was removed: both paragraphs stand, the caret's text intact.
    expect(doc.getChildren(firstCellId)).toHaveLength(2);
    expect(doc.getText(secondParagraph)).toBe("second line");
  });
});
