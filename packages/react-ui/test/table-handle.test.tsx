// @vitest-environment jsdom
// The table row/column handles: the hover reveal (the handle stands over the
// hovered cell's row and column), the press without a drag opens the handle
// menu (the palette, the conditional remove, the insert/move/duplicate/
// clear/delete items with the edge moves disabled), and the press-drag
// commits the move (one command; the stale-drop guard drops a commit when a
// concurrent structural change invalidates the press-time snapshot).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { columnDropPosition, rowDropPosition } from "../src/blocks/table";
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

describe("the handle drop positions (pure math)", () => {
  it("the column position is the first stationary midpoint right of the pointer", () => {
    const stationary = [100, 100, 100];
    expect(columnDropPosition(stationary, 10)).toBe(0);
    expect(columnDropPosition(stationary, 50)).toBe(0);
    expect(columnDropPosition(stationary, 150)).toBe(1);
    expect(columnDropPosition(stationary, 249)).toBe(2);
    expect(columnDropPosition(stationary, 300)).toBe(3);
  });

  it("the row position is the count of the stationary midpoints above the pointer", () => {
    expect(rowDropPosition([50, 150, 250], 10)).toBe(0);
    expect(rowDropPosition([50, 150, 250], 150)).toBe(1);
    expect(rowDropPosition([50, 150, 250], 151)).toBe(2);
    expect(rowDropPosition([50, 150, 250], 500)).toBe(3);
    expect(rowDropPosition([], 0)).toBe(0);
  });
});

describe("the handle reveal (the hover zone is the whole row and column)", () => {
  it("stand hidden while nothing is hovered", () => {
    renderTableDoc(2);
    for (const chip of [colHandle(0), colHandle(1), rowHandle(0), rowHandle(1)]) {
      expect(chip).not.toBeNull();
      expect(chip.className).toContain("opacity-0");
      expect(chip.className).toContain("pointer-events-none");
    }
  });

  it("hovering a cell reveals its column and row handle only", () => {
    renderTableDoc(2);
    fireEvent.pointerMove(cellAt(0, 1), {});
    expect(colHandle(1).className).toContain("opacity-100");
    expect(rowHandle(0).className).toContain("opacity-100");
    expect(colHandle(0).className).toContain("opacity-0");
    expect(rowHandle(1).className).toContain("opacity-0");
  });

  it("moving the hover across the table moves the handles", () => {
    renderTableDoc(2);
    fireEvent.pointerMove(cellAt(1, 0), {});
    expect(colHandle(0).className).toContain("opacity-100");
    expect(rowHandle(1).className).toContain("opacity-100");
    fireEvent.pointerMove(cellAt(0, 1), {});
    expect(colHandle(0).className).toContain("opacity-0");
    expect(colHandle(1).className).toContain("opacity-100");
    expect(rowHandle(0).className).toContain("opacity-100");
    expect(rowHandle(1).className).toContain("opacity-0");
  });
});

