// @vitest-environment jsdom
// The table layout (the widths and the add buttons): the table's width is
// the sum of the column widths (the default per absent entry) under the
// fixed layout, the scroll wrapper stands around the table, and the
// add-row / add-column chips drive the core's row/column insert commands
// (one command each, one undo step).
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/** A table with the given column count and (optional) widths as a page block. */
function renderTableDoc(cols: number, columnWidths?: number[]) {
  const doc = createDoc({ id: "doc-tbl", createdAt: CREATED_AT });
  const pageId = doc.insertBlock("paragraph");
  doc.insertText(pageId, 0, "before");
  const tableId = doc.insertBlock("table", { cols, ...(columnWidths !== undefined ? { columnWidths } : {}) });
  for (let r = 0; r < 2; r++) {
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    for (let c = 0; c < cols; c++) {
      doc.insertBlock("table-cell", undefined, { parent: rowId });
    }
  }
  render(
    <EditorProvider doc={doc}>
      <Editor />
    </EditorProvider>
  );
  return { doc, tableId };
}

/** The table element. */
function tableOf(): HTMLTableElement {
  const el = document.querySelector<HTMLTableElement>('table[data-slot="docblocks/table"]');
  expect(el, "the table should render").not.toBeNull();
  return el!;
}

afterEach(() => {
  cleanup();
});

describe("the table width (the sum of the column widths)", () => {
  it("is the sum of the columnWidths attr under the fixed layout", () => {
    renderTableDoc(2, [120, 80]);
    const table = tableOf();
    expect(table.style.width).toBe("200px");
    expect(table.className).toContain("table-fixed");
    const colStyles = Array.from(table.querySelectorAll("col")).map((col) => col.style.width);
    expect(colStyles).toEqual(["120px", "80px"]);
  });

  it("falls back to the default width per column when the attr is absent", () => {
    renderTableDoc(3);
    const table = tableOf();
    expect(table.style.width).toBe("300px");
    const colStyles = Array.from(table.querySelectorAll("col")).map((col) => col.style.width);
    expect(colStyles).toEqual(["100px", "100px", "100px"]);
  });

  it("falls back per absent entry (a partial array)", () => {
    renderTableDoc(3, [150]);
    const table = tableOf();
    expect(table.style.width).toBe("350px");
    const colStyles = Array.from(table.querySelectorAll("col")).map((col) => col.style.width);
    expect(colStyles).toEqual(["150px", "100px", "100px"]);
  });

  it("stands the scroll wrapper with the thin horizontal scroll", () => {
    renderTableDoc(2);
    const frame = document.querySelector<HTMLElement>('[data-slot="docblocks/table-scroll"]');
    expect(frame, "the table frame should render").not.toBeNull();
    expect(frame!.className).toContain("group");
    const scroll = frame!.firstElementChild as HTMLElement;
    expect(scroll.className).toContain("overflow-x-auto");
    expect(scroll.className).toContain("scrollbar-thin");
  });
});

describe("the add row / add column chips", () => {
  it("stand hidden until the frame is hovered or focused", () => {
    renderTableDoc(2);
    const addRow = document.querySelector<HTMLElement>('[data-slot="docblocks/table-add-row"]');
    const addColumn = document.querySelector<HTMLElement>('[data-slot="docblocks/table-add-column"]');
    expect(addRow, "the add-row chip should render").not.toBeNull();
    expect(addColumn, "the add-column chip should render").not.toBeNull();
    for (const chip of [addRow!, addColumn!]) {
      expect(chip.className).toContain("opacity-0");
      expect(chip.className).toContain("pointer-events-none");
      expect(chip.className).toContain("group-hover:opacity-100");
    }
  });

  it("the add-row chip appends a row (one command, one undo step)", () => {
    const { doc, tableId } = renderTableDoc(2);
    expect(doc.getChildren(tableId).length).toBe(2);
    fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/table-add-row"]')!);
    const rows = doc.getChildren(tableId);
    expect(rows.length).toBe(3);
    for (const rowId of rows) {
      expect(doc.getChildren(rowId).length).toBe(2);
    }
    doc.undo();
    expect(doc.getChildren(tableId).length).toBe(2);
  });

  it("the add-column chip appends a 100 px column (one command, one undo step)", () => {
    const { doc, tableId } = renderTableDoc(2);
    const block = doc.getBlock(tableId);
    expect(block !== null && block.type === "table").toBe(true);
    if (block === null || block.type !== "table") return;
    fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/table-add-column"]')!);
    const after = doc.getBlock(tableId);
    expect(after !== null && after.type === "table").toBe(true);
    if (after === null || after.type !== "table") return;
    expect(after.attrs.cols).toBe(3);
    expect(after.attrs.columnWidths).toEqual([100, 100, 100]);
    for (const rowId of doc.getChildren(tableId)) {
      expect(doc.getChildren(rowId).length).toBe(3);
    }
    doc.undo();
    const restored = doc.getBlock(tableId);
    expect(restored !== null && restored.type === "table").toBe(true);
    if (restored !== null && restored.type === "table") expect(restored.attrs.cols).toBe(2);
  });

  it("the add-column chip appends at the end of the existing widths", () => {
    const { doc, tableId } = renderTableDoc(2, [120, 80]);
    fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/table-add-column"]')!);
    const after = doc.getBlock(tableId);
    expect(after !== null && after.type === "table" && after.attrs.columnWidths).toEqual([120, 80, 100]);
  });
});
