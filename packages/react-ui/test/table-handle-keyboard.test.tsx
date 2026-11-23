// @vitest-environment jsdom
// The table handle's keyboard path: the tab focus (the button's label,
// the tab index, the Enter's menu open) and the seam's keyboard resize
// (the arrow's width step, the clamp at the minimum's no-op).
import { act, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { colHandle, menuContent, renderTableDoc, rowHandle } from "./table-handle.helpers";

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
