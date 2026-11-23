// The table handle's tests' shared stand: the table's render fixture (the
// page block's table over the fixed palette), the cell / the handle / the
// menu's DOM reads, and the press (the pointer's down / the optional
// drag / the up).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

// A hex palette for the swatch applies (jsdom cannot resolve the default
// palette's theme tokens — the hex entries pass through deterministically).
const TEST_PALETTE = ["#3b82f6", "#e11d48", "#10b981"];

/** A table with the given cols and row count as a page block. */
function renderTableDoc(cols: number, rowCount = 2, columnWidths?: number[]) {
  const doc = createDoc({ id: "doc-tbl", createdAt: CREATED_AT });
  const pageId = doc.insertBlock("paragraph");
  doc.insertText(pageId, 0, "before");
  const tableId = doc.insertBlock("table", { cols, ...(columnWidths !== undefined ? { columnWidths } : {}) });
  for (let r = 0; r < rowCount; r++) {
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    for (let c = 0; c < cols; c++) {
      doc.insertBlock("table-cell", undefined, { parent: rowId });
    }
  }
  render(
    <EditorProvider doc={doc}>
      <Editor formatPalette={TEST_PALETTE} />
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

/** The column / row handle chip at the index. */
function colHandle(index: number): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-slot="docblocks/table-col-handle"][data-index="${index}"]`)!;
}

function rowHandle(index: number): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-slot="docblocks/table-row-handle"][data-index="${index}"]`)!;
}

/** A handle press: the pointer down, the optional drag, the release. */
function press(handle: HTMLElement, dragTo?: { x: number; y: number }) {
  fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
  if (dragTo !== undefined) {
    fireEvent.pointerMove(handle, { clientX: dragTo.x, clientY: dragTo.y, pointerId: 1 });
  }
  fireEvent.pointerUp(
    handle,
    dragTo !== undefined
      ? { clientX: dragTo.x, clientY: dragTo.y, pointerId: 1 }
      : { clientX: 0, clientY: 0, pointerId: 1 }
  );
}

/** The open handle menu's content (portaled into the body). */
function menuContent(slot: "docblocks/table-col-menu" | "docblocks/table-row-menu"): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  expect(el, `the ${slot} should be open`).not.toBeNull();
  return el!;
}

/** The disabled state of the item (the radix data-disabled attr). */
function isDisabled(item: HTMLElement): boolean {
  return item.hasAttribute("data-disabled");
}

/** The item with the given label inside the open menu. */
function menuItem(label: string): HTMLElement {
  const el = screen.getByText(label, { selector: '[data-slot="dropdown-menu-item"]' });
  expect(el, `the "${label}" item should stand`).not.toBeNull();
  return el as HTMLElement;
}
afterEach(() => {
  cleanup();
});

export { cellAt, colHandle, isDisabled, menuContent, menuItem, press, renderTableDoc, rowHandle };
