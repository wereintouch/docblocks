/**
 * Table row commands: insertTableRow, removeTableRow, moveTableRow,
 * duplicateTableRow, clearTableRow, setTableRowColor. Rows and cells are
 * blocks (unlike the database's data rows), so the commands compose the
 * layout primitives inside one local transaction: one command is one update
 * and one undo step.
 *
 * Removing the LAST row converts the table into a plain paragraph in place
 * (the children are gone by then; the indent attr stands).
 */
import * as Y from "yjs";

import { DetachedBlockError, InvalidOperationError, InvalidRangeError } from "../../errors";
import { localTransact, writeBlock } from "../../layout";
import { removeBlock } from "../blocks";
import { getBlockMap, getBlocks, readCols } from "../structure";
import {
  assertCellColor,
  assertInsertIndex,
  cellsOf,
  clearBlockChildren,
  convertToParagraph,
  readCellColor,
  rowOf,
  rowsOf,
  setCellColor,
  snapshotSubtree,
  tableOf,
  writeSubtreeCopy,
} from "./common";

/**
 * Inserts an empty row (cells without content blocks — an empty cell has
 * no data until a paragraph is placed in it) at `at` (0 = the first row,
 * the row count = the last; appended when omitted) and returns the row id.
 * The new cells inherit the column colors (a column's color stands on every
 * cell of the column — an uncolored new cell would break the column's
 * band).
 */
function insertTableRow(ydoc: Y.Doc, generateId: () => string, tableId: string, at?: number): string {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const cols = readCols(ydoc, tableId);
  if (cols === null) {
    throw new InvalidOperationError(`Table "${tableId}" has no valid "cols" attribute.`);
  }
  const rowCount = rows.length;
  if (at !== undefined) assertInsertIndex(at, rowCount, "Row");
  const index = at ?? rowCount;
  const rowId = generateId();
  const cellIds = Array.from({ length: cols }, () => generateId());
  localTransact(ydoc, () => {
    const blocks = getBlocks(ydoc);
    const existingRows = rows.toArray();
    const columnColors: (string | null)[] = [];
    for (let ci = 0; ci < cols; ci++) {
      let color: string | null = null;
      for (const rowId of existingRows) {
        const row = getBlockMap(ydoc, rowId);
        const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : undefined;
        const cellId = cells instanceof Y.Array ? cells.get(ci) : undefined;
        if (cellId === undefined) continue;
        color = readCellColor(ydoc, cellId, "columnColor");
        if (color !== null) break;
      }
      columnColors.push(color);
    }
    cellIds.forEach((cellId, ci) => {
      writeBlock(blocks, cellId, { type: "table-cell" });
      const color = columnColors[ci]!;
      if (color !== null) setCellColor(ydoc, cellId, "columnColor", color);
    });
    writeBlock(blocks, rowId, { type: "table-row", children: cellIds });
    rows.insert(index, [rowId]);
  });
  return rowId;
}

/**
 * Removes a row and its cells. The LAST row converts the table into a
 * plain paragraph (the block id and the indent stand).
 */
function removeTableRow(ydoc: Y.Doc, tableId: string, rowId: string): void {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const rowIds = rows.toArray();
  const index = rowIds.indexOf(rowId);
  if (index === -1) throw new DetachedBlockError(`Row "${rowId}" is not a child of table "${tableId}".`);
  localTransact(ydoc, () => {
    removeBlock(ydoc, rowId);
    if (rowsOf(table, tableId).toArray().length === 0) convertToParagraph(ydoc, tableId);
  });
}

/**
 * Moves a row to `toIndex` (pre-move index semantics, like moveRow):
 * `toIndex` is the index in the PRE-move order; the end index appends.
 */
function moveTableRow(ydoc: Y.Doc, tableId: string, rowId: string, toIndex: number): void {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const ids = rows.toArray();
  const fromIndex = ids.indexOf(rowId);
  if (fromIndex === -1) throw new DetachedBlockError(`Row "${rowId}" is not a child of table "${tableId}".`);
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > ids.length) {
    throw new InvalidRangeError(`toIndex must be an integer in [0, ${ids.length}] (got ${toIndex}).`);
  }
  localTransact(ydoc, () => {
    rows.delete(fromIndex, 1);
    // Pre-move indices: the removal shifts a later target left by one.
    const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
    rows.insert(insertAt, [rowId]);
  });
}

/**
 * Duplicates a row right below it: the cells are deep-copied (the child
 * paragraphs with their runs and attrs, the cell attrs incl. the colors).
 * Returns the new row id.
 */
function duplicateTableRow(ydoc: Y.Doc, generateId: () => string, tableId: string, rowId: string): string {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const rowIds = rows.toArray();
  const fromIndex = rowIds.indexOf(rowId);
  if (fromIndex === -1) throw new DetachedBlockError(`Row "${rowId}" is not a child of table "${tableId}".`);
  const snap = snapshotSubtree(ydoc, generateId, rowId);
  let newRowId = "";
  localTransact(ydoc, () => {
    newRowId = writeSubtreeCopy(ydoc, snap);
    rows.insert(fromIndex + 1, [newRowId]);
  });
  return newRowId;
}

/** Clears the cell content of every cell in a row (the cells stay, empty). */
function clearTableRow(ydoc: Y.Doc, tableId: string, rowId: string): void {
  const table = tableOf(ydoc, tableId);
  const row = rowOf(ydoc, tableId, table, rowId);
  const cellIds = cellsOf(row, tableId, rowId).toArray();
  localTransact(ydoc, () => {
    for (const cellId of cellIds) clearBlockChildren(ydoc, cellId);
  });
}

/** Sets (or removes, `null`) the row color on every cell of a row. */
function setTableRowColor(ydoc: Y.Doc, tableId: string, rowId: string, color: string | null): void {
  const table = tableOf(ydoc, tableId);
  const row = rowOf(ydoc, tableId, table, rowId);
  const cellIds = cellsOf(row, tableId, rowId).toArray();
  if (color !== null) assertCellColor("rowColor", color, tableId);
  localTransact(ydoc, () => {
    for (const cellId of cellIds) setCellColor(ydoc, cellId, "rowColor", color);
  });
}

export { clearTableRow, duplicateTableRow, insertTableRow, moveTableRow, removeTableRow, setTableRowColor };
