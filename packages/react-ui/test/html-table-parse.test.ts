// @vitest-environment jsdom
// The HTML table's parse (`htmlToBlocks`'s TABLE case): the grid placement of
// the browser's table model over the paste material — the even cell matrix,
// the merged regions the materialization applies as the anchor spans, and the
// deterministic degradation of malformed spans. DOMParser — the jsdom
// environment.
import { describe, expect, it } from "vitest";

import type { TextRun } from "docblocks-core";

import { htmlToBlocks } from "../src/editing/clipboard";

/** The [text, marks] pairs of a run list. */
function runsOf(runs: TextRun[]): Array<[string, TextRun["marks"]]> {
  return runs.map((run) => [run.text, run.marks]);
}

describe("the HTML table's grid placement", () => {
  it("the table → the table material (the cells' runs; the ragged rows are padded)", () => {
    const blocks = htmlToBlocks("<table><tr><td>c11 <b>c12b</b></td><td>c12</td></tr><tr><td>c21</td></tr></table>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("table");
    expect(blocks[0]!.rows).toHaveLength(2);
    expect(blocks[0]!.rows![0]!.length).toBe(2);
    expect(blocks[0]!.rows![1]!.length).toBe(2); // padded
    expect(runsOf(blocks[0]!.rows![0]![0]!)).toEqual([
      ["c11 ", {}],
      ["c12b", { bold: true }],
    ]);
    expect(blocks[0]!.rows![1]![1]).toEqual([]); // the padded cell is empty
    expect(blocks[0]!.merges).toEqual([]);
  });

  it("the colspan/rowspan cells place by the grid (the covered coordinates stand empty, the regions stand the anchor corners)", () => {
    // The grid: [A A B] / [C D B] — A spans two columns, B two rows.
    const blocks = htmlToBlocks(
      '<table><tr><td colspan="2">A</td><td rowspan="2">B</td></tr><tr><td>C</td><td>D</td></tr></table>'
    );
    expect(blocks[0]!.type).toBe("table");
    expect(blocks[0]!.attrs.cols).toBe(3);
    const texts = blocks[0]!.rows!.map((row) => row.map((cell) => cell.map((run) => run.text).join("")));
    expect(texts).toEqual([
      ["A", "", "B"],
      ["C", "D", ""],
    ]);
    expect(blocks[0]!.merges).toEqual([
      { row: 0, col: 0, colspan: 2, rowspan: 1 },
      { row: 0, col: 2, colspan: 1, rowspan: 2 },
    ]);
  });

  it("a rowspan shifts the rows' cells past the reserved columns", () => {
    // The grid: [A B] / [. C] — A spans both rows, so C stands at column 1.
    const blocks = htmlToBlocks('<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>');
    const texts = blocks[0]!.rows!.map((row) => row.map((cell) => cell.map((run) => run.text).join("")));
    expect(texts).toEqual([
      ["A", "B"],
      ["", "C"],
    ]);
    expect(blocks[0]!.merges).toEqual([{ row: 0, col: 0, colspan: 1, rowspan: 2 }]);
  });

  it("the invalid spans stand 1 (a non-integer, a zero, a negative, a non-numeric)", () => {
    const blocks = htmlToBlocks(
      '<table><tr><td colspan="0">a</td><td colspan="-2">b</td><td rowspan="x">c</td><td colspan="1.5">d</td>' +
        '<td colspan="1e3">e</td></tr></table>'
    );
    expect(blocks[0]!.rows![0]!.map((cell) => cell.map((run) => run.text).join(""))).toEqual(["a", "b", "c", "d", "e"]);
    expect(blocks[0]!.merges).toEqual([]);
  });

  it("an oversized rowspan clamps to the last row", () => {
    const blocks = htmlToBlocks('<table><tr><td rowspan="9">a</td><td>b</td></tr><tr><td>c</td></tr></table>');
    expect(blocks[0]!.rows).toHaveLength(2);
    expect(blocks[0]!.merges).toEqual([{ row: 0, col: 0, colspan: 1, rowspan: 2 }]);
  });

  it("a colspan over the grid's current width widens the table (the browser's table model)", () => {
    // The second row's colspan cell starts at column 2 (columns 0–1 are
    // reserved by the rowspans) and extends the grid to five columns.
    const blocks = htmlToBlocks(
      '<table><tr><td rowspan="2">a</td><td rowspan="2">b</td><td>c</td></tr>' +
        '<tr><td colspan="3">d</td></tr></table>'
    );
    const texts = blocks[0]!.rows!.map((row) => row.map((cell) => cell.map((run) => run.text).join("")));
    expect(texts).toEqual([
      ["a", "b", "c", "", ""],
      ["", "", "d", "", ""],
    ]);
    expect(blocks[0]!.merges).toEqual([
      { row: 0, col: 0, colspan: 1, rowspan: 2 },
      { row: 0, col: 1, colspan: 1, rowspan: 2 },
      { row: 1, col: 2, colspan: 3, rowspan: 1 },
    ]);
  });

  it("a colspan running onto a covered coordinate clamps to the free width (the overlap degrades, no throw)", () => {
    // The second row's free slot is column 1; column 2 stands covered by the
    // first row's rowspan, so the requested colspan 3 shrinks to the free
    // width.
    const blocks = htmlToBlocks(
      '<table><tr><td rowspan="2">a</td><td>b</td><td rowspan="2">c</td></tr>' +
        '<tr><td colspan="3">d</td></tr></table>'
    );
    const texts = blocks[0]!.rows!.map((row) => row.map((cell) => cell.map((run) => run.text).join("")));
    expect(texts).toEqual([
      ["a", "b", "c"],
      ["", "d", ""],
    ]);
    expect(blocks[0]!.merges).toEqual([
      { row: 0, col: 0, colspan: 1, rowspan: 2 },
      { row: 0, col: 2, colspan: 1, rowspan: 2 },
    ]);
  });
});
