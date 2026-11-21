// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { clampColumnWidth } from "../src/blocks/table";
import { renderTableDoc, seam } from "./table-context.helpers";

describe("the column seam resize", () => {
  it("stand at every column's right edge (the interior boundaries + the table's right) and hidden at rest", () => {
    renderTableDoc([120, 140]);
    // Two columns -> two seams: the interior boundary (data-index 0, the
    // column LEFT of it) and the table's right edge (data-index 1 — the
    // last column resizes there too).
    expect(seam(0)).not.toBeNull();
    expect(seam(1)).not.toBeNull();
    expect(document.querySelector('[data-slot="docblocks/table-col-resize"][data-index="2"]')).toBeNull();
    expect(seam(0).className).toContain("opacity-0");
    expect(seam(0).className).toContain("cursor-col-resize");
  });

  it("a drag commits the new width on the release (one command, one undo step)", () => {
    const { doc, tableId } = renderTableDoc([100, 150]);
    // The seam at data-index 0 resizes column 0 (the column LEFT of the seam).
    fireEvent.pointerDown(seam(0), { button: 0, clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(seam(0), { clientX: 140, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(seam(0), { clientX: 140, clientY: 50, pointerId: 1 });

    const after = doc.getBlock(tableId);
    expect(after !== null && after.type === "table" && after.attrs?.columnWidths).toEqual([140, 150]);
    doc.undo();
    const afterUndo = doc.getBlock(tableId);
    expect(afterUndo !== null && afterUndo.type === "table" && afterUndo.attrs?.columnWidths).toEqual([100, 150]);
  });

  it("the live preview stands the width locally (no wire traffic until the release)", () => {
    renderTableDoc([100, 150]);
    const cols = () => document.querySelectorAll<HTMLTableColElement>("colgroup > col");
    expect(cols()[0]!.style.width).toBe("100px");

    fireEvent.pointerDown(seam(0), { button: 0, clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(seam(0), { clientX: 180, clientY: 50, pointerId: 1 });
    expect(cols()[0]!.style.width).toBe("180px");
    expect(document.querySelector<HTMLTableElement>('[data-slot="docblocks/table"]')!.style.width).toBe("330px");

    fireEvent.pointerUp(seam(0), { clientX: 180, clientY: 50, pointerId: 1 });
  });

  it("the 50 px floor clamps the drag (and the preview)", () => {
    const { doc, tableId } = renderTableDoc([100, 150]);
    fireEvent.pointerDown(seam(0), { button: 0, clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(seam(0), { clientX: -50, clientY: 50, pointerId: 1 });
    expect(document.querySelectorAll<HTMLTableColElement>("colgroup > col")[0]!.style.width).toBe("50px");
    fireEvent.pointerUp(seam(0), { clientX: -50, clientY: 50, pointerId: 1 });

    const afterClamp = doc.getBlock(tableId);
    expect(afterClamp !== null && afterClamp.type === "table" && afterClamp.attrs?.columnWidths).toEqual([50, 150]);
    expect(clampColumnWidth(10)).toBe(50);
    expect(clampColumnWidth(50.4)).toBe(50);
    expect(clampColumnWidth(120.6)).toBe(121);
  });

  it("a 0 px drag is a no-op (no command, the widths stand)", () => {
    const { doc, tableId } = renderTableDoc([100, 150]);
    fireEvent.pointerDown(seam(0), { button: 0, clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(seam(0), { clientX: 100, clientY: 50, pointerId: 1 });

    const afterNoop = doc.getBlock(tableId);
    expect(afterNoop !== null && afterNoop.type === "table" && afterNoop.attrs?.columnWidths).toEqual([100, 150]);
  });
});
