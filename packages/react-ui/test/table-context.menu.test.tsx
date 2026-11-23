// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  cellAt,
  cellIdAt,
  cellMenuItem,
  flushFrames,
  renderTableDoc,
  rightClick,
  stubClipboard,
} from "./table-context.helpers";

describe("the cell's right-click menu", () => {
  it("stands over the cell with the copy / paste / clear items (the native menu is suppressed)", async () => {
    const { doc, tableId } = renderTableDoc();
    const cellId = cellIdAt(doc, tableId, 0, 0);
    const p1 = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(p1, 0, "alpha");

    const cell = cellAt(0, 0);
    const result = rightClick(cell);
    // The open stands the gesture's release (the jsdom flush stands for the
    // re-render frame).
    await flushFrames();

    expect(result).toBe(false);
    for (const label of ["Copy", "Paste", "Clear"]) {
      await cellMenuItem(label);
    }
  });

  it("the held press's open stands the release (no open under the press — the release stands no first-item select)", () => {
    // The real right-click holds the button between the press and the
    // release: an open over the held press would put the first item under
    // the release point, and the Radix item stands the buttonless up as a
    // select (the release "clicks" the first item, the menu closes — the
    // "the menu flashes and stands gone" stand).
    const { doc, tableId } = renderTableDoc();
    const cellId = cellIdAt(doc, tableId, 0, 0);
    const p1 = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(p1, 0, "alpha");

    const cell = cellAt(0, 0);
    const menu = () => document.querySelector('[data-slot="docblocks/table-cell-menu"]');

    // The press stands the button held: the menu stands no open yet.
    fireEvent.pointerDown(cell, { clientX: 40, clientY: 30, button: 2, buttons: 2, pointerId: 1 });
    fireEvent.contextMenu(cell, { clientX: 40, clientY: 30, button: 2, buttons: 2 });
    expect(menu()).toBeNull();
    // A foreign gesture's release stands no open.
    fireEvent.pointerUp(document.body, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    expect(menu()).toBeNull();
    // The gesture's own release opens the menu.
    fireEvent.pointerUp(cell, { clientX: 40, clientY: 30, button: 2, pointerId: 1 });
    expect(menu()).not.toBeNull();
    expect(menu()!.getAttribute("data-state")).toBe("open");
  });

  it("Copy writes the cell's plain text (the blocks joined with \\n)", async () => {
    const { writeSpy } = stubClipboard();
    const { doc, tableId } = renderTableDoc();
    const cellId = cellIdAt(doc, tableId, 0, 0);
    const p1 = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(p1, 0, "aa");
    const p2 = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(p2, 0, "bb");

    rightClick(cellAt(0, 0));
    await flushFrames();
    fireEvent.click(await cellMenuItem("Copy"));
    await flushFrames();

    expect(writeSpy).toHaveBeenCalledWith("aa\nbb");
  });

  it("Paste lands the clipboard's plain text (an empty cell materializes its paragraph)", async () => {
    stubClipboard(undefined, "pasted\ntext");
    const { doc, tableId } = renderTableDoc();
    const cellId = cellIdAt(doc, tableId, 1, 1);

    rightClick(cellAt(1, 1));
    await flushFrames();
    fireEvent.click(await cellMenuItem("Paste"));
    await flushFrames();

    const children = doc.getChildren(cellId);
    expect(children.length).toBe(1);
    expect(doc.getRuns(children[0]!)).toEqual([{ text: "pasted\ntext", marks: {} }]);
  });

  it("Paste appends to the last paragraph when the cell has content", async () => {
    stubClipboard(undefined, "bb");
    const { doc, tableId } = renderTableDoc();
    const cellId = cellIdAt(doc, tableId, 0, 1);
    const p1 = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(p1, 0, "aa");

    rightClick(cellAt(0, 1));
    await flushFrames();
    fireEvent.click(await cellMenuItem("Paste"));
    await flushFrames();

    expect(doc.getRuns(p1)).toEqual([{ text: "aabb", marks: {} }]);
    expect(doc.getChildren(cellId).length).toBe(1);
  });

  it("Clear empties the cell (the children cascade out — one undo step)", async () => {
    const { doc, tableId } = renderTableDoc();
    const cellId = cellIdAt(doc, tableId, 0, 0);
    const p1 = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(p1, 0, "aa");
    const p2 = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(p2, 0, "bb");

    rightClick(cellAt(0, 0));
    await flushFrames();
    fireEvent.click(await cellMenuItem("Clear"));
    expect(doc.getChildren(cellId)).toEqual([]);

    doc.undo();
    const children = doc.getChildren(cellId);
    expect(children.length).toBe(2);
    expect(doc.getRuns(children[0]!)).toEqual([{ text: "aa", marks: {} }]);
  });

  it("Clear empties the cell's own content too (one undo step)", async () => {
    const { doc, tableId } = renderTableDoc();
    const cellId = cellIdAt(doc, tableId, 0, 0);
    doc.insertText(cellId, 0, "own");
    const p1 = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(p1, 0, "aa");

    rightClick(cellAt(0, 0));
    await flushFrames();
    fireEvent.click(await cellMenuItem("Clear"));
    expect(doc.getText(cellId)).toBe("");
    expect(doc.getChildren(cellId)).toEqual([]);

    doc.undo();
    expect(doc.getText(cellId)).toBe("own");
    expect(doc.getChildren(cellId).length).toBe(1);
  });
});
