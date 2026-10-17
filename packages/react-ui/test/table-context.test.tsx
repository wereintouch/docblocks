// @vitest-environment jsdom
// The table cell's right-click menu (Copy / Paste / Clear), the column
// seam resize (the 50 px floor, the live preview without wire traffic,
// the one-command release commit, the 0 px no-op), and the format
// toolbar over a cell selection (the cell paragraphs are plain text
// blocks — the existing toolbar path).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";
import { cellPlainText, clampColumnWidth, pasteCellText, readClipboardText } from "../src/blocks/TableBlock";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

/** A 2×2 table (the given column widths) as a page block; the doc is returned for the pins. */
function renderTableDoc(columnWidths?: number[]) {
  const doc = createDoc({ id: "doc-tbl", createdAt: CREATED_AT });
  const pageId = doc.insertBlock("paragraph");
  doc.insertText(pageId, 0, "before");
  const tableId = doc.insertBlock("table", {
    cols: 2,
    ...(columnWidths !== undefined ? { columnWidths } : {}),
  });
  for (let r = 0; r < 2; r++) {
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    for (let c = 0; c < 2; c++) doc.insertBlock("table-cell", undefined, { parent: rowId });
  }
  render(
    <EditorProvider doc={doc}>
      <Editor />
    </EditorProvider>
  );
  return { doc, tableId };
}

/** The cell element at the (row, column) position. */
function cellAt(row: number, col: number): HTMLTableCellElement {
  const rows = document.querySelectorAll<HTMLTableRowElement>("tbody > tr");
  const el = rows[row]!.querySelectorAll<HTMLTableCellElement>("td")[col]!;
  expect(el, "the cell should render").not.toBeNull();
  return el;
}

/** The cell id at the (row, column) position. */
function cellIdAt(doc: TestDoc, tableId: BlockId, row: number, col: number): BlockId {
  const rowId = doc.getChildren(tableId)[row]!;
  return doc.getChildren(rowId)[col]!;
}

