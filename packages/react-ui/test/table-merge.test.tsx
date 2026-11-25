// @vitest-environment jsdom
// The merged table's render: the anchor `<td>` carries the region's spans,
// the covered cells stand no `<td>` (the browser's table layout draws the
// rectangle), and the read-only modes keep the spans without the editing
// chrome.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-11-25T00:00:00.000Z";

/** A 3x3 table with an optional merge, rendered standalone. */
function renderTable(
  options: {
    mode?: "edit" | "view";
    merge?: (context: { doc: ReturnType<typeof createDoc>; tableId: BlockId }) => void;
  } = {}
) {
  const doc = createDoc({ id: "doc-merge", createdAt: CREATED_AT });
  const tableId = doc.insertBlock("table", { cols: 3 });
  const rows: BlockId[] = [];
  for (let r = 0; r < 3; r += 1) {
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    rows.push(rowId);
    for (let c = 0; c < 3; c += 1) doc.insertBlock("table-cell", undefined, { parent: rowId });
  }
  options.merge?.({ doc, tableId });
  render(
    <EditorProvider doc={doc} mode={options.mode ?? "edit"}>
      <Editor />
    </EditorProvider>
  );
  return { doc, tableId, rows };
}

/** The drawn cells per row (the DOM order). */
function drawnRows(): HTMLTableCellElement[][] {
  return [...document.querySelectorAll<HTMLTableRowElement>("tbody > tr")].map((row) => [
    ...row.querySelectorAll<HTMLTableCellElement>("td"),
  ]);
}

afterEach(() => {
  cleanup();
});

describe("the merged table's render", () => {
  it("draws one td for the anchor with the region's spans and no td for the covered cells", () => {
    renderTable({
      merge: ({ doc, tableId }) => doc.mergeTableCells(tableId, { row: 0, col: 0 }, { row: 1, col: 1 }),
    });
    const drawn = drawnRows();
    // The anchor's row: the region's cell + the third column's cell.
    expect(drawn[0]).toHaveLength(2);
    expect(drawn[0]![0]!.colSpan).toBe(2);
    expect(drawn[0]![0]!.rowSpan).toBe(2);
    // The covered row keeps only the third column's cell.
    expect(drawn[1]).toHaveLength(1);
    expect(drawn[2]).toHaveLength(3);
  });

  it("draws a thin region's column span only (the rowspan stands the default)", () => {
    renderTable({
      merge: ({ doc, tableId }) => doc.mergeTableCells(tableId, { row: 0, col: 0 }, { row: 0, col: 2 }),
    });
    const [first] = drawnRows();
    expect(first).toHaveLength(1);
    expect(first![0]!.colSpan).toBe(3);
    expect(first![0]!.rowSpan).toBe(1);
  });

  it("keeps the spans over the read-only mode without the editing chrome", () => {
    renderTable({
      mode: "view",
      merge: ({ doc, tableId }) => doc.mergeTableCells(tableId, { row: 0, col: 0 }, { row: 1, col: 1 }),
    });
    const [first] = drawnRows();
    expect(first![0]!.colSpan).toBe(2);
    expect(first![0]!.rowSpan).toBe(2);
    expect(document.querySelector('[data-slot="docblocks/table-col-resize"]')).toBeNull();
    expect(document.querySelector('[data-slot="docblocks/table-cell-activation"]')).toBeNull();
  });
});
