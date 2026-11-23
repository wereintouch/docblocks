/**
 * Table column commands: insertTableColumn, removeTableColumn,
 * moveTableColumn. The cell-fan-out commands (duplicateTableColumn,
 * clearTableColumn, setTableColumnColor, setTableColumnWidth) and the
 * cell-mechanics helpers stand in column-cells (re-exported from here).
 *
 * Column identity: the table's `columnOrder` (a shared CRDT array of column
 * ids) is the single source of the column set — the column count is
 * `columnOrder.length`, never a scalar counter. Each cell carries a
 * `columnId` binding it to a column; the cells of a row stand in
 * `columnOrder` order (the cell at position i ↔ `columnOrder[i]`), so the
 * per-cell colors ride the column through an insert/remove/move/duplicate.
 *
 * Column widths are stored identity-keyed (`attrs.columnWidths` is a Y.Map
 * of columnId → width — an element-level LWW op per column), so a
 * concurrent move + width set of one column converge per key (a positional
 * array's element ops would not). The positional `columnWidths` array in
 * the JSON is derived from this map at read time (an absent key stands the
 * default width), which is why these commands never move or reorder width
 * entries — the width follows its column's id.
 *
 * Removing the LAST column converts the table into a plain paragraph in
 * place (the block id and the indent stand).
 */
import * as Y from "yjs";

import { InvalidOperationError, InvalidRangeError } from "../../errors";
import { localTransact, writeBlock } from "../../layout";
import { getBlockMap, getBlocks } from "../structure";
import { columnCellOfRow, readColumnIdOf } from "./column-cells";
import {
  assertIndex,
  assertInsertIndex,
  collectSubtree,
  columnOrderOf,
  convertToParagraph,
  readCellColor,
  rowsOf,
  setCellColor,
  tableOf,
  widthsMap,
} from "./common";

/**
 * Inserts an empty column (a fresh column id, the default width, cells
 * without content blocks) at `at` (0 = the first column, the column count =
 * the last; appended when omitted). The new cells inherit the row colors (a
 * row's color stands on every cell of the row — an uncolored new cell would
 * break the row's band). No width entry is written: an absent key stands
 * the default width at read time.
 */
function insertTableColumn(ydoc: Y.Doc, generateId: () => string, tableId: string, at?: number): void {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const columnOrder = columnOrderOf(table, tableId);
  const cols = columnOrder.length;
  if (at !== undefined) assertInsertIndex(at, cols, "Column");
  const index = at ?? cols;
  const newColumnId = generateId();
  const rowIds = rows.toArray();
  localTransact(ydoc, () => {
    const blocks = getBlocks(ydoc);
    // The column identity (the single source of the column set).
    columnOrder.insert(index, [newColumnId]);
    rowIds.forEach((rowId) => {
      const row = getBlockMap(ydoc, rowId);
      const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : undefined;
      if (row === null || !(cells instanceof Y.Array)) {
        throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence.`);
      }
      const cellId = generateId();
      writeBlock(blocks, cellId, { type: "table-cell", attrs: { columnId: newColumnId } });
      // The owner parent (the single CRDT-resolved ownership stand).
      const cellMap = blocks.get(cellId);
      if (cellMap instanceof Y.Map) cellMap.set("parent", rowId);
      for (const existingId of cells.toArray()) {
        const color = readCellColor(ydoc, existingId, "rowColor");
        if (color !== null) {
          setCellColor(ydoc, cellId, "rowColor", color);
          break;
        }
      }
      // The short row's length can stand below the index (the concurrent
      // row × column race residue): the new cell lands at the end (the
      // unclamped index would be a Yjs out-of-range op).
      cells.insert(Math.min(index, cells.length), [cellId]);
    });
  });
}

/**
 * Removes the column at `index` (the column id, the cells and their content,
 * in every row). The LAST column converts the table into a plain paragraph
 * (the block id and the indent stand).
 */
function removeTableColumn(ydoc: Y.Doc, tableId: string, index: number): void {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const columnOrder = columnOrderOf(table, tableId);
  const cols = columnOrder.length;
  assertIndex(index, cols, "Column");
  const columnId = columnOrder.toArray()[index]!;
  const rowIds = rows.toArray();
  localTransact(ydoc, () => {
    const blocks = getBlocks(ydoc);
    for (const rowId of rowIds) {
      const row = getBlockMap(ydoc, rowId);
      const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : undefined;
      if (row === null || !(cells instanceof Y.Array)) {
        throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence.`);
      }
      // The row's cell of the removed column stands by its binding (a
      // positional scan would remove a foreign column's cell over a
      // leading-cell-absent short row); a short row may lack this column's
      // cell: skip it — the column op stands on the cells that exist (the
      // column identity dies in the columnOrder regardless).
      const cell = columnCellOfRow(ydoc, rowId, columnId, index);
      if (cell === null) continue;
      for (const id of collectSubtree(ydoc, cell.cellId)) blocks.delete(id);
      cells.delete(cell.position, 1);
    }
    // The column identity (the single source of the column set).
    columnOrder.delete(index, 1);
    // The width entry is identity-keyed: it dies with its column id.
    widthsMap(table)?.delete(columnId);
    if (cols === 1) {
      // The last column: the rows are gone — convert the table in place.
      for (const rowId of rowIds) blocks.delete(rowId);
      rows.delete(0, rows.length);
      convertToParagraph(ydoc, tableId);
    }
  });
}

