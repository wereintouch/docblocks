/**
 * Table column commands: insertTableColumn, removeTableColumn,
 * moveTableColumn, duplicateTableColumn, clearTableColumn,
 * setTableColumnColor, setTableColumnWidth.
 *
 * Column identity: `columnWidths` and the per-cell colors follow the
 * column (a move reorders the entries, a duplicate copies them), so a
 * reordered column keeps its width and colors.
 *
 * Removing the LAST column converts the table into a plain paragraph in
 * place (the block id and the indent stand).
 */
import * as Y from "yjs";

import { InvalidOperationError, InvalidRangeError } from "../../errors";
import { localTransact, writeBlock } from "../../layout";
import { getBlockMap, getBlocks, readCols } from "../structure";
import {
  DEFAULT_TABLE_COLUMN_WIDTH,
  assertCellColor,
  assertIndex,
  assertInsertIndex,
  assertWidth,
  clearBlockChildren,
  collectSubtree,
  convertToParagraph,
  readCellColor,
  readWidths,
  rowsOf,
  setCellColor,
  snapshotSubtree,
  tableOf,
  widthsArray,
  writeCols,
  writeSubtreeCopy,
  writeWidths,
} from "./common";

/**
 * Inserts an empty column (100 px wide, cells without content blocks)
 * at `at` (0 = the first column, the column count = the last; appended
 * when omitted) and keeps `cols` and `columnWidths` in sync. The new
 * cells inherit the row colors (a row's color stands on every cell of the
 * row — an uncolored new cell would break the row's band).
 */
function insertTableColumn(ydoc: Y.Doc, generateId: () => string, tableId: string, at?: number): void {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const cols = readCols(ydoc, tableId);
  if (cols === null) throw new InvalidOperationError(`Table "${tableId}" has no valid "cols" attribute.`);
  if (at !== undefined) assertInsertIndex(at, cols, "Column");
  const index = at ?? cols;
  const rowIds = rows.toArray();
  const cellIds = rowIds.map(() => generateId());
  localTransact(ydoc, () => {
    const blocks = getBlocks(ydoc);
    rowIds.forEach((rowId, i) => {
      const row = getBlockMap(ydoc, rowId);
      const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : undefined;
      if (row === null || !(cells instanceof Y.Array)) {
        throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence.`);
      }
      const cellId = cellIds[i]!;
      writeBlock(blocks, cellId, { type: "table-cell" });
      for (const existingId of cells.toArray()) {
        const color = readCellColor(ydoc, existingId, "rowColor");
        if (color !== null) {
          setCellColor(ydoc, cellId, "rowColor", color);
          break;
        }
      }
      cells.insert(index, [cellId]);
    });
    writeCols(table, cols + 1);
    // Element-level insert: the width follows the column position. When the
    // array is absent it materializes as all defaults (value set).
    const live = widthsArray(table);
    if (live !== null) live.insert(index, [DEFAULT_TABLE_COLUMN_WIDTH]);
    else {
      const current = Array.from({ length: cols }, () => DEFAULT_TABLE_COLUMN_WIDTH);
      current.splice(index, 0, DEFAULT_TABLE_COLUMN_WIDTH);
      writeWidths(table, current);
    }
  });
}

/**
 * Removes the column at `index` (the cells and their content, in every
 * row). The LAST column converts the table into a plain paragraph (the
 * block id and the indent stand).
 */
function removeTableColumn(ydoc: Y.Doc, tableId: string, index: number): void {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const cols = readCols(ydoc, tableId);
  if (cols === null) throw new InvalidOperationError(`Table "${tableId}" has no valid "cols" attribute.`);
  assertIndex(index, cols, "Column");
  const rowIds = rows.toArray();
  localTransact(ydoc, () => {
    const blocks = getBlocks(ydoc);
    for (const rowId of rowIds) {
      const row = getBlockMap(ydoc, rowId);
      const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : undefined;
      if (row === null || !(cells instanceof Y.Array)) {
        throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence.`);
      }
      const cellId = cells.toArray()[index]!;
      for (const id of collectSubtree(ydoc, cellId)) blocks.delete(id);
      cells.delete(index, 1);
    }
    if (cols === 1) {
      // The last column: the rows are gone — convert the table in place.
      for (const rowId of rowIds) blocks.delete(rowId);
      rows.delete(0, rows.length);
      convertToParagraph(ydoc, tableId);
    } else {
      writeCols(table, cols - 1);
      const live = widthsArray(table);
      if (live !== null) live.delete(index, 1);
    }
  });
}

/**
 * Moves the column from `fromIndex` to `toIndex` (pre-move index
 * semantics, like moveRow): the cells of EVERY row move together with the
 * width entry (the colors ride the cells).
 */
