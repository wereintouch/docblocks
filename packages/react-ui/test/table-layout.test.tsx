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

describe("the add chips' drag (the multi add / remove)", () => {
  const rowChip = () => document.querySelector<HTMLElement>('[data-slot="docblocks/table-add-row"]');
  const colChip = () => document.querySelector<HTMLElement>('[data-slot="docblocks/table-add-column"]');

  /** A chip press + drag (the jsdom's deltas stand the drag's arithmetic). */
  function dragChip(el: HTMLElement, dx: number, dy: number, from = { x: 100, y: 100 }): void {
    fireEvent.pointerDown(el, { button: 0, clientX: from.x, clientY: from.y, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: from.x + dx / 2, clientY: from.y + dy / 2, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: from.x + dx, clientY: from.y + dy, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: from.x + dx, clientY: from.y + dy, pointerId: 1 });
  }

  it("the row chip's drag down appends the count's rows (the ghosts stand, one undo step)", () => {
    const { doc, tableId } = renderTableDoc(2);
    const chip = rowChip();
    expect(chip).not.toBeNull();
    fireEvent.pointerDown(chip!, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(chip!, { clientX: 100, clientY: 148, pointerId: 1 }); // 48 px = two steps
    // The preview: two ghost rows stand (view state — the doc is untouched).
    expect(document.querySelectorAll('[data-slot="docblocks/table-ghost-row"]').length).toBe(2);
    expect(doc.getChildren(tableId).length).toBe(2);
    fireEvent.pointerUp(chip!, { clientX: 100, clientY: 148, pointerId: 1 });
    expect(doc.getChildren(tableId).length).toBe(4);
    // One undo step: the whole drag is one transact.
    doc.undo();
    expect(doc.getChildren(tableId).length).toBe(2);
    // The ghosts stand down with the release.
    expect(document.querySelectorAll('[data-slot="docblocks/table-ghost-row"]').length).toBe(0);
  });

  it("the row chip's drag up removes the last rows (the floor keeps one)", () => {
    const { doc, tableId } = renderTableDoc(2);
    dragChip(rowChip()!, 0, -24);
    expect(doc.getChildren(tableId).length).toBe(1);

    const { doc: doc2, tableId: tableId2 } = (() => {
      cleanup();
      return renderTableDoc(3);
    })();
    // The far drag clamps to the floor (the last row stays — the full
    // removal is the handle's menu delete only).
    dragChip(rowChip()!, 0, -200);
    expect(doc2.getChildren(tableId2).length).toBe(1);
  });

  it("the column chip's drag right appends the count's columns (the step's the base width, the ghosts stand, one undo step)", () => {
    const { doc, tableId } = renderTableDoc(2, [120, 80]);
    const chip = colChip();
    expect(chip).not.toBeNull();
    fireEvent.pointerDown(chip!, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(chip!, { clientX: 200, clientY: 100, pointerId: 1 }); // 100 px = one base width
    expect(document.querySelectorAll('[data-slot="docblocks/table-ghost-column"]').length).toBe(1);
    fireEvent.pointerMove(chip!, { clientX: 300, clientY: 100, pointerId: 1 }); // 200 px = two
    expect(document.querySelectorAll('[data-slot="docblocks/table-ghost-column"]').length).toBe(2);
    fireEvent.pointerUp(chip!, { clientX: 300, clientY: 100, pointerId: 1 });
    const after = doc.getBlock(tableId);
    expect(after !== null && after.type === "table" && after.attrs.cols).toBe(4);
    expect(after !== null && after.type === "table" && after.attrs.columnWidths).toEqual([120, 80, 100, 100]);
    doc.undo();
    const restored = doc.getBlock(tableId);
    expect(restored !== null && restored.type === "table" && restored.attrs.cols).toBe(2);
  });

  it("the column chip's drag left removes the last columns (the floor keeps one)", () => {
    const { doc, tableId } = renderTableDoc(2, [120, 80]);
    dragChip(colChip()!, -100, 0);
    const after = doc.getBlock(tableId);
    expect(after !== null && after.type === "table" && after.attrs.cols).toBe(1);
    expect(after !== null && after.type === "table" && after.attrs.columnWidths).toEqual([120]);
  });

  it("the short drag (below the step) stands a no-op (no command, no ghosts)", () => {
    const { doc } = renderTableDoc(2);
    const before = doc.toJSON();
    dragChip(rowChip()!, 0, 10);
    expect(document.querySelectorAll('[data-slot="docblocks/table-ghost-row"]').length).toBe(0);
    expect(doc.toJSON()).toEqual(before);
  });

  it("the click after the drag's release adds nothing (the suppress flag)", () => {
    const { doc, tableId } = renderTableDoc(2);
    dragChip(rowChip()!, 0, 48);
    expect(doc.getChildren(tableId).length).toBe(4);
    // The click that follows the drag (the capture keeps it on the chip):
    // the multi-commit already issued — the click adds nothing.
    fireEvent.click(rowChip()!);
    expect(doc.getChildren(tableId).length).toBe(4);
    // The next click (the flag reset) adds one.
    fireEvent.click(rowChip()!);
    expect(doc.getChildren(tableId).length).toBe(5);
  });

  it("the drag ending at the zero-count stands nothing (the commit and the following click both no-op)", () => {
    const { doc, tableId } = renderTableDoc(2);
    const chip = rowChip();
    fireEvent.pointerDown(chip!, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(chip!, { clientX: 100, clientY: 148, pointerId: 1 }); // the two-count
    fireEvent.pointerMove(chip!, { clientX: 100, clientY: 104, pointerId: 1 }); // back to the zero-count
    expect(document.querySelectorAll('[data-slot="docblocks/table-ghost-row"]').length).toBe(0);
    fireEvent.pointerUp(chip!, { clientX: 100, clientY: 104, pointerId: 1 });
    expect(doc.getChildren(tableId).length).toBe(2);
    // The capture's click (the visual stood the no-op) must not insert.
    fireEvent.click(chip!);
    expect(doc.getChildren(tableId).length).toBe(2);
    // The next click (the flag reset) adds one.
    fireEvent.click(chip!);
    expect(doc.getChildren(tableId).length).toBe(3);
  });
});

describe("the table's size stand (the columns x the rows' result)", () => {
  it("stands only during the chip's drag (the resulting size) and is gone at rest and after the release", () => {
    const { doc, tableId } = renderTableDoc(2);
    const badge = () => document.querySelector<HTMLElement>('[data-slot="docblocks/table-size"]');
    // At rest: the stand is hidden.
    expect(badge()).toBeNull();

    // The row chip's drag down 48 px (two rows): the stand stands the
    // resulting size while the preview stands, and is gone on the
    // release.
    const chip = document.querySelector<HTMLElement>('[data-slot="docblocks/table-add-row"]');
    fireEvent.pointerDown(chip!, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(chip!, { clientX: 100, clientY: 148, pointerId: 1 });
    expect(badge()?.textContent).toBe("2 × 4");
    fireEvent.pointerUp(chip!, { clientX: 100, clientY: 148, pointerId: 1 });
    expect(doc.getChildren(tableId).length).toBe(4);
    expect(badge()).toBeNull();

    // The column chip's drag right 100 px (one base width): the resulting
    // columns stand.
    const colChip = document.querySelector<HTMLElement>('[data-slot="docblocks/table-add-column"]');
    fireEvent.pointerDown(colChip!, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(colChip!, { clientX: 200, clientY: 100, pointerId: 1 });
    expect(badge()?.textContent).toBe("3 × 4");
    fireEvent.pointerUp(colChip!, { clientX: 200, clientY: 100, pointerId: 1 });
    const after = doc.getBlock(tableId);
    expect(after !== null && after.type === "table" && after.attrs.cols).toBe(3);
    expect(badge()).toBeNull();
  });

  it("the stand is hidden on the zero-count drag (no add / no remove)", () => {
    renderTableDoc(2);
    const chip = document.querySelector<HTMLElement>('[data-slot="docblocks/table-add-row"]');
    const badge = () => document.querySelector<HTMLElement>('[data-slot="docblocks/table-size"]');
    fireEvent.pointerDown(chip!, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(chip!, { clientX: 100, clientY: 104, pointerId: 1 }); // above the threshold, below the step
    expect(badge()).toBeNull();
    fireEvent.pointerUp(chip!, { clientX: 100, clientY: 104, pointerId: 1 });
  });
});
