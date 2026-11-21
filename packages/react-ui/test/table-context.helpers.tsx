// The table cell's context tests' shared stand: the 2x2 table's doc's
// render, the cell's / the seam's DOM reads, the right-click's gesture,
// the deferred open's poll, the clipboard's stub, and the per-test cleanup.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, vi } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

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

/** The right-click on the cell (the native menu is suppressed in a cell):
 * the real gesture's sequence (the press with the button held, the
 * contextmenu, the release) — the open stands the release, so the
 * synthetic's sequence must stand it. False when suppressed. */
function rightClick(cell: HTMLElement, x = 40, y = 30): boolean {
  fireEvent.pointerDown(cell, { clientX: x, clientY: y, button: 2, buttons: 2, pointerId: 1 });
  const result = fireEvent.contextMenu(cell, { clientX: x, clientY: y, button: 2, buttons: 2 });
  fireEvent.pointerUp(cell, { clientX: x, clientY: y, button: 2, pointerId: 1 });
  return result;
}

/** The flush: the frame the store-driven re-render and the async menu actions land on. */
const flushFrames = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * The deferred open (`setTimeout(0)` past the pointerup) lands late under the
 * parallel suite load: poll the item until it stands (1 s deadline).
 */
async function cellMenuItem(label: string): Promise<HTMLElement> {
  const deadline = Date.now() + 1000;
  for (;;) {
    const el = screen.queryByText(label, { selector: '[data-slot="dropdown-menu-item"]' });
    if (el !== null) return el;
    if (Date.now() >= deadline) throw new Error(`the ${label} menu item should stand (the deferred open)`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

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

export { CREATED_AT, cellAt, cellIdAt, cellMenuItem, flushFrames, renderTableDoc, rightClick, seam, stubClipboard };
