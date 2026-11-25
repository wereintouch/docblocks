// @vitest-environment jsdom
// The HTML table's merged cells over the two import paths — the headless
// `importDocument` (kind `html`) and the rich paste (the same parser): the
// `colspan`/`rowspan` markup lands as the data model's merged regions (the
// anchor cell carries the spans, the covered cells are absent from their
// rows), and a malformed span degrades to the grid the table fits without
// throwing. The HTML parse needs the DOM (`DOMParser` over jsdom).
import { describe, expect, it } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";
import type { Doc } from "docblocks-core";

import { applyRichPaste } from "../src/editing/clipboard";
import { importDocument } from "../src/index";

const CREATED_AT = "2026-01-01T00:00:00.000Z";

/** The MERGED HTML table: A spans two columns, B two rows (the 3 × 2 grid). */
const MERGED_TABLE =
  '<table><tr><td colspan="2">A</td><td rowspan="2">B</td></tr><tr><td>C</td><td>D</td></tr></table>';

/** The fresh doc: the empty root, the deterministic ids (the counter). */
function freshDoc(): Doc {
  let n = 0;
  return createDoc({
    id: "doc1",
    title: "",
    createdAt: CREATED_AT,
    generateId: () => `b${String(++n).padStart(3, "0")}`,
  });
}

/** The block ids of the given type (the doc's insertion order). */
function idsOfType(doc: Doc, type: string): string[] {
  return Object.keys(doc.toJSON().blocks).filter((id) => doc.getBlock(id)?.type === type);
}

/** The [text, attrs] view of a table's grid: the rows' cells over the column bindings. */
function gridOf(doc: Doc, tableId: string): Array<Array<[string, Record<string, unknown>]>> {
  return doc.getChildren(tableId).map((rowId) =>
    doc.getChildren(rowId).map((cellId): [string, Record<string, unknown>] => {
      const block = doc.getBlock(cellId);
      const attrs: Record<string, unknown> = block !== null && block.type === "table-cell" ? { ...block.attrs } : {};
      const text = doc
        .getChildren(cellId)
        .map((paraId) => doc.getText(paraId))
        .join("");
      return [text, attrs];
    })
  );
}

