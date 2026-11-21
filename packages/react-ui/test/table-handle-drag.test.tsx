// @vitest-environment jsdom
// The table handle's drag: the press-drag-release commits the move (one
// command; the stale-drop guard drops a commit when a concurrent
// structural change invalidates the press-time snapshot), the mid-drag's
// preview over the dragged cells (the transforms, the boundary, the
// transition's stand), and the cell's background (the column color over
// the row color).
import { act, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { cellAt, colHandle, press, renderTableDoc, rowHandle } from "./table-handle.helpers";

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

  it("the mid-drag preview transforms the dragged column's cells (the tr carries none) and cards the dragged cell", () => {
    renderTableDoc(3, 3, [120, 140, 90]);
    // The column drag (the pointer's 100 px right): the dragged column's
    // cells follow the pointer with the card's background (the empty cell's
    // move must read), the stationary column's cells take the parting shift
    // (the transition, no card), and the tr carries no transform (the tr
    // is not a CSS transformable element).
    fireEvent.pointerDown(colHandle(0), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(colHandle(0), { clientX: 100, clientY: 0, pointerId: 1 });
    const draggedCell = cellAt(0, 0);
    expect(draggedCell.style.transform).toBe("translate(100px, 0px)");
    expect(draggedCell.style.background).toContain("--docblocks-table-drag-background");
    expect(draggedCell.style.boxShadow).toContain("--docblocks-table-drag-shadow");
    expect(draggedCell.style.zIndex).toBe("10");
    const shiftedCell = cellAt(0, 1);
    expect(shiftedCell.style.transform).toBe("translate(-120px, 0px)");
    expect(shiftedCell.style.transition).toContain("transform");
    expect(shiftedCell.style.background).toBe("");
    for (const tr of document.querySelectorAll<HTMLTableRowElement>("tbody > tr")) {
      expect(tr.style.transform).toBe("");
    }
    fireEvent.pointerUp(colHandle(0), { clientX: 100, clientY: 0, pointerId: 1 });
    // The preview clears on the release (the commit's re-render keeps the
    // fresh geometry, no residual transform).
    expect(cellAt(0, 0).style.transform).toBe("");
  });

  it("the mid-drag preview moves the dragged row's cells (the tr carries no transform)", () => {
    renderTableDoc(3, 3, [120, 140, 90]);
    // The row drag (the pointer's 60 px down): the dragged row's cells
    // follow on the y (the tr carries no transform — the row's transform
    // applies over the cells only).
    fireEvent.pointerDown(rowHandle(0), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(rowHandle(0), { clientX: 0, clientY: 60, pointerId: 1 });
    const draggedRowCell = cellAt(0, 0);
    expect(draggedRowCell.style.transform).toBe("translate(0px, 60px)");
    expect(draggedRowCell.style.background).toContain("--docblocks-table-drag-background");
    expect(draggedRowCell.style.zIndex).toBe("10");
    for (const tr of document.querySelectorAll<HTMLTableRowElement>("tbody > tr")) {
      expect(tr.style.transform).toBe("");
    }
    fireEvent.pointerUp(rowHandle(0), { clientX: 0, clientY: 60, pointerId: 1 });
  });

  it("the dragged cell keeps a thin inset boundary over the drag shadow (the collapsed borders do not travel)", () => {
    const { doc, tableId } = renderTableDoc(3, 3, [120, 140, 90]);
    // The column drag (the pointer's 100 px right): the dragged cell's
    // card keeps a thin inset outline (the cell's line stand) in the same
    // shadow as the drag shadow — the collapsed cell's borders stand on
    // the table's layout and do not travel over the transform.
    fireEvent.pointerDown(colHandle(0), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(colHandle(0), { clientX: 100, clientY: 0, pointerId: 1 });
    const draggedCell = cellAt(0, 0);
    expect(draggedCell.style.boxShadow).toContain("--docblocks-table-drag-shadow");
    expect(draggedCell.style.boxShadow).toContain(
      "inset 0 0 0 var(--docblocks-table-border-width) var(--docblocks-table-border-color)"
    );
    // The preview clears on the release: the boundary stands with the drag.
    fireEvent.pointerUp(colHandle(0), { clientX: 100, clientY: 0, pointerId: 1 });
    expect(cellAt(0, 0).style.boxShadow).toBe("");
    // The row drag's dragged cells stand the same boundary.
    fireEvent.pointerDown(rowHandle(0), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(rowHandle(0), { clientX: 0, clientY: 60, pointerId: 1 });
    expect(cellAt(0, 0).style.boxShadow).toContain("inset 0 0 0 var(--docblocks-table-border-width)");
    expect(cellAt(0, 1).style.boxShadow).toContain("inset 0 0 0 var(--docblocks-table-border-width)");
    fireEvent.pointerUp(rowHandle(0), { clientX: 0, clientY: 60, pointerId: 1 });

    // A colored card keeps both its background and the same boundary.
    act(() => doc.setTableColumnColor(tableId, 0, "#ff0000"));
    fireEvent.pointerDown(colHandle(0), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(colHandle(0), { clientX: 100, clientY: 0, pointerId: 1 });
    expect(cellAt(0, 0).style.background).toBe("rgb(255, 0, 0)");
    expect(cellAt(0, 0).style.boxShadow).toContain("inset 0 0 0 var(--docblocks-table-border-width)");
    fireEvent.pointerUp(colHandle(0), { clientX: 100, clientY: 0, pointerId: 1 });
  });

  it("the dragged handle stands no left/top transition (the drag's stationary handles keep it)", () => {
    renderTableDoc(3, 3, [120, 140, 90]);
    // At rest the chips keep their positional transition (a seam resize
    // glides); only the actively dragged chip suppresses it.
    expect(colHandle(0).style.transition).toBe("left 120ms ease-out, top 120ms ease-out");
    expect(rowHandle(0).style.transition).toBe("left 120ms ease-out, top 120ms ease-out");
    // The column drag (the pointer's 100 px right): the dragged chip
    // follows the pointer with no transition (its lag stands over the
    // dragged cells' none), the stationary chips keep it.
    fireEvent.pointerDown(colHandle(0), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(colHandle(0), { clientX: 100, clientY: 0, pointerId: 1 });
    expect(colHandle(0).style.transition).toBe("");
    expect(colHandle(1).style.transition).toBe("left 120ms ease-out, top 120ms ease-out");
    expect(colHandle(2).style.transition).toBe("left 120ms ease-out, top 120ms ease-out");
    fireEvent.pointerUp(colHandle(0), { clientX: 100, clientY: 0, pointerId: 1 });
    // The row drag: the dragged chip stands no transition, the
    // stationary's keep it.
    fireEvent.pointerDown(rowHandle(0), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(rowHandle(0), { clientX: 0, clientY: 60, pointerId: 1 });
    expect(rowHandle(0).style.transition).toBe("");
    expect(rowHandle(1).style.transition).toBe("left 120ms ease-out, top 120ms ease-out");
    expect(rowHandle(2).style.transition).toBe("left 120ms ease-out, top 120ms ease-out");
    fireEvent.pointerUp(rowHandle(0), { clientX: 0, clientY: 60, pointerId: 1 });
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