describe("the handle menu (the press without a drag)", () => {
  it("opens the column menu with the full item list in order", () => {
    renderTableDoc(2);
    press(colHandle(0));
    const content = menuContent("docblocks/table-col-menu");
    // The first entry is the Background subtrigger (the swatch sub); the
    // remove stands conditional (no color is set).
    const labels = Array.from(
      content.querySelectorAll<HTMLElement>("[data-slot='dropdown-menu-sub-trigger'], [data-slot='dropdown-menu-item']")
    ).map((el) => el.textContent?.trim() ?? "");
    expect(labels).toEqual([
      "Background",
      "Insert right",
      "Insert left",
      "Move right",
      "Move left",
      "Duplicate",
      "Clear content",
      "Delete",
    ]);
  });

  it("disables the edge moves (the first column: Move left; the last: Move right)", () => {
    renderTableDoc(2);
    press(colHandle(0));
    expect(isDisabled(menuItem("Move left"))).toBe(true);
    expect(isDisabled(menuItem("Move right"))).toBe(false);
    press(colHandle(1));
    expect(isDisabled(menuItem("Move right"))).toBe(true);
    expect(isDisabled(menuItem("Move left"))).toBe(false);
  });

  it("the insert item inserts at the handle's side (one command, one undo step)", () => {
    const { doc, tableId } = renderTableDoc(2, 2, [120, 80]);
    press(colHandle(0));
    fireEvent.click(menuItem("Insert right"));
    const after = doc.getBlock(tableId);
    expect(after !== null && after.type === "table").toBe(true);
    if (after !== null && after.type === "table") {
      expect(after.columnOrder.length).toBe(3);
      expect(after.attrs?.columnWidths).toEqual([120, 100, 80]);
    }
    doc.undo();
    const restored = doc.getBlock(tableId);
    expect(restored !== null && restored.type === "table" && restored.columnOrder.length === 2).toBe(true);
  });

  it("the swatch sets the column color (one undo step) and the remove item appears", () => {
    const { doc, tableId } = renderTableDoc(2);
    press(colHandle(0));
    // The swatches stand in the Background sub — the sub opens on the
    // trigger's click.
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='dropdown-menu-sub-trigger']")!);
    const swatch = document.querySelector<HTMLElement>("[data-slot='docblocks/table-swatch']");
    expect(swatch, "a palette swatch should stand").not.toBeNull();
    const swatchColor = swatch!.dataset.color!;
    fireEvent.click(swatch!);
    // The column's cells carry the color (both rows).
    const rows = doc.getChildren(tableId);
    for (const rowId of rows) {
      const cellId = doc.getChildren(rowId)[0]!;
      const cell = doc.getBlock(cellId);
      expect(cell !== null && cell.type === "table-cell" && cell.attrs?.columnColor === swatchColor).toBe(true);
    }
    // The remove item stands now (the menu is still open over the swatch pick).
    const remove = document.querySelector<HTMLElement>("[data-slot='docblocks/table-remove-color']");
    expect(remove, "the remove item should stand").not.toBeNull();
    fireEvent.click(remove!);
    const rowId = doc.getChildren(tableId)[0]!;
    const cell = doc.getBlock(doc.getChildren(rowId)[0]!);
    expect(cell !== null && cell.type === "table-cell" && cell.attrs?.columnColor === undefined).toBe(true);
  });

  it("the row swatch sets the row color (in the row's cells) and the remove item appears", () => {
    const { doc, tableId } = renderTableDoc(2);
    const rows = doc.getChildren(tableId);
    press(rowHandle(0));
    // The swatches stand in the Background sub — the sub opens on the
    // trigger's click.
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='dropdown-menu-sub-trigger']")!);
    const swatch = document.querySelector<HTMLElement>("[data-slot='docblocks/table-swatch']");
    expect(swatch, "a palette swatch should stand").not.toBeNull();
    const swatchColor = swatch!.dataset.color!;
    fireEvent.click(swatch!);
    // The row's cells carry the row color (the second row's do not).
    const row0Cells = doc.getChildren(rows[0]!);
    for (const cellId of row0Cells) {
      const cell = doc.getBlock(cellId);
      expect(cell !== null && cell.type === "table-cell" && cell.attrs?.rowColor === swatchColor).toBe(true);
    }
    const row1Cells = doc.getChildren(rows[1]!);
    for (const cellId of row1Cells) {
      const cell = doc.getBlock(cellId);
      expect(cell !== null && cell.type === "table-cell" && cell.attrs?.rowColor === undefined).toBe(true);
    }
    // The remove item stands now (the row's color lives in the row's cells,
    // not the row block — the menu must re-read it from the store).
    const remove = document.querySelector<HTMLElement>("[data-slot='docblocks/table-remove-color']");
    expect(remove, "the remove item should stand").not.toBeNull();
    fireEvent.click(remove!);
    const cell = doc.getBlock(row0Cells[0]!);
    expect(cell !== null && cell.type === "table-cell" && cell.attrs?.rowColor === undefined).toBe(true);
  });

  it("the row duplicate adds a copy of the row (content and cells)", () => {
    const { doc, tableId } = renderTableDoc(2);
    const firstRow = doc.getChildren(tableId)[0]!;
    const firstCell = doc.getChildren(firstRow)[0]!;
    const para = doc.insertBlock("paragraph", undefined, { parent: firstCell });
    doc.insertText(para, 0, "anchor");
    press(rowHandle(0));
    fireEvent.click(menuItem("Duplicate"));
    const rows = doc.getChildren(tableId);
    expect(rows.length).toBe(3);
    // The copy stands right after the original and carries its content.
    expect(rows[1]).not.toBe(firstRow);
    const copyCell = doc.getChildren(rows[1]!)[0]!;
    const copyChildren = doc.getChildren(copyCell);
    expect(copyChildren.length).toBe(1);
    expect(doc.getText(copyChildren[0]!)).toBe("anchor");
    doc.undo();
    expect(doc.getChildren(tableId).length).toBe(2);
  });

  it("the clear item empties the row's cells", () => {
    const { doc, tableId } = renderTableDoc(2);
    const firstRow = doc.getChildren(tableId)[0]!;
    const para = doc.insertBlock("paragraph", undefined, { parent: doc.getChildren(firstRow)[0]! });
    doc.insertText(para, 0, "text");
    press(rowHandle(0));
    fireEvent.click(menuItem("Clear content"));
    for (const cellId of doc.getChildren(firstRow)) {
      expect(doc.getChildren(cellId).length).toBe(0);
    }
  });

  it("the delete on the last row converts the table into a paragraph in place", () => {
    const { doc, tableId } = renderTableDoc(2, 1);
    press(rowHandle(0));
    fireEvent.click(menuItem("Delete"));
    const converted = doc.getBlock(tableId);
    expect(converted !== null && converted.type === "paragraph").toBe(true);
  });

  it("the move items reorder the row (the content moves with it)", () => {
    const { doc, tableId } = renderTableDoc(2, 3);
    const rows = doc.getChildren(tableId);
    const firstRow = rows[0]!;
    const para = doc.insertBlock("paragraph", undefined, { parent: doc.getChildren(firstRow)[0]! });
    doc.insertText(para, 0, "anchor");
    press(rowHandle(0));
    fireEvent.click(menuItem("Move down"));
    const after = doc.getChildren(tableId);
    expect(after[1]).toBe(firstRow);
    const cellAfter = doc.getChildren(firstRow)[0]!;
    const paraId = doc.getChildren(cellAfter)[0]!;
    expect(doc.getText(paraId)).toBe("anchor");
  });
});