describe("the merged table's import (the headless kind `html`)", () => {
  it("lands the regions as the anchor spans over the absent covered cells", () => {
    const doc = freshDoc();
    importDocument(doc, MERGED_TABLE, "html");

    const [tableId] = idsOfType(doc, "table");
    expect(tableId).toBeDefined();
    const table = doc.getBlock(tableId!) as { columnOrder: string[] };
    expect(table.columnOrder).toHaveLength(3);

    const rows = doc.getChildren(tableId!);
    expect(rows).toHaveLength(2);
    // The first row: the colspan anchor + the rowspan anchor — the covered
    // column's cell stands absent.
    expect(doc.getChildren(rows[0]!)).toHaveLength(2);
    // The second row: the two single cells — the rowspan-covered column's
    // cell stands absent.
    expect(doc.getChildren(rows[1]!)).toHaveLength(2);

    const grid = gridOf(doc, tableId!);
    expect(grid[0]![0]![0]).toBe("A");
    expect(grid[0]![0]![1]).toMatchObject({ colspan: 2 });
    expect(grid[0]![0]![1]).not.toHaveProperty("rowspan");
    expect(grid[0]![1]![0]).toBe("B");
    expect(grid[0]![1]![1]).toMatchObject({ rowspan: 2 });
    expect(grid[1]![0]![0]).toBe("C");
    expect(grid[1]![1]![0]).toBe("D");
    for (const cell of [grid[1]![0]!, grid[1]![1]!]) {
      expect(cell[1]).not.toHaveProperty("colspan");
      expect(cell[1]).not.toHaveProperty("rowspan");
    }
    // The imported snapshot stands valid: the regions fit the grid, the
    // column bindings place every cell.
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("the cell bindings keep the grid columns (a rowspan-covered column shifts the row)", () => {
    const doc = freshDoc();
    importDocument(doc, '<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>', "html");
    const [tableId] = idsOfType(doc, "table");
    const table = doc.getBlock(tableId!) as { columnOrder: string[] };
    const grid = gridOf(doc, tableId!);
    // C stands in the second column — the first stands covered by A.
    expect(grid[1]).toHaveLength(1);
    expect(grid[1]![0]![1]).toMatchObject({ columnId: table.columnOrder[1] });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("the malformed spans degrade deterministically (the same source stands the same doc)", () => {
    const malformed =
      '<table><tr><td rowspan="2">a</td><td>b</td><td rowspan="2">c</td></tr>' +
      '<tr><td colspan="9">d</td></tr></table>';
    const first = freshDoc();
    const second = freshDoc();
    importDocument(first, malformed, "html");
    importDocument(second, malformed, "html");
    expect(first.toJSON()).toEqual(second.toJSON());
    const [tableId] = idsOfType(first, "table");
    expect(tableId).toBeDefined();
    const row = gridOf(first, tableId!)[1]!;
    // d stands one column wide (its colspan ran onto the covered column).
    expect(row.map((cell) => cell[0])).toEqual(["d"]);
    expect(row[0]![1]).not.toHaveProperty("colspan");
    expect(row[0]![1]).not.toHaveProperty("rowspan");
    expect(validateDoc(first.toJSON())).toEqual([]);
  });

  it("a cell spanning both ways stands one anchor over its 2 x 2 region", () => {
    const doc = freshDoc();
    importDocument(
      doc,
      '<table><tr><td colspan="2" rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>',
      "html"
    );
    const [tableId] = idsOfType(doc, "table");
    const grid = gridOf(doc, tableId!);
    expect(grid[0]).toHaveLength(2);
    expect(grid[0]![0]).toEqual(["A", expect.objectContaining({ colspan: 2, rowspan: 2 })]);
    expect(grid[0]![1]![0]).toBe("B");
    // C stands in the third column: the first two stand covered.
    expect(grid[1]).toHaveLength(1);
    expect(grid[1]![0]![0]).toBe("C");
    const columnOrder = (doc.getBlock(tableId!) as { columnOrder: string[] }).columnOrder;
    expect(grid[1]![0]![1]).toMatchObject({ columnId: columnOrder[2] });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("a hostile span attribute stands the grid's width ceiling (no unbounded materialization)", () => {
    const doc = freshDoc();
    importDocument(doc, '<table><tr><td colspan="100000">wide</td></tr></table>', "html");
    const [tableId] = idsOfType(doc, "table");
    const columnOrder = (doc.getBlock(tableId!) as { columnOrder: string[] }).columnOrder;
    expect(columnOrder.length).toBeLessThanOrEqual(100);
    const grid = gridOf(doc, tableId!);
    expect(grid[0]).toHaveLength(1);
    expect(grid[0]![0]).toEqual(["wide", expect.objectContaining({ colspan: columnOrder.length })]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("a tall table stands fewer columns (the grid's coordinate budget)", () => {
    const doc = freshDoc();
    const rows = 250;
    const row = '<tr><td colspan="1000">x</td></tr>';
    importDocument(doc, `<table>${row.repeat(rows)}</table>`, "html");
    const [tableId] = idsOfType(doc, "table");
    const columnOrder = (doc.getBlock(tableId!) as { columnOrder: string[] }).columnOrder;
    // The grid's area stays inside the budget however wide the markup asks
    // to be: the rows stand, the spans shrink.
    expect(rows * columnOrder.length).toBeLessThanOrEqual(10_000);
    expect(doc.getChildren(tableId!)).toHaveLength(rows);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("the whole import is one undo step (one transaction)", () => {
    const doc = freshDoc();
    importDocument(doc, MERGED_TABLE, "html");
    expect(doc.getChildren(doc.meta.id)).toHaveLength(1);
    doc.undo();
    expect(doc.getChildren(doc.meta.id)).toEqual([]);
    doc.redo();
    expect(idsOfType(doc, "table")).toHaveLength(1);
  });
});

describe("the merged table's rich paste (the shared parser)", () => {
  it("keeps the regions over the materialized table", () => {
    const doc = freshDoc();
    const paragraphId = doc.insertBlock("paragraph", undefined, { parent: doc.meta.id });
    doc.insertText(paragraphId, 0, "before");

    applyRichPaste(doc, paragraphId, 6, 6, MERGED_TABLE);

    // The paste lands after the caret block (the trailing paragraph guards
    // the non-text landing).
    const sequence = doc.getChildren(doc.meta.id);
    expect(sequence[0]).toBe(paragraphId);
    const [tableId] = idsOfType(doc, "table");
    expect(sequence[1]).toBe(tableId);
    expect(doc.getBlock(sequence[2]!)).toMatchObject({ type: "paragraph" });

    const grid = gridOf(doc, tableId!);
    expect(grid[0]![0]).toEqual(["A", expect.objectContaining({ colspan: 2 })]);
    expect(grid[0]![1]).toEqual(["B", expect.objectContaining({ rowspan: 2 })]);
    expect(grid[1]!.map((cell) => cell[0])).toEqual(["C", "D"]);
    expect(doc.getChildren(doc.getChildren(tableId!)[0]!)).toHaveLength(2);
    expect(doc.getChildren(doc.getChildren(tableId!)[1]!)).toHaveLength(2);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("the demotion over a cell parent drops the covered coordinates from the text", () => {
    const doc = freshDoc();
    const tableId = doc.insertBlock("table", { cols: 1 }, { parent: doc.meta.id });
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
    const paragraphId = doc.insertBlock("paragraph", undefined, { parent: cellId });

    // A cell parent takes no table: the paste degrades to one paragraph per
    // row — the merged regions' covered coordinates stand no separator.
    applyRichPaste(doc, paragraphId, 0, 0, MERGED_TABLE);

    expect(doc.getChildren(cellId).map((id) => doc.getText(id))).toEqual(["A | B", "C | D"]);
  });
});
