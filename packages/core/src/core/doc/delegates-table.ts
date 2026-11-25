/**
 * The Doc facade's table-block delegates: the command calls behind the
 * table row/column methods.
 */
import type * as Y from "yjs";

import type { BlockId } from "@docblocks-core/schema";

import {
  clearTableColumn as clearTableColumnCommand,
  clearTableRow as clearTableRowCommand,
  duplicateTableColumn as duplicateTableColumnCommand,
  duplicateTableRow as duplicateTableRowCommand,
  insertTableColumn as insertTableColumnCommand,
  insertTableRow as insertTableRowCommand,
  mergeTableCells as mergeTableCellsCommand,
  moveTableColumn as moveTableColumnCommand,
  moveTableRow as moveTableRowCommand,
  removeTableColumn as removeTableColumnCommand,
  removeTableRow as removeTableRowCommand,
  setTableColumnColor as setTableColumnColorCommand,
  setTableColumnWidth as setTableColumnWidthCommand,
  setTableRowColor as setTableRowColorCommand,
  splitTableCells as splitTableCellsCommand,
} from "../commands";
import type { TableGridPoint } from "../commands";

/**
 * Inserts an empty row into a table at `at` (0 = the first row, the row
 * count = the last; appended when omitted; the cells have no content
 * blocks until edited) and returns the row id.
 */
function insertTableRow(ydoc: Y.Doc, generateId: () => string, tableId: BlockId, at?: number): BlockId {
  return insertTableRowCommand(ydoc, generateId, tableId, at);
}

/** Removes a table row; the last row converts the table into a paragraph in place. */
function removeTableRow(ydoc: Y.Doc, tableId: BlockId, rowId: BlockId): void {
  removeTableRowCommand(ydoc, tableId, rowId);
}

/** Moves a table row to `toIndex` (pre-move index semantics, like moveRow). */
function moveTableRow(ydoc: Y.Doc, tableId: BlockId, rowId: BlockId, toIndex: number): void {
  moveTableRowCommand(ydoc, tableId, rowId, toIndex);
}

/** Duplicates a table row right below it (cells deep-copied) and returns the new row id. */
function duplicateTableRow(ydoc: Y.Doc, generateId: () => string, tableId: BlockId, rowId: BlockId): BlockId {
  return duplicateTableRowCommand(ydoc, generateId, tableId, rowId);
}

/** Clears the cell content of every cell in a row (the cells stay, empty). */
function clearTableRow(ydoc: Y.Doc, tableId: BlockId, rowId: BlockId): void {
  clearTableRowCommand(ydoc, tableId, rowId);
}

/** Sets (or removes, `null`) the row background color on every cell of a row. */
function setTableRowColor(ydoc: Y.Doc, tableId: BlockId, rowId: BlockId, color: string | null): void {
  setTableRowColorCommand(ydoc, tableId, rowId, color);
}

/**
 * Inserts an empty column (100 px wide) into a table at `at` (0 = the
 * first column, the column count = the last; appended when omitted);
 * `cols` and `columnWidths` stay in sync.
 */
function insertTableColumn(ydoc: Y.Doc, generateId: () => string, tableId: BlockId, at?: number): void {
  insertTableColumnCommand(ydoc, generateId, tableId, at);
}

/** Removes the table column at `index`; the last column converts the table into a paragraph in place. */
function removeTableColumn(ydoc: Y.Doc, tableId: BlockId, index: number): void {
  removeTableColumnCommand(ydoc, tableId, index);
}

/** Moves a column (cells in every row + its width entry) from `fromIndex` to `toIndex` (pre-move). */
function moveTableColumn(ydoc: Y.Doc, tableId: BlockId, fromIndex: number, toIndex: number): void {
  moveTableColumnCommand(ydoc, tableId, fromIndex, toIndex);
}

/** Duplicates the column at `index` right of it (cells deep-copied, width entry copied). */
function duplicateTableColumn(ydoc: Y.Doc, generateId: () => string, tableId: BlockId, index: number): void {
  duplicateTableColumnCommand(ydoc, generateId, tableId, index);
}

/** Clears the cell content of every cell in a column (the cells stay, empty). */
function clearTableColumn(ydoc: Y.Doc, tableId: BlockId, index: number): void {
  clearTableColumnCommand(ydoc, tableId, index);
}

/** Sets (or removes, `null`) the column background color on every cell of a column. */
function setTableColumnColor(ydoc: Y.Doc, tableId: BlockId, index: number, color: string | null): void {
  setTableColumnColorCommand(ydoc, tableId, index, color);
}

/** Sets the width of the column at `index` (>= 50; an equal-value set emits no update). */
function setTableColumnWidth(ydoc: Y.Doc, tableId: BlockId, index: number, width: number): void {
  setTableColumnWidthCommand(ydoc, tableId, index, width);
}

/**
 * Merges the rectangle between the two grid corners into its top-left cell
 * (the anchor carries the spans; the covered cells and their content are
 * gone).
 */
function mergeTableCells(ydoc: Y.Doc, tableId: BlockId, first: TableGridPoint, second: TableGridPoint): void {
  mergeTableCellsCommand(ydoc, tableId, first, second);
}

/** Splits the merged region containing the coordinate: the anchor keeps its content, the restored cells stand empty. */
function splitTableCells(ydoc: Y.Doc, generateId: () => string, tableId: BlockId, row: number, col: number): void {
  splitTableCellsCommand(ydoc, generateId, tableId, row, col);
}

export {
  clearTableColumn,
  clearTableRow,
  duplicateTableColumn,
  duplicateTableRow,
  insertTableColumn,
  insertTableRow,
  mergeTableCells,
  moveTableColumn,
  moveTableRow,
  removeTableColumn,
  removeTableRow,
  setTableColumnColor,
  setTableColumnWidth,
  setTableRowColor,
  splitTableCells,
};
