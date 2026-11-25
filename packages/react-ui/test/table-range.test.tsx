// @vitest-environment jsdom
// The table cell range: the corner grip's drag selects a rectangle of cells
// (a view-state slice — the doc stands untouched until a command), the cells
// inside the range stand the selection tint, and the cell menu offers the
// merge / split commands over the selection and the merged region.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    const drawn = drawnRows();
    const target = drawn[1]![1]!;
    const grip = gripOf(drawn[0]![0]!);
    document.elementFromPoint = () => target;
    fireEvent.pointerDown(grip, { pointerId: 7, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(grip, { pointerId: 7, clientX: 80, clientY: 60 });
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
    const drawn = drawnRows();
    const grip = gripOf(drawn[0]![0]!);
    document.elementFromPoint = () => drawn[0]![1]!;
    fireEvent.pointerDown(grip, { pointerId: 3 });
    fireEvent.pointerMove(grip, { pointerId: 3 });
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
