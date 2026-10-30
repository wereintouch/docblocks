// @vitest-environment jsdom
// The cell's own content layer: a table-cell may carry its own runs in
// addition to its children blocks (the v1 text-cell shape); the runs render
// as an editable layer at the top of the cell with the inCell gesture model
// (Enter is a soft line break, Backspace at the line start is a no-op, the
// paste is plain text only).
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/**
 * A 1x2 table whose first cell carries its own runs; `withChild` adds a
 * paragraph child to the same cell. Captures the cell id.
 */
function renderCellDoc(withChild = false) {
  const doc = createDoc({ id: "doc-crc", createdAt: CREATED_AT });
  const tableId = doc.insertBlock("table", { cols: 2 });
  const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
  const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
  doc.insertBlock("table-cell", undefined, { parent: rowId });
  doc.insertText(cellId, 0, "cell");
  if (withChild) {
    const paragraphId = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(paragraphId, 0, "child paragraph");
  }
  render(
    <EditorProvider doc={doc}>
      <Editor />
    </EditorProvider>
  );
  return { doc, tableId, rowId, cellId };
}

/** The cell's own content layer (the inner editable of the cell). */
function cellInner(cellId: BlockId): HTMLElement {
  const inner = document.querySelector<HTMLElement>(
    `td[data-block-id="${cellId}"] [data-slot="docblocks/block-content"]`
  );
  expect(inner, "the cell's own content layer should render").not.toBeNull();
  return inner!;
}

afterEach(() => {
  cleanup();
});

