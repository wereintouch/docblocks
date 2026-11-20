import { describe, expect, it } from "vitest";

import { type BlockId, type Selection, type TextRun, createDoc } from "docblocks-core";

import { clipboardContentOf, crossRangeClipboardContent, segmentOf } from "../src/editing/cross-copy";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

/** Two seeded paragraphs: block a (bold "hello " + plain "world"), block b (plain "an" + italic "other"). */
function twoBlocks(doc: TestDoc): { a: BlockId; b: BlockId } {
  const a = doc.insertBlock("paragraph");
  const b = doc.insertBlock("paragraph");
  doc.insertText(a, 0, "hello ", { bold: true });
  doc.insertText(a, 6, "world");
  doc.insertText(b, 0, "an");
  doc.insertText(b, 2, "other", { italic: true });
  return { a, b };
}

function crossSelection(a: BlockId, aOffset: number, b: BlockId, bOffset: number): Selection {
  return { kind: "text", from: { blockId: a, offset: aOffset }, to: { blockId: b, offset: bOffset }, blocks: [a, b] };
}

describe("crossRangeClipboardContent", () => {
  it("serializes the covered segments of each chain block (partial endpoints)", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const { a, b } = twoBlocks(doc);
    // (a, 6) to (b, 4): block a keeps its plain tail "world", block b is
    // cut after "an" + the first two italic letters "ot".
    const payload = crossRangeClipboardContent(doc, crossSelection(a, 6, b, 4));
    expect(payload?.text).toBe("world\nanot");
    expect(payload?.html).toBe(`<div>world</div><div>an<em>ot</em></div>`);
  });

  it("covers a fully-covered head block in full", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const { a, b } = twoBlocks(doc);
    const payload = crossRangeClipboardContent(doc, crossSelection(a, 0, b, 2));
    expect(payload?.text).toBe("hello world\nan");
    expect(payload?.html).toBe(`<div><strong>hello </strong>world</div><div>an</div>`);
  });

  it("escapes the run text and the link href", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const { a, b } = twoBlocks(doc);
    doc.unsetMark(a, 0, 6, "bold");
    doc.setMark(a, 6, 11, { type: "link", href: "https://x.dev/?a=1&b=2" });
    const payload = crossRangeClipboardContent(doc, crossSelection(a, 6, b, 2));
    expect(payload?.html).toBe(`<div><a href="https://x.dev/?a=1&amp;b=2">world</a></div><div>an</div>`);
  });

  it("escapes the mark's values over the clipboard's attributes (the hostile remote data's stand)", () => {
    // A value written over the CRDT's raw (no command's validation) stands
    // the hostile attribute break over the third-party paste target — the
    // escape closes it (the local paste re-parses through the whitelist).
    const hostile = '" onmouseover="alert(1)';
    const runs: TextRun[] = [
      { text: "world", marks: { color: { value: hostile }, highlight: { value: hostile } } },
      { text: "mention", marks: { mention: { kind: hostile, id: "u1", label: "x" } as never } },
    ];
    const { html } = segmentOf(runs, 0, 13);
    expect(html).toContain(`color: &quot; onmouseover=&quot;alert(1)`);
    expect(html).toContain(`background-color: &quot; onmouseover=&quot;alert(1)`);
    expect(html).toContain('data-mention="&quot; onmouseover=&quot;alert(1)"');
    // The unescaped quote never stands an attribute's break.
    expect(html).not.toContain(`color: " onmouseover="`);
  });

  it("keeps the default copy for same-block ranges and carets", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const { a, b } = twoBlocks(doc);
    expect(
      crossRangeClipboardContent(doc, {
        kind: "text",
        from: { blockId: a, offset: 0 },
        to: { blockId: a, offset: 3 },
        blocks: [a],
      })
    ).toBeNull();
    expect(
      crossRangeClipboardContent(doc, { kind: "text", from: { blockId: a, offset: 0 }, to: null, blocks: [a] })
    ).toBeNull();
    expect(crossRangeClipboardContent(doc, { kind: "blocks", ids: [a, b], anchorId: a })).toBeNull();
    expect(crossRangeClipboardContent(doc, { kind: "none" })).toBeNull();
  });

  it("stands an empty segment for a non-text chain block (a skipped divider)", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const { a, b } = twoBlocks(doc);
    const divider = doc.insertBlock("divider");
    // The chain order: a, divider, b (the divider stands between them).
    const selection: Selection = {
      kind: "text",
      from: { blockId: a, offset: 0 },
      to: { blockId: b, offset: 2 },
      blocks: [a, divider, b],
    };
    const payload = crossRangeClipboardContent(doc, selection);
    expect(payload?.text).toBe("hello world\n\nan");
    expect(payload?.html).toBe(`<div><strong>hello </strong>world</div><div></div><div>an</div>`);
  });
});