function moveTableColumn(ydoc: Y.Doc, tableId: string, fromIndex: number, toIndex: number): void {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const cols = readCols(ydoc, tableId);
  if (cols === null) throw new InvalidOperationError(`Table "${tableId}" has no valid "cols" attribute.`);
  assertIndex(fromIndex, cols, "Column");
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > cols) {
    throw new InvalidRangeError(`toIndex must be an integer in [0, ${cols}] (got ${toIndex}).`);
  }
  const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
  const rowIds = rows.toArray();
  localTransact(ydoc, () => {
    for (const rowId of rowIds) {
      const row = getBlockMap(ydoc, rowId);
      const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : undefined;
      if (row === null || !(cells instanceof Y.Array)) {
        throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence.`);
      }
      const cellId = cells.toArray()[fromIndex]!;
      cells.delete(fromIndex, 1);
      cells.insert(insertAt, [cellId]);
    }
    // The width entry follows the column (element-level move).
    const live = widthsArray(table);
    if (live !== null) {
      const width = live.toArray()[fromIndex];
      live.delete(fromIndex, 1);
      live.insert(insertAt, [width]);
    }
  });
}

/**
 * Duplicates the column at `index` right of it: the cells are deep-copied
 * (content + colors) and the width entry is copied; `cols` grows.
 */
function duplicateTableColumn(ydoc: Y.Doc, generateId: () => string, tableId: string, index: number): void {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const cols = readCols(ydoc, tableId);
  if (cols === null) throw new InvalidOperationError(`Table "${tableId}" has no valid "cols" attribute.`);
  assertIndex(index, cols, "Column");
  const rowIds = rows.toArray();
  const snaps = rowIds.map((rowId) => {
    const row = getBlockMap(ydoc, rowId);
    const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : null;
    if (row === null || cells === null || !(cells instanceof Y.Array)) {
      throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence.`);
    }
    return snapshotSubtree(ydoc, generateId, cells.toArray()[index]!);
  });
  const width = readWidths(table)?.[index] ?? DEFAULT_TABLE_COLUMN_WIDTH;
  localTransact(ydoc, () => {
    rowIds.forEach((rowId, i) => {
      const row = getBlockMap(ydoc, rowId);
      const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : undefined;
      if (row === null || !(cells instanceof Y.Array)) {
        throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence.`);
      }
      cells.insert(index + 1, [writeSubtreeCopy(ydoc, snaps[i]!)]);
    });
    writeCols(table, cols + 1);
    // The width entry is copied (element-level insert; absent array
    // materializes as all defaults).
    const live = widthsArray(table);
    if (live !== null) {
      live.insert(index + 1, [width]);
    } else {
      const widths = Array.from({ length: cols }, () => DEFAULT_TABLE_COLUMN_WIDTH);
      widths.splice(index + 1, 0, width);
      writeWidths(table, widths);
    }
  });
}

/** The cell id of the column at `index` in every row; typed error on a corrupt row. */
function columnCellIds(ydoc: Y.Doc, table: Y.Map<unknown>, tableId: string, index: number): string[] {
  const cellIds: string[] = [];
  for (const rowId of rowsOf(table, tableId).toArray()) {
    const row = getBlockMap(ydoc, rowId);
    const cells = row !== null ? row.get("children") : null;
    if (row === null || !(cells instanceof Y.Array)) {
      throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence (corrupt layout).`);
    }
    const cellId = (cells as Y.Array<string>).toArray()[index];
    if (cellId === undefined) {
      throw new InvalidOperationError(
        `Row "${rowId}" of table "${tableId}" has fewer than ${index + 1} cell(s) (corrupt layout).`
      );
    }
    cellIds.push(cellId);
  }
  return cellIds;
}

/** Clears the cell content of every cell in a column (the cells stay, empty). */
function clearTableColumn(ydoc: Y.Doc, tableId: string, index: number): void {
  const table = tableOf(ydoc, tableId);
  const cols = readCols(ydoc, tableId);
  if (cols === null) throw new InvalidOperationError(`Table "${tableId}" has no valid "cols" attribute.`);
  assertIndex(index, cols, "Column");
  const cellIds = columnCellIds(ydoc, table, tableId, index);
  localTransact(ydoc, () => {
    for (const cellId of cellIds) clearBlockChildren(ydoc, cellId);
  });
}

/** Sets (or removes, `null`) the column color on every cell of a column. */
function setTableColumnColor(ydoc: Y.Doc, tableId: string, index: number, color: string | null): void {
  const table = tableOf(ydoc, tableId);
  const cols = readCols(ydoc, tableId);
  if (cols === null) throw new InvalidOperationError(`Table "${tableId}" has no valid "cols" attribute.`);
  assertIndex(index, cols, "Column");
  if (color !== null) assertCellColor("columnColor", color, tableId);
  const cellIds = columnCellIds(ydoc, table, tableId, index);
  localTransact(ydoc, () => {
    for (const cellId of cellIds) setCellColor(ydoc, cellId, "columnColor", color);
  });
}

/**
 * Sets the width of the column at `index` (>= 50; no silent clamp). An
 * absent `columnWidths` starts as all defaults (only the changed entry
 * stands non-default). An equal-value set is a zero-byte no-op: the
 * comparison runs BEFORE the transaction (a transaction always stamps
 * meta.updatedAt, so the no-op must skip the transaction, not the write).
 */
function setTableColumnWidth(ydoc: Y.Doc, tableId: string, index: number, width: number): void {
  const table = tableOf(ydoc, tableId);
  const cols = readCols(ydoc, tableId);
  if (cols === null) throw new InvalidOperationError(`Table "${tableId}" has no valid "cols" attribute.`);
  assertIndex(index, cols, "Column");
  assertWidth(width, tableId);
  const current = readWidths(table) ?? Array.from({ length: cols }, () => DEFAULT_TABLE_COLUMN_WIDTH);
  if (current[index] === width) return;
  const live = widthsArray(table);
  localTransact(ydoc, () => {
    if (live !== null) {
      // Y.Array has no element set: replace via delete + insert.
      live.delete(index, 1);
      live.insert(index, [width]);
    } else {
      const widths = current.slice();
      widths[index] = width;
      writeWidths(table, widths);
    }
  });
}

export {
  clearTableColumn,
  duplicateTableColumn,
  insertTableColumn,
  moveTableColumn,
  removeTableColumn,
  setTableColumnColor,
  setTableColumnWidth,
};
