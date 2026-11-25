// @vitest-environment jsdom
// The table cell range: the corner grip's drag selects a rectangle of cells
// (a view-state slice — the doc stands untouched until a command), the cells
// inside the range stand the selection tint, and the cell menu offers the
// merge / split commands over the selection and the merged region.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-11-25T00:00:00.000Z";

// jsdom implements neither pointer capture nor the hit test the drag reads.
beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface TableStand {
  doc: ReturnType<typeof createDoc>;
  tableId: BlockId;
}

/** A 3x3 table (an optional merge before the mount), rendered standalone. */
function renderTable(options: { mode?: "edit" | "view"; merge?: boolean } = {}): TableStand {
  const doc = createDoc({ id: "doc-range", createdAt: CREATED_AT });
  const tableId = doc.insertBlock("table", { cols: 3 });
  for (let r = 0; r < 3; r += 1) {
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    for (let c = 0; c < 3; c += 1) doc.insertBlock("table-cell", undefined, { parent: rowId });
  }
  if (options.merge === true) doc.mergeTableCells(tableId, { row: 0, col: 0 }, { row: 0, col: 1 });
  render(
    <EditorProvider doc={doc} mode={options.mode ?? "edit"}>
      <Editor />
    </EditorProvider>
  );
  return { doc, tableId };
}

/** The drawn cells per row (the DOM order). */
function drawnRows(): HTMLTableCellElement[][] {
  return [...document.querySelectorAll<HTMLTableRowElement>("tbody > tr")].map((row) => [
    ...row.querySelectorAll<HTMLTableCellElement>("td"),
  ]);
}

/** jsdom computes no layout: stand a unique box per drawn cell (the range's
 *  hit test reads the boxes, not the top-most element). */
function standCellBoxes(): void {
  const cells = [...document.querySelectorAll<HTMLElement>("td[data-slot='docblocks/table-cell']")];
  cells.forEach((cell, index) => {
    cell.getBoundingClientRect = () =>
      ({
        left: index * 100,
        right: index * 100 + 90,
        top: index * 60,
        bottom: index * 60 + 50,
        width: 90,
        height: 50,
        x: index * 100,
        y: index * 60,
        toJSON: () => ({}),
      }) as DOMRect;
  });
}

