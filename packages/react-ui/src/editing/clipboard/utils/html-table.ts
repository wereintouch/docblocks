/**
 * The HTML table's grid placement over the paste material: the browser's own
 * table model — a cell stands at the first free column of its row, its
 * `rowspan` reserves the coordinates below, and a span that would run onto an
 * occupied coordinate, past the last row, or past the grid's width ceiling is
 * clamped to the free space. The result is the even cell matrix over the grid
 * plus the merged regions, which the materialization applies as the model's
 * anchor spans.
 *
 * A row without cells stands no row (nothing to place). The placement never
 * throws on malformed markup: an overlap, an oversized span, or a hostile
 * span attribute degrades to the span the grid fits, so the material's regions
 * are always valid for the model and the materialized table stays
 * proportional to the payload's own cells.
 */
import type { TextRun } from "docblocks-core";

import type { TableMergeRect } from "../models";
import { runsOf } from "./html-inline";

/** The grid's width ceiling: the per-cell spans never grow it past this. */
const TABLE_COLUMNS_MAX = 100;

/** The grid's coordinate budget: a taller table stands fewer columns (rows x cols). */
const TABLE_CELLS_MAX = 10_000;

/** The parsed table: the even cell matrix + the merged regions' rectangles. */
interface HtmlTableGrid {
  rows: TextRun[][][];
  merges: TableMergeRect[];
}

/** The cell's runs and the spans its markup asks for. */
interface TableCellInput {
  runs: TextRun[];
  colspan: number;
  rowspan: number;
}

/** The placed anchor: the grid corner, the effective spans, and the cell's runs. */
interface TableAnchor extends TableMergeRect {
  runs: TextRun[];
}

/** The span attribute's value: a non-negative integer >= 1, otherwise 1 (the invalid forms' stand). */
function spanAttrOf(cell: Element, name: "colspan" | "rowspan"): number {
  const raw = (cell.getAttribute(name) ?? "").trim();
  const value = /^\d+$/.test(raw) ? Number(raw) : 0;
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

/** The row's `td`/`th` cells (everything else in a row is not a cell). */
function cellInputsOf(row: Element): TableCellInput[] {
  const cells: TableCellInput[] = [];
  for (const cell of Array.from(row.children)) {
    const tag = cell.nodeName.toUpperCase();
    if (tag !== "TD" && tag !== "TH") continue;
    cells.push({
      runs: runsOf(cell, {}, false),
      colspan: spanAttrOf(cell, "colspan"),
      rowspan: spanAttrOf(cell, "rowspan"),
    });
  }
  return cells;
}

/**
 * Places the parsed rows over the grid: the anchors take the first free
 * column of their row, the effective spans grow over the free coordinates
 * only (within the table's column budget), and the covered coordinates are
 * marked. The matrix is padded to the grid's width; the regions a single-cell
 * anchor does not need are dropped.
 */
function tableGridOf(rowElements: readonly Element[]): HtmlTableGrid | null {
  const inputs = rowElements.map(cellInputsOf).filter((cells) => cells.length > 0);
  const rowCount = inputs.length;
  if (rowCount === 0) return null;
  const columnBudget = Math.max(1, Math.min(TABLE_COLUMNS_MAX, Math.floor(TABLE_CELLS_MAX / rowCount)));

  const occupied: boolean[][] = [];
  const isOccupied = (row: number, col: number): boolean => occupied[row]?.[col] === true;
  const markCovered = (row: number, col: number): void => {
    while (occupied.length <= row) occupied.push([]);
    const line = occupied[row]!;
    while (line.length <= col) line.push(false);
    line[col] = true;
  };

  const anchors: TableAnchor[] = [];
  inputs.forEach((cells, row) => {
    for (const cell of cells) {
      let col = 0;
      while (isOccupied(row, col)) col += 1;
      let colspan = 1;
      while (colspan < cell.colspan && col + colspan < columnBudget && !isOccupied(row, col + colspan)) colspan += 1;
      // A row span never adds rows: the table's row count is the rows' own.
      let rowspan = 1;
      while (rowspan < cell.rowspan && row + rowspan < rowCount) {
        let free = true;
        for (let c = 0; c < colspan; c += 1) {
          if (isOccupied(row + rowspan, col + c)) {
            free = false;
            break;
          }
        }
        if (!free) break;
        rowspan += 1;
      }
      for (let r = row; r < row + rowspan; r += 1) {
        for (let c = col; c < col + colspan; c += 1) markCovered(r, c);
      }
      anchors.push({ row, col, colspan, rowspan, runs: cell.runs });
    }
  });

  const cols = Math.max(...occupied.map((line) => line.length));
  const rows: TextRun[][][] = inputs.map(() => Array.from({ length: cols }, (): TextRun[] => []));
  for (const anchor of anchors) rows[anchor.row]![anchor.col] = anchor.runs;
  const merges = anchors
    .filter((anchor) => anchor.colspan > 1 || anchor.rowspan > 1)
    .map(({ row, col, colspan, rowspan }): TableMergeRect => ({ row, col, colspan, rowspan }));
  return { rows, merges };
}

export { tableGridOf };
export type { HtmlTableGrid };