/**
 * Moves the column from `fromIndex` to `toIndex` (pre-move index
 * semantics, like moveRow): the column id moves in the `columnOrder` and
 * the cells of EVERY row move with it (the colors ride the cells; the width
 * entry follows the column by id — no width op is needed).
 *
 * The cell to move stands by its `columnId` binding (the short row's
 * residue stands by id, not position — a positional scan would move a
 * foreign column's cell and shift the bindings). A legacy row (no
 * columnId bindings) keeps the positional stand. The destination index is
 * clamped to the row's length (a short row's move lands at the end — the
 * unclamped index would be a Yjs out-of-range op).
 */
function moveTableColumn(ydoc: Y.Doc, tableId: string, fromIndex: number, toIndex: number): void {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const columnOrder = columnOrderOf(table, tableId);
  const cols = columnOrder.length;
  assertIndex(fromIndex, cols, "Column");
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > cols) {
    throw new InvalidRangeError(`toIndex must be an integer in [0, ${cols}] (got ${toIndex}).`);
  }
  const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
  const rowIds = rows.toArray();
  const columnId = columnOrder.toArray()[fromIndex]!;
  localTransact(ydoc, () => {
    for (const rowId of rowIds) {
      const row = getBlockMap(ydoc, rowId);
      const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : undefined;
      if (row === null || !(cells instanceof Y.Array)) {
        throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence.`);
      }
      const cellIds = cells.toArray();
      // The column's own cell (the binding stands by id); the legacy row
      // (no bindings at all) falls back to the positional stand.
      const boundIndex = cellIds.findIndex((cellId) => readColumnIdOf(ydoc, cellId) === columnId);
      const hasBindings = cellIds.some((cellId) => readColumnIdOf(ydoc, cellId) !== null);
      let sourceIndex: number | null = null;
      if (boundIndex !== -1) sourceIndex = boundIndex;
      else if (!hasBindings && fromIndex < cellIds.length) sourceIndex = fromIndex;
      // A short row (the concurrent row × column race residue) may lack
      // this column's cell: skip it — the column identity moves in the
      // columnOrder regardless.
      if (sourceIndex === null) continue;
      const movedCellId = cellIds[sourceIndex]!;
      cells.delete(sourceIndex, 1);
      cells.insert(Math.min(insertAt, cells.length), [movedCellId]);
    }
    // The column identity moves (element-level).
    columnOrder.delete(fromIndex, 1);
    columnOrder.insert(insertAt, [columnId]);
  });
}

export { clearTableColumn, duplicateTableColumn, setTableColumnColor, setTableColumnWidth } from "./column-cells";
export { insertTableColumn, moveTableColumn, removeTableColumn };
