// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { cellIdAt, flushFrames, renderTableDoc } from "./table-context.helpers";

describe("the format toolbar over a cell selection", () => {
  it("stands over the range and formats the cell's paragraph (the existing path)", async () => {
    const { doc, tableId } = renderTableDoc();
    const cellId = cellIdAt(doc, tableId, 0, 0);
    const p1 = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(p1, 0, "alpha");
    await flushFrames();

    const inner = document.querySelector<HTMLElement>(`[data-block-id="${p1}"] [data-slot="docblocks/block-content"]`)!;
    const node = inner.firstChild;
    expect(node, "the cell paragraph should carry a text node").not.toBeNull();
    const range = document.createRange();
    range.setStart(node!, 0);
    range.setEnd(node!, 5);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await flushFrames();

    const toolbar = document.querySelector<HTMLElement>('[data-slot="docblocks/format-toolbar"]');
    expect(toolbar, "the toolbar should stand over the cell range").not.toBeNull();
    fireEvent.click(toolbar!.querySelector<HTMLElement>('[data-mark="bold"]')!);
    await flushFrames();

    expect(doc.getRuns(p1)).toEqual([{ text: "alpha", marks: { bold: true } }]);
  });
});