/** The pointer point over the cell's box (the stubbed geometry). */
function pointOf(cell: HTMLElement): { clientX: number; clientY: number } {
  const box = cell.getBoundingClientRect();
  return { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
}

function gripOf(cell: HTMLElement): HTMLElement {
  const grip = cell.querySelector<HTMLElement>('[data-slot="docblocks/table-cell-range-grip"]');
  expect(grip, "the cell's range grip should render").not.toBeNull();
  return grip!;
}

/** The cells standing in the range (the tint's `data-range` hook). */
function selectedCount(): number {
  return document.querySelectorAll('[data-slot="docblocks/table-cell"][data-range="true"]').length;
}

/** The deferred cell-menu open lands past the release: poll the item. */
async function menuItem(label: string): Promise<HTMLElement> {
  const deadline = Date.now() + 1000;
  for (;;) {
    const item = screen.queryByText(label, { selector: '[data-slot="dropdown-menu-item"]' });
    if (item !== null) return item;
    if (Date.now() >= deadline) throw new Error(`the ${label} menu item should stand`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The right-click's sequence (the open stands the release). */
function rightClick(cell: HTMLElement): void {
  fireEvent.pointerDown(cell, { clientX: 40, clientY: 30, button: 2, buttons: 2, pointerId: 1 });
  fireEvent.contextMenu(cell, { clientX: 40, clientY: 30, button: 2, buttons: 2 });
  fireEvent.pointerUp(cell, { clientX: 40, clientY: 30, button: 2, pointerId: 1 });
}

describe("the table cell range", () => {
  it("renders the grip in the editing mode and none over the read-only mode", () => {
    renderTable();
    expect(document.querySelectorAll('[data-slot="docblocks/table-cell-range-grip"]').length).toBe(9);
    cleanup();
    renderTable({ mode: "view" });
    expect(document.querySelectorAll('[data-slot="docblocks/table-cell-range-grip"]').length).toBe(0);
  });

  it("selects the rectangle between the grip's cell and the pointer's cell", async () => {
    renderTable();
    standCellBoxes();
    const drawn = drawnRows();
    const grip = gripOf(drawn[0]![0]!);
    fireEvent.pointerDown(grip, { pointerId: 7, ...pointOf(drawn[0]![0]!) });
    fireEvent.pointerMove(grip, { pointerId: 7, ...pointOf(drawn[1]![1]!) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The 2x2 rectangle's cells stand the tint; the doc stands untouched.
    expect(selectedCount()).toBe(4);
    expect(drawn[0]![0]!.getAttribute("data-range")).toBe("true");
    expect(drawn[1]![1]!.getAttribute("data-range")).toBe("true");
    expect(drawn[2]![2]!.getAttribute("data-range")).toBeNull();
    // The rectangle's frame: the boundary cells carry the selection border's
    // inset edges (the canvas selection's cyan over the range's tint).
    const border = "var(--docblocks-table-range-border-color)";
    expect(drawn[0]![0]!.style.boxShadow).toContain(border);
    expect(drawn[0]![0]!.style.background).toContain("--docblocks-table-range-background");
    expect(drawn[1]![0]!.style.boxShadow).toContain(border);
    fireEvent.pointerUp(grip, { pointerId: 7 });
    expect(selectedCount()).toBe(4);
  });

  it("merges the selected rectangle over the cell menu (one undo step) and splits it back", async () => {
    const { doc, tableId } = renderTable();
    standCellBoxes();
    const drawn = drawnRows();
    const grip = gripOf(drawn[0]![0]!);
    fireEvent.pointerDown(grip, { pointerId: 3, ...pointOf(drawn[0]![0]!) });
    fireEvent.pointerMove(grip, { pointerId: 3, ...pointOf(drawn[0]![1]!) });
    fireEvent.pointerUp(grip, { pointerId: 3 });

    rightClick(drawn[0]![0]!);
    const merge = await menuItem("Merge cells");
    expect(merge.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(merge);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const merged = drawnRows();
    expect(merged[0]).toHaveLength(2);
    expect(merged[0]![0]!.colSpan).toBe(2);
    // The range clears over the merge.
    expect(selectedCount()).toBe(0);

    // The split: the right-click over the merged cell offers the command.
    rightClick(drawnRows()[0]![0]!);
    const split = await menuItem("Split cells");
    expect(split.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(split);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(drawnRows()[0]![0]!.colSpan).toBe(1);
    expect(doc.getBlock(tableId)?.type).toBe("table");
  });

  it("stands the merge item disabled without a multi-cell range", async () => {
    renderTable();
    rightClick(drawnRows()[0]![0]!);
    const merge = await menuItem("Merge cells");
    expect(merge.getAttribute("aria-disabled")).toBe("true");
    const split = await menuItem("Split cells");
    expect(split.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("the merged regions over the range", () => {
  it("stands no seam inside a region (the interior boundary is not resizable)", () => {
    renderTable({ merge: true });
    // The region covers the columns 0..1: the seam at its interior boundary
    // (the right edge of column 0) is gone; the region's outer edge stays.
    expect(document.querySelector('[data-slot="docblocks/table-col-resize"][data-index="0"]')).toBeNull();
    expect(document.querySelector('[data-slot="docblocks/table-col-resize"][data-index="1"]')).not.toBeNull();
  });

  it("selects whole regions: a rectangle never cuts a merged cell", async () => {
    renderTable({ merge: true });
    standCellBoxes();
    const drawn = drawnRows();
    // The region's cell stands the first td; dragging from its grip over the
    // cell below it selects the union of whole rectangles.
    const grip = gripOf(drawn[0]![0]!);
    fireEvent.pointerDown(grip, { pointerId: 11, ...pointOf(drawn[0]![0]!) });
    fireEvent.pointerMove(grip, { pointerId: 11, ...pointOf(drawn[1]![0]!) });
    fireEvent.pointerUp(grip, { pointerId: 11 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The region's two columns carry the rectangle: the region + both cells
    // under it (the rect stands two grid columns wide, never cut).
    expect(selectedCount()).toBe(3);
    expect(drawn[0]![0]!.getAttribute("data-range")).toBe("true");
    expect(drawn[1]![0]!.getAttribute("data-range")).toBe("true");
    expect(drawn[1]![1]!.getAttribute("data-range")).toBe("true");
    expect(drawn[0]![1]!.getAttribute("data-range")).toBeNull();
  });

  it("clears the range over a press outside the table's cells", async () => {
    renderTable({ merge: true });
    standCellBoxes();
    const drawn = drawnRows();
    const grip = gripOf(drawn[0]![0]!);
    fireEvent.pointerDown(grip, { pointerId: 21, ...pointOf(drawn[0]![0]!) });
    fireEvent.pointerMove(grip, { pointerId: 21, ...pointOf(drawn[2]![0]!) });
    fireEvent.pointerUp(grip, { pointerId: 21 });
    expect(selectedCount()).toBeGreaterThan(0);
    // The press on the document's content outside the table (an empty place
    // of the page) clears it; the portaled layers never do.
    const editorRoot = document.querySelector<HTMLElement>('[data-slot="docblocks/editor"]');
    expect(editorRoot, "the editor root should render").not.toBeNull();
    fireEvent.pointerDown(editorRoot!);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(selectedCount()).toBe(0);
  });
});

describe("the region's chrome stands", () => {
  it("offers no reorder handle over a region's columns and rows", () => {
    renderTable({ merge: true });
    // The region covers columns 0..1 of the row 0: the handles stand for the
    // free column 2 only.
    const columnHandles = [...document.querySelectorAll('[data-slot="docblocks/table-col-handle"]')].map((el) =>
      el.getAttribute("data-index")
    );
    expect(columnHandles).toEqual(["2"]);
    // A rowspan region locks its rows: the plain row handles all stand here.
    expect(document.querySelectorAll('[data-slot="docblocks/table-row-handle"]').length).toBe(3);
  });

  it("clears the range over a structural change (the rectangles go stale)", async () => {
    const { doc, tableId } = renderTable();
    standCellBoxes();
    const drawn = drawnRows();
    const grip = gripOf(drawn[0]![0]!);
    fireEvent.pointerDown(grip, { pointerId: 31, ...pointOf(drawn[0]![0]!) });
    fireEvent.pointerMove(grip, { pointerId: 31, ...pointOf(drawn[1]![0]!) });
    fireEvent.pointerUp(grip, { pointerId: 31 });
    expect(selectedCount()).toBeGreaterThan(1);
    // An insert above the selection changes the grid under the range.
    act(() => {
      doc.insertTableRow(tableId, 0);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(selectedCount()).toBe(0);
  });
});