describe("the table's copy payload (the spreadsheet's grid)", () => {
  interface TableDoc {
    before: BlockId;
    after: BlockId;
    tableId: BlockId;
    cells: BlockId[][];
    chain: BlockId[];
  }

  /** A 2×2 table between two paragraphs (the cells' texts r{row}c{col}). */
  function tableDoc(doc: TestDoc, cellText?: (row: number, col: number) => string): TableDoc {
    const before = doc.insertBlock("paragraph");
    doc.insertText(before, 0, "before");
    const tableId = doc.insertBlock("table", { cols: 2, columnWidths: [100, 100] });
    const cells: BlockId[][] = [];
    for (let row = 0; row < 2; row += 1) {
      const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
      const rowCells: BlockId[] = [];
      for (let col = 0; col < 2; col += 1) {
        const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
        const paragraph = doc.insertBlock("paragraph", undefined, { parent: cellId });
        doc.insertText(paragraph, 0, cellText === undefined ? `r${row}c${col}` : cellText(row, col));
        rowCells.push(cellId);
      }
      cells.push(rowCells);
    }
    const after = doc.insertBlock("paragraph");
    doc.insertText(after, 0, "after");
    // The reading-order chain between "before" and "after" (the core's DFS).
    const order: BlockId[] = [];
    const visit = (id: BlockId): void => {
      order.push(id);
      for (const child of doc.getChildren(id)) visit(child);
    };
    visit(doc.meta.id);
    const chain = order.slice(order.indexOf(before), order.indexOf(after) + 1);
    return { before, after, tableId, cells, chain };
  }

  /** The cell's first text block (the paragraph carrying the cell's text). */
  function cellParagraph(doc: TestDoc, cellId: BlockId): BlockId {
    return doc.getChildren(cellId)[0]!;
  }

  it("stands a range spanning the table as one grid — the cells' rows over the TSV and the `<table>`", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const { before, after, chain } = tableDoc(doc);
    const payload = crossRangeClipboardContent(doc, {
      kind: "text",
      from: { blockId: before, offset: 0 },
      to: { blockId: after, offset: 5 },
      blocks: chain,
    });
    expect(payload?.text).toBe("before\nr0c0\tr0c1\nr1c0\tr1c1\nafter");
    expect(payload?.html).toBe(
      `<div>before</div><table><tbody><tr><td>r0c0</td><td>r0c1</td></tr><tr><td>r1c0</td><td>r1c1</td></tr></tbody></table><div>after</div>`
    );
  });

  it("stands a range inside the table as the grid of the covered cells (the table block is outside the chain)", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const { cells } = tableDoc(doc);
    const fromId = cellParagraph(doc, cells[0]![0]!);
    const toId = cellParagraph(doc, cells[0]![1]!);
    // The chain of a cell-to-cell rectangle: the cell's paragraph, the
    // next cell, its paragraph (the table block stands before the chain).
    const payload = crossRangeClipboardContent(doc, {
      kind: "text",
      from: { blockId: fromId, offset: 0 },
      to: { blockId: toId, offset: 4 },
      blocks: [fromId, cells[0]![1]!, toId],
    });
    expect(payload?.text).toBe("r0c0\tr0c1");
    expect(payload?.html).toBe(`<table><tbody><tr><td>r0c0</td><td>r0c1</td></tr></tbody></table>`);
  });

  it("stands the blocks selection of a table as the whole grid (the cells' own blocks make no lines)", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const { tableId } = tableDoc(doc);
    // The mapping's blocks selection carries the touched elements' ids: the
    // table, its rows, the cells, and the cells' paragraphs.
    const ids: BlockId[] = [tableId, ...doc.getChildren(tableId)];
    const payload = clipboardContentOf(doc, { kind: "blocks", ids, anchorId: tableId });
    expect(payload?.text).toBe("r0c0\tr0c1\nr1c0\tr1c1");
    expect(payload?.html).toBe(
      `<table><tbody><tr><td>r0c0</td><td>r0c1</td></tr><tr><td>r1c0</td><td>r1c1</td></tr></tbody></table>`
    );
  });

  it("keeps a cell's embedded line breaks as `<br>` and collapses them to a space over the TSV", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const { tableId } = tableDoc(doc, (row, col) => (row === 0 && col === 0 ? "one\ntwo" : "three"));
    const grid = clipboardContentOf(doc, { kind: "blocks", ids: [tableId], anchorId: tableId });
    expect(grid?.html).toContain("<td>one<br>two</td>");
    // The rows: "one two" + the second cell "three" (the newline collapsed).
    expect(grid?.text.split("\n")[0]).toBe("one two\tthree");
  });
});
