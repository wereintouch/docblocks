// @vitest-environment jsdom
// The table row/column handles: the drop positions (the pure math), the
// hover reveal (the handle stands over the hovered cell's row and
// column), and the press without a drag opens the handle menu (the
// palette, the insert/move/duplicate/clear/delete items with the edge
// moves disabled).
import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { columnDropPosition, rowDropPosition } from "../src/blocks/table";
import {
  cellAt,
  colHandle,
  isDisabled,
  menuContent,
  menuItem,
  press,
  renderTableDoc,
  rowHandle,
} from "./table-handle.helpers";

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

  it("the swatch sets the column color (one undo step) and the none's swatch clears it", () => {
    const { doc, tableId } = renderTableDoc(2);
    press(colHandle(0));
    // The swatches stand in the Background sub (the shared's palette) — the
    // sub opens on the trigger's click.
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='dropdown-menu-sub-trigger']")!);
    const subContent = document.querySelector<HTMLElement>("[data-slot='docblocks/table-color-palette']");
    expect(subContent, "the table's palette should stand").not.toBeNull();
    const swatch = subContent!.querySelector<HTMLElement>("[data-slot='docblocks/palette-swatch']");
    expect(swatch, "a palette swatch should stand").not.toBeNull();
    fireEvent.click(swatch!);
    // The column's cells carry the resolved hex (both rows); the pick's
    // stand closes the menu (the swatch's no-item parity).
    const rows = doc.getChildren(tableId);
    for (const rowId of rows) {
      const cellId = doc.getChildren(rowId)[0]!;
      const cell = doc.getBlock(cellId);
      expect(cell !== null && cell.type === "table-cell" && cell.attrs?.columnColor !== undefined).toBe(true);
    }
    expect(document.querySelector("[data-slot='docblocks/table-col-menu']")?.getAttribute("data-state")).not.toBe(
      "open"
    );
    // The re-opened menu's none's swatch (the clear's stand) clears the
    // color.
    press(colHandle(0));
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='dropdown-menu-sub-trigger']")!);
    const none = document.querySelector<HTMLElement>(
      "[data-slot='docblocks/table-color-palette'] [data-slot='docblocks/palette-none']"
    );
    expect(none, "the none's swatch should stand").not.toBeNull();
    fireEvent.click(none!);
    const rowId = doc.getChildren(tableId)[0]!;
    const cell = doc.getBlock(doc.getChildren(rowId)[0]!);
    expect(cell !== null && cell.type === "table-cell" && cell.attrs?.columnColor === undefined).toBe(true);
  });

  it("the row swatch sets the row color (in the row's cells) and the none's swatch clears it", () => {
    const { doc, tableId } = renderTableDoc(2);
    const rows = doc.getChildren(tableId);
    press(rowHandle(0));
    // The swatches stand in the Background sub (the shared's palette) — the
    // sub opens on the trigger's click.
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='dropdown-menu-sub-trigger']")!);
    const subContent = document.querySelector<HTMLElement>("[data-slot='docblocks/table-color-palette']");
    expect(subContent, "the table's palette should stand").not.toBeNull();
    const swatch = subContent!.querySelector<HTMLElement>("[data-slot='docblocks/palette-swatch']");
    expect(swatch, "a palette swatch should stand").not.toBeNull();
    fireEvent.click(swatch!);
    // The row's cells carry the row color (the second row's do not).
    const row0Cells = doc.getChildren(rows[0]!);
    for (const cellId of row0Cells) {
      const cell = doc.getBlock(cellId);
      expect(cell !== null && cell.type === "table-cell" && cell.attrs?.rowColor !== undefined).toBe(true);
    }
    const row1Cells = doc.getChildren(rows[1]!);
    for (const cellId of row1Cells) {
      const cell = doc.getBlock(cellId);
      expect(cell !== null && cell.type === "table-cell" && cell.attrs?.rowColor === undefined).toBe(true);
    }
    // The re-opened menu's none's swatch (the row's color lives in the
    // row's cells, not the row block — the menu must re-read it from the
    // store).
    press(rowHandle(0));
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='dropdown-menu-sub-trigger']")!);
    const none = document.querySelector<HTMLElement>(
      "[data-slot='docblocks/table-color-palette'] [data-slot='docblocks/palette-none']"
    );
    expect(none, "the none's swatch should stand").not.toBeNull();
    fireEvent.click(none!);
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