/** The seam element (data-index = the column LEFT of the seam). */
function seam(index: number): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-slot="docblocks/table-col-resize"][data-index="${index}"]`);
  expect(el, `the seam ${index} should render`).not.toBeNull();
  return el!;
}

/** The right-click on the cell (the native menu is suppressed in a cell); false when suppressed. */
function rightClick(cell: HTMLElement, x = 40, y = 30): boolean {
  return fireEvent.contextMenu(cell, { clientX: x, clientY: y, button: 2 });
}

/** The open cell menu's content (portaled into the body). */
function cellMenu(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-slot="docblocks/table-cell-menu"]');
  expect(el, "the cell menu should be open").not.toBeNull();
  return el!;
}

/** The flush: the frame the store-driven re-render and the async menu actions land on. */
const flushFrames = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

/** Install a stub clipboard (writeText / read) and return the spies.
 * `plain` undefined = an HTML-only payload (the degradation branch). */
function stubClipboard(writeText?: (text: string) => Promise<void>, plain?: string, html = "<b>html</b>") {
  const writeSpy = vi.fn(writeText ?? (() => Promise.resolve()));
  const types = plain === undefined ? ["text/html"] : ["text/plain", "text/html"];
  const readSpy = vi.fn().mockImplementation(async () => [
    {
      types,
      getType: async (type: string) => new Blob([type === "text/plain" ? (plain ?? "") : html]),
    },
  ]);
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText: writeSpy, read: readSpy },
    configurable: true,
  });
  return { writeSpy, readSpy };
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

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

describe("the cell's right-click menu", () => {
  it("stands over the cell with the copy / paste / clear items (the native menu is suppressed)", async () => {
    const { doc, tableId } = renderTableDoc();
    const cellId = cellIdAt(doc, tableId, 0, 0);
    const p1 = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(p1, 0, "alpha");

    const cell = cellAt(0, 0);
    const result = rightClick(cell);
    // The open defers a task past the gesture's pointerup (the jsdom flush
    // stands for the release).
    await flushFrames();

    expect(result).toBe(false);
    expect(cellMenu()).not.toBeNull();
    for (const label of ["Copy", "Paste", "Clear"]) {
      expect(screen.getByText(label, { selector: '[data-slot="dropdown-menu-item"]' })).not.toBeNull();
    }
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
    fireEvent.click(screen.getByText("Copy", { selector: '[data-slot="dropdown-menu-item"]' }));
    await flushFrames();

    expect(writeSpy).toHaveBeenCalledWith("aa\nbb");
  });

  it("Paste lands the clipboard's plain text (an empty cell materializes its paragraph)", async () => {
    stubClipboard(undefined, "pasted\ntext");
    const { doc, tableId } = renderTableDoc();
    const cellId = cellIdAt(doc, tableId, 1, 1);

    rightClick(cellAt(1, 1));
    await flushFrames();
    fireEvent.click(screen.getByText("Paste", { selector: '[data-slot="dropdown-menu-item"]' }));
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
    fireEvent.click(screen.getByText("Paste", { selector: '[data-slot="dropdown-menu-item"]' }));
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
    fireEvent.click(screen.getByText("Clear", { selector: '[data-slot="dropdown-menu-item"]' }));
    expect(doc.getChildren(cellId)).toEqual([]);

    doc.undo();
    const children = doc.getChildren(cellId);
    expect(children.length).toBe(2);
    expect(doc.getRuns(children[0]!)).toEqual([{ text: "aa", marks: {} }]);
  });
});

describe("the column seam resize", () => {
  it("stand between the columns (one per interior boundary) and hidden at rest", () => {
    renderTableDoc([120, 140]);
    // Two columns → the single interior seam (data-index 0, the column LEFT of it).
    expect(seam(0)).not.toBeNull();
    expect(document.querySelector('[data-slot="docblocks/table-col-resize"][data-index="1"]')).toBeNull();
    expect(seam(0).className).toContain("opacity-0");
    expect(seam(0).className).toContain("cursor-col-resize");
  });

  it("a drag commits the new width on the release (one command, one undo step)", () => {
    const { doc, tableId } = renderTableDoc([100, 150]);
    // The seam at data-index 0 resizes column 0 (the column LEFT of the seam).
    fireEvent.pointerDown(seam(0), { button: 0, clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(seam(0), { clientX: 140, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(seam(0), { clientX: 140, clientY: 50, pointerId: 1 });

    const after = doc.getBlock(tableId);
    expect(after !== null && after.type === "table" && after.attrs.columnWidths).toEqual([140, 150]);
    doc.undo();
    const afterUndo = doc.getBlock(tableId);
    expect(afterUndo !== null && afterUndo.type === "table" && afterUndo.attrs.columnWidths).toEqual([100, 150]);
  });

  it("the live preview stands the width locally (no wire traffic until the release)", () => {
    renderTableDoc([100, 150]);
    const cols = () => document.querySelectorAll<HTMLTableColElement>("colgroup > col");
    expect(cols()[0]!.style.width).toBe("100px");

    fireEvent.pointerDown(seam(0), { button: 0, clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(seam(0), { clientX: 180, clientY: 50, pointerId: 1 });
    expect(cols()[0]!.style.width).toBe("180px");
    expect(document.querySelector<HTMLTableElement>('[data-slot="docblocks/table"]')!.style.width).toBe("330px");

    fireEvent.pointerUp(seam(0), { clientX: 180, clientY: 50, pointerId: 1 });
  });

  it("the 50 px floor clamps the drag (and the preview)", () => {
    const { doc, tableId } = renderTableDoc([100, 150]);
    fireEvent.pointerDown(seam(0), { button: 0, clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(seam(0), { clientX: -50, clientY: 50, pointerId: 1 });
    expect(document.querySelectorAll<HTMLTableColElement>("colgroup > col")[0]!.style.width).toBe("50px");
    fireEvent.pointerUp(seam(0), { clientX: -50, clientY: 50, pointerId: 1 });

    const afterClamp = doc.getBlock(tableId);
    expect(afterClamp !== null && afterClamp.type === "table" && afterClamp.attrs.columnWidths).toEqual([50, 150]);
    expect(clampColumnWidth(10)).toBe(50);
    expect(clampColumnWidth(50.4)).toBe(50);
    expect(clampColumnWidth(120.6)).toBe(121);
  });

  it("a 0 px drag is a no-op (no command, the widths stand)", () => {
    const { doc, tableId } = renderTableDoc([100, 150]);
    fireEvent.pointerDown(seam(0), { button: 0, clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(seam(0), { clientX: 100, clientY: 50, pointerId: 1 });

    const afterNoop = doc.getBlock(tableId);
    expect(afterNoop !== null && afterNoop.type === "table" && afterNoop.attrs.columnWidths).toEqual([100, 150]);
  });
});

describe("the format toolbar over a cell selection", () => {
  it("stands over the range and formats the cell's paragraph (the existing path)", async () => {
    const { doc, tableId } = renderTableDoc();
    const cellId = cellIdAt(doc, tableId, 0, 0);
    const p1 = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(p1, 0, "alpha");
    await flushFrames();

    const inner = document.querySelector<HTMLElement>(`[data-block-id="${p1}"] [data-slot="docblocks/block-content"]`)!;
    const node = inner.firstChild;
    expect(node, "the cell paragraph should carry a text node").not.toBeNull();
    const range = document.createRange();
    range.setStart(node!, 0);
    range.setEnd(node!, 5);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await flushFrames();

    const toolbar = document.querySelector<HTMLElement>('[data-slot="docblocks/format-toolbar"]');
    expect(toolbar, "the toolbar should stand over the cell range").not.toBeNull();
    fireEvent.click(toolbar!.querySelector<HTMLElement>('[data-mark="bold"]')!);
    await flushFrames();

    expect(doc.getRuns(p1)).toEqual([{ text: "alpha", marks: { bold: true } }]);
  });
});