describe("the handle drag (the press-drag-release commits the move)", () => {
  it("a column drag to the end moves the column (its width travels)", () => {
    const { doc, tableId } = renderTableDoc(3, 2, [111, 100, 100]);
    press(colHandle(0), { x: 260, y: 0 });
    const after = doc.getBlock(tableId);
    expect(after !== null && after.type === "table").toBe(true);
    if (after !== null && after.type === "table") {
      // The dragged column (111 px) stands last.
      expect(after.attrs?.columnWidths).toEqual([100, 100, 111]);
    }
    doc.undo();
    const restored = doc.getBlock(tableId);
    expect(restored !== null && restored.type === "table" && restored.attrs?.columnWidths).toEqual([111, 100, 100]);
  });

  it("the dragged chip follows the pointer on its own axis (column: left, row: top)", () => {
    renderTableDoc(3, 3, [100, 100, 100]);
    // The column chip: the base left is 60px (the zone + half the column,
    // minus half the chip); a horizontal drag moves it by the dx only.
    const colBaseLeft = colHandle(0).style.left;
    const colBaseTop = colHandle(0).style.top;
    expect(colBaseLeft).toBe("60px");
    expect(colBaseTop).toBe("0px");
    fireEvent.pointerDown(colHandle(0), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(colHandle(0), { clientX: 80, clientY: -30, pointerId: 1 });
    expect(colHandle(0).style.left).toBe("140px");
    expect(colHandle(0).style.top).toBe("0px");
    fireEvent.pointerUp(colHandle(0), { clientX: 80, clientY: -30, pointerId: 1 });
    // The row chip: the base top is 10px (the zone minus half the chip — the
    // jsdom row metrics stand zero); a vertical drag moves it by the dy only.
    const rowBaseLeft = rowHandle(0).style.left;
    const rowBaseTop = rowHandle(0).style.top;
    expect(rowBaseLeft).toBe("0px");
    expect(rowBaseTop).toBe("10px");
    fireEvent.pointerDown(rowHandle(0), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(rowHandle(0), { clientX: 40, clientY: 60, pointerId: 1 });
    expect(rowHandle(0).style.top).toBe("70px");
    expect(rowHandle(0).style.left).toBe("0px");
    fireEvent.pointerUp(rowHandle(0), { clientX: 40, clientY: 60, pointerId: 1 });
  });

  it("a no-op drop (back into the same position) issues no command", () => {
    const { doc, tableId } = renderTableDoc(3, 2, [111, 100, 100]);
    press(colHandle(0), { x: 10, y: 0 });
    const after = doc.getBlock(tableId);
    expect(after !== null && after.type === "table" && after.attrs?.columnWidths).toEqual([111, 100, 100]);
  });

  it("a stale drop (a concurrent structural change) issues no command", () => {
    const { doc, tableId } = renderTableDoc(3, 2, [111, 100, 100]);
    fireEvent.pointerDown(colHandle(0), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(colHandle(0), { clientX: 260, clientY: 0, pointerId: 1 });
    // A peer inserts a column while the drag is in flight.
    doc.insertTableColumn(tableId);
    fireEvent.pointerUp(colHandle(0), { clientX: 260, clientY: 0, pointerId: 1 });
    const after = doc.getBlock(tableId);
    expect(after !== null && after.type === "table").toBe(true);
    if (after !== null && after.type === "table") {
      // The insertion stands; the move was dropped (the widths are the
      // insert-appended sequence, the dragged column in its place).
      expect(after.attrs?.columnWidths).toEqual([111, 100, 100, 100]);
    }
  });

  it("a row drag commits the move (the jsdom midpoints stand zero: the drop above all stationary rows moves the row to the front)", () => {
    const { doc, tableId } = renderTableDoc(2, 3);
    const rows = doc.getChildren(tableId);
    const draggedRow = rows[1]!;
    fireEvent.pointerDown(rowHandle(1), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(rowHandle(1), { clientX: 0, clientY: -6, pointerId: 1 });
    fireEvent.pointerUp(rowHandle(1), { clientX: 0, clientY: -6, pointerId: 1 });
    const after = doc.getChildren(tableId);
    expect(after[0]).toBe(draggedRow);
    doc.undo();
    expect(doc.getChildren(tableId)[0]).toBe(rows[0]!);
  });

  it("a stale row drop (a concurrent row insert) issues no command", () => {
    const { doc, tableId } = renderTableDoc(2, 3);
    const rows = doc.getChildren(tableId);
    fireEvent.pointerDown(rowHandle(1), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(rowHandle(1), { clientX: 0, clientY: -6, pointerId: 1 });
    // A peer appends a row while the drag is in flight.
    doc.insertTableRow(tableId);
    fireEvent.pointerUp(rowHandle(1), { clientX: 0, clientY: -6, pointerId: 1 });
    const after = doc.getChildren(tableId);
    expect(after.length).toBe(4);
    expect(after[1]).toBe(rows[1]!);
  });
});

describe("the cell background (the column color over the row color)", () => {
  it("the column color wins at the intersection; the row color shows where the column has none", async () => {
    const { doc, tableId } = renderTableDoc(2, 2);
    const rows = doc.getChildren(tableId);
    await act(async () => {
      doc.setTableColumnColor(tableId, 0, "#ff0000");
      doc.setTableRowColor(tableId, rows[0]!, "#00ff00");
    });
    expect(cellAt(0, 0).style.background).toBe("rgb(255, 0, 0)");
    expect(cellAt(1, 0).style.background).toBe("rgb(255, 0, 0)");
    expect(cellAt(0, 1).style.background).toBe("rgb(0, 255, 0)");
    expect(cellAt(1, 1).style.background).toBe("");
  });
});

describe("the handle's keyboard path (the tab focus + the menu)", () => {
  it("the handles stand focusable buttons (the label, the tab index)", () => {
    renderTableDoc(2, 2);
    const col = colHandle(0);
    const row = rowHandle(0);
    expect(col.tagName).toBe("BUTTON");
    expect(col.getAttribute("aria-label")).toBe("Column 1 options");
    expect(row.getAttribute("aria-label")).toBe("Row 1 options");
    expect(col.tabIndex).toBe(0);
    expect(row.tabIndex).toBe(0);
  });

  it("the Enter on the focused handle opens the menu (the controlled state stand)", async () => {
    renderTableDoc(2, 2);
    const handle = rowHandle(0);
    handle.focus();
    await act(async () => {
      fireEvent.keyDown(handle, { key: "Enter" });
    });
    expect(menuContent("docblocks/table-row-menu"), "the row's menu should be open").not.toBeNull();
  });
});

describe("the seam's keyboard resize (the arrow steps the column's width)", () => {
  it("the ArrowRight steps the width (one command; the undo stands it back)", async () => {
    const { doc, tableId } = renderTableDoc(2, 2, [120, 100]);
    const seam = document.querySelector<HTMLElement>('[data-slot="docblocks/table-col-resize"][data-index="0"]')!;
    expect(seam, "the seam should stand").not.toBeNull();
    expect(seam.getAttribute("role")).toBe("separator");
    expect(seam.getAttribute("aria-label")).toBe("Resize column 1");
    expect(seam.tabIndex).toBe(0);
    const readWidths = () => {
      const block = doc.getBlock(tableId);
      return (block as { attrs?: { columnWidths?: number[] } } | undefined)?.attrs?.columnWidths;
    };
    expect(readWidths()).toEqual([120, 100]);
    seam.focus();
    await act(async () => {
      fireEvent.keyDown(seam, { key: "ArrowRight" });
    });
    expect(readWidths()).toEqual([128, 100]);
    await act(async () => {
      doc.undo();
    });
    expect(readWidths()).toEqual([120, 100]);
  });

  it("the clamp stands the no-op at the minimum (no command, no undo step)", async () => {
    const { doc, tableId } = renderTableDoc(2, 2, [50, 100]);
    const seam = document.querySelector<HTMLElement>('[data-slot="docblocks/table-col-resize"][data-index="0"]')!;
    seam.focus();
    await act(async () => {
      fireEvent.keyDown(seam, { key: "ArrowLeft" });
    });
    const block = doc.getBlock(tableId);
    expect((block as { attrs?: { columnWidths?: number[] } } | undefined)?.attrs?.columnWidths).toEqual([50, 100]);
  });
});