describe("the cell's own content layer", () => {
  it("renders the cell's runs (the text stands above the children, no activation layer)", () => {
    const { cellId } = renderCellDoc();
    const inner = cellInner(cellId);
    expect(inner.textContent).toBe("cell");
    // The cell carries runs: its own activation layer is absent (the second
    // empty cell's stands — the scope is this td).
    expect(document.querySelector(`td[data-block-id="${cellId}"] [data-slot="docblocks/cell-activation"]`)).toBeNull();
  });

  it("applies the run marks to the layer's DOM", () => {
    const { doc, cellId } = renderCellDoc();
    act(() => {
      doc.setMark(cellId, 0, 4, { type: "bold" });
    });
    const inner = cellInner(cellId);
    expect(inner.querySelector("strong")?.textContent).toBe("cell");
  });

  it("renders the runs above the children blocks (both stand)", () => {
    const { cellId } = renderCellDoc(true);
    const td = document.querySelector<HTMLElement>(`td[data-block-id="${cellId}"]`);
    const inner = cellInner(cellId);
    const child = document.querySelector<HTMLElement>(`td[data-block-id="${cellId}"] [data-block-type="paragraph"]`);
    expect(child?.textContent).toBe("child paragraph");
    expect(inner).not.toBeNull();
    // The runs layer stands before the children in the cell.
    expect(td!.compareDocumentPosition(child!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the input commits to the cell's own content (one undo step)", () => {
    const { doc, cellId } = renderCellDoc();
    const inner = cellInner(cellId);
    act(() => {
      inner.textContent = "cell!";
      fireEvent.input(inner);
    });
    expect(doc.getText(cellId)).toBe("cell!");
    act(() => {
      doc.undo();
    });
    expect(doc.getText(cellId)).toBe("cell");
  });

  it("Enter is a soft line break (the inCell model: no split, no paragraph)", () => {
    const { doc, cellId, rowId } = renderCellDoc();
    const inner = cellInner(cellId);
    act(() => {
      inner.textContent = "cell";
      inner.focus();
      // Seat the DOM caret at the end (the gesture reads the caret from the
      // DOM selection).
      const selection = window.getSelection();
      const range = document.createRange();
      const textNode = Array.from(inner.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
      range.setStart(textNode!, 4);
      range.collapse(true);
      selection!.removeAllRanges();
      selection!.addRange(range);
      fireEvent.keyDown(inner, { key: "Enter" });
    });
    expect(doc.getText(cellId)).toBe("cell\n");
    // No paragraph child was materialized (the cell sequence stands).
    expect(doc.getChildren(rowId)).toHaveLength(2);
    expect(doc.getChildren(cellId)).toHaveLength(0);
  });

  it("Backspace at the line start is a no-op (no merge out of the cell)", () => {
    const { doc, cellId, rowId } = renderCellDoc();
    const inner = cellInner(cellId);
    act(() => {
      inner.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      const textNode = Array.from(inner.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
      range.setStart(textNode!, 0);
      range.collapse(true);
      selection!.removeAllRanges();
      selection!.addRange(range);
      fireEvent.keyDown(inner, { key: "Backspace" });
    });
    // The text stands (the first character is not deleted by the gesture)
    // and no block moved or merged.
    expect(doc.getText(cellId)).toBe("cell");
    expect(doc.getChildren(rowId)).toHaveLength(2);
  });

  it("the paste is plain text only (the markdown pipeline does not run)", () => {
    const { doc, cellId } = renderCellDoc();
    const inner = cellInner(cellId);
    act(() => {
      inner.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      const textNode = Array.from(inner.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
      range.setStart(textNode!, 4);
      range.collapse(true);
      selection!.removeAllRanges();
      selection!.addRange(range);
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { getData: (format: string) => (format === "text/html" ? "<p>**bold**</p>" : "**bold**") },
      });
      inner.dispatchEvent(event);
    });
    // The literal payload lands (no bold mark, no paragraph split).
    expect(doc.getText(cellId)).toBe("cell**bold**");
    expect(doc.getChildren(cellId)).toHaveLength(0);
  });

  it("ArrowDown at the text end descends into the first text child (the up edge keeps the sibling walk)", async () => {
    const { doc, cellId } = renderCellDoc(true);
    const childId = doc.getChildren(cellId)[0];
    expect(childId).not.toBeNull();
    const inner = cellInner(cellId);
    act(() => {
      inner.textContent = "cell";
      inner.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      const textNode = Array.from(inner.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
      range.setStart(textNode!, 4);
      range.collapse(true);
      selection!.removeAllRanges();
      selection!.addRange(range);
      fireEvent.keyDown(inner, { key: "ArrowDown" });
    });
    // The seat defers to the next frame (the store-driven render lands
    // first); the child inner stands focused.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const childInner = document.querySelector<HTMLElement>(
      `[data-block-id="${childId}"] [data-slot="docblocks/block-content"]`
    );
    expect(document.activeElement).toBe(childInner);
  });

  it("the format toolbar stands over an own-layer range (bold lands on the own runs; no list-type menu)", () => {
    const { doc, cellId } = renderCellDoc();
    const inner = cellInner(cellId);
    act(() => {
      inner.textContent = "cell";
      inner.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      const textNode = Array.from(inner.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
      range.setStart(textNode!, 0);
      range.setEnd(textNode!, 4);
      selection!.removeAllRanges();
      selection!.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    const toolbar = document.querySelector<HTMLElement>("[data-slot='docblocks/format-toolbar']");
    expect(toolbar).not.toBeNull();
    // The cell is not a page block: the list-type menu stays out.
    expect(document.querySelector("[data-slot='docblocks/format-list-menu']")).toBeNull();
    const bold = toolbar!.querySelector<HTMLElement>("[data-mark='bold']");
    expect(bold).not.toBeNull();
    act(() => {
      fireEvent.click(bold!);
    });
    expect(doc.getRuns(cellId)).toEqual([{ text: "cell", marks: { bold: true } }]);
  });

  it("a wholly emptied cell drops the layer and stands the activation layer", () => {
    const { doc, cellId } = renderCellDoc();
    const inner = cellInner(cellId);
    act(() => {
      inner.textContent = "";
      fireEvent.input(inner);
    });
    expect(doc.getText(cellId)).toBe("");
    expect(document.querySelector(`td[data-block-id="${cellId}"] [data-slot="docblocks/block-content"]`)).toBeNull();
    expect(
      document.querySelector(`td[data-block-id="${cellId}"] [data-slot="docblocks/cell-activation"]`)
    ).not.toBeNull();
  });

  it("the last-character delete parks the focus on the activation layer (the undo reach)", async () => {
    const { doc, cellId } = renderCellDoc();
    const inner = cellInner(cellId);
    act(() => {
      inner.textContent = "cell";
      inner.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      const textNode = Array.from(inner.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
      range.setStart(textNode!, 2);
      range.collapse(true);
      selection!.removeAllRanges();
      selection!.addRange(range);
      inner.textContent = "";
      fireEvent.input(inner);
    });
    expect(doc.getText(cellId)).toBe("");
    // The layer unmounted with the selection; the activation layer stands
    // focused (the deferred seat lands on the next frame).
    await new Promise((resolve) => setTimeout(resolve, 20));
    const activation = document.querySelector<HTMLElement>(
      `td[data-block-id="${cellId}"] [data-slot="docblocks/cell-activation"]`
    );
    expect(activation).not.toBeNull();
    expect(document.activeElement).toBe(activation);
  });
});
