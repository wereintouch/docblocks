// @vitest-environment jsdom
// The table cell's right-click menu (Copy / Paste / Clear), the column
// seam resize (the 50 px floor, the live preview without wire traffic,
// the one-command release commit, the 0 px no-op), and the format
// toolbar over a cell selection (the cell paragraphs are plain text
// blocks — the existing toolbar path).
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { cellPlainText, pasteCellText, readClipboardText } from "../src/blocks/table";
import { CREATED_AT, stubClipboard } from "./table-context.helpers";

describe("the cell's plain text (the copy payload)", () => {
  it("joins the text children with \\n (the soft breaks stand as the run's \\n)", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const tableId = doc.insertBlock("table", { cols: 1 });
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
    const p1 = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(p1, 0, "line one\nline two");
    const p2 = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(p2, 0, "block two");
    expect(cellPlainText(doc, cellId)).toBe("line one\nline two\nblock two");
  });

  it("the non-text children contribute nothing", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const tableId = doc.insertBlock("table", { cols: 1 });
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
    const p1 = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(p1, 0, "text only");
    doc.insertBlock("divider", undefined, { parent: cellId });
    expect(cellPlainText(doc, cellId)).toBe("text only");
  });

  it("an empty cell stands an empty string", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const tableId = doc.insertBlock("table", { cols: 1 });
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
    expect(cellPlainText(doc, cellId)).toBe("");
  });
});

describe("the cell's paste (the plain text into the seat)", () => {
  it("lands at the end of the last text child (one transact, one undo step)", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const tableId = doc.insertBlock("table", { cols: 1 });
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
    const p1 = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(p1, 0, "aa");
    const p2 = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(p2, 0, "bb");

    const seat = pasteCellText(doc, cellId, "cc\ndd");

    expect(seat).toEqual({ blockId: p2, offset: 7 });
    expect(doc.getRuns(p2)).toEqual([{ text: "bbcc\ndd", marks: {} }]);
    doc.undo();
    expect(doc.getRuns(p2)).toEqual([{ text: "bb", marks: {} }]);
  });

  it("an empty cell materializes its paragraph", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const tableId = doc.insertBlock("table", { cols: 1 });
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });

    const seat = pasteCellText(doc, cellId, "pasted\nline");

    const children = doc.getChildren(cellId);
    expect(children.length).toBe(1);
    expect(doc.getRuns(children[0]!)).toEqual([{ text: "pasted\nline", marks: {} }]);
    expect(seat).toEqual({ blockId: children[0]!, offset: 11 });
  });

  it("a cell without a text child gets a fresh paragraph", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const tableId = doc.insertBlock("table", { cols: 1 });
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
    doc.insertBlock("divider", undefined, { parent: cellId });

    pasteCellText(doc, cellId, "text");

    const children = doc.getChildren(cellId);
    expect(children.length).toBe(2);
    expect(doc.getRuns(children[1]!)).toEqual([{ text: "text", marks: {} }]);
  });

  it("the empty text is a no-op", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const tableId = doc.insertBlock("table", { cols: 1 });
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
    expect(pasteCellText(doc, cellId, "")).toBeNull();
    expect(doc.getChildren(cellId)).toEqual([]);
  });

  it("an HTML-only payload degrades to its plain text (the cell's data is plain)", async () => {
    stubClipboard(undefined, undefined, "<p>hi <b>there</b></p>");
    expect(await readClipboardText()).toBe("hi there");
  });
});
