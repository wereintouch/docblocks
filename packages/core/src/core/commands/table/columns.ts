/**
 * Table column commands: insertTableColumn, removeTableColumn,
 * moveTableColumn, duplicateTableColumn, clearTableColumn,
 * setTableColumnColor, setTableColumnWidth.
 *
 * Column identity: the table's `columnOrder` (a shared CRDT array of column
 * ids) is the single source of the column set — the column count is
 * `columnOrder.length`, never a scalar counter. Each cell carries a
 * `columnId` binding it to a column; the cells of a row stand in
 * `columnOrder` order (the cell at position i ↔ `columnOrder[i]`), so the
 * per-cell colors ride the column through an insert/remove/move/duplicate.
 *
 * Column widths are stored identity-keyed (`attrs.columnWidths` is a Y.Map
 * of columnId → width — an element-level LWW op per column), so a concurrent
 * move + width set of one column converge per key (a positional array's
 * element ops would not). The positional `columnWidths` array in the JSON is
 * derived from this map at read time (an absent key stands the default
 * width), which is why these commands never move or reorder width entries —
 * the width follows its column's id.
 *
 * Removing the LAST column converts the table into a plain paragraph in
 * place (the block id and the indent stand).
 */
import * as Y from "yjs";

import { InvalidOperationError, InvalidRangeError } from "../../errors";
import { localTransact, writeBlock } from "../../layout";
import { getBlockMap, getBlocks } from "../structure";
import {
  DEFAULT_TABLE_COLUMN_WIDTH,
  assertCellColor,
  assertIndex,
  assertInsertIndex,
  assertWidth,
  clearBlockChildren,
  collectSubtree,
  columnOrderOf,
  convertToParagraph,
  readCellColor,
  rowsOf,
  setCellColor,
  snapshotSubtree,
  tableOf,
  widthsMap,
  writeSubtreeCopy,
} from "./common";

/** Ensures the identity-keyed width map exists on the table's attrs (creating the attrs map if absent). */
function ensureWidthsMap(table: Y.Map<unknown>): Y.Map<unknown> {
  const existing = widthsMap(table);
  if (existing !== null) return existing;
  const attrs = table.get("attrs");
  if (attrs instanceof Y.Map) {
    const map = new Y.Map<unknown>();
    attrs.set("columnWidths", map);
    return map;
  }
  const freshAttrs = new Y.Map<unknown>();
  const map = new Y.Map<unknown>();
  freshAttrs.set("columnWidths", map);
  table.set("attrs", freshAttrs);
  return map;
}

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
      for (const existingId of cells.toArray()) {
        const color = readCellColor(ydoc, existingId, "rowColor");
        if (color !== null) {
          setCellColor(ydoc, cellId, "rowColor", color);
          break;
        }
      }
      cells.insert(index, [cellId]);
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
      const cellId = cells.toArray()[index];
      // A short row (the concurrent row × column race residue) may lack this
      // position's cell: skip it — the column op stands on the cells that
      // exist (the column identity moves in the columnOrder regardless).
      if (cellId === undefined) continue;
      for (const id of collectSubtree(ydoc, cellId)) blocks.delete(id);
      cells.delete(index, 1);
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
  localTransact(ydoc, () => {
    for (const rowId of rowIds) {
      const row = getBlockMap(ydoc, rowId);
      const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : undefined;
      if (row === null || !(cells instanceof Y.Array)) {
        throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence.`);
      }
      const cellId = cells.toArray()[fromIndex];
      // A short row (the concurrent row × column race residue) may lack this
      // position's cell: skip it — the column identity moves in the
      // columnOrder regardless.
      if (cellId === undefined) continue;
      cells.delete(fromIndex, 1);
      cells.insert(insertAt, [cellId]);
    }
    // The column identity moves (element-level).
    const columnId = columnOrder.toArray()[fromIndex]!;
    columnOrder.delete(fromIndex, 1);
    columnOrder.insert(insertAt, [columnId]);
  });
}

/**
 * Duplicates the column at `index` right of it: a fresh column id is added
 * to the `columnOrder`, the cells are deep-copied (content + colors, the
 * `columnId` re-bound to the fresh id) and the explicit width entry, if any,
 * is copied to the fresh id.
 */
function duplicateTableColumn(ydoc: Y.Doc, generateId: () => string, tableId: string, index: number): void {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const columnOrder = columnOrderOf(table, tableId);
  const cols = columnOrder.length;
  assertIndex(index, cols, "Column");
  const sourceColumnId = columnOrder.toArray()[index]!;
  const newColumnId = generateId();
  const rowIds = rows.toArray();
  const snaps: Array<ReturnType<typeof snapshotSubtree> | undefined> = rowIds.map((rowId) => {
    const row = getBlockMap(ydoc, rowId);
    const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : null;
    if (row === null || cells === null || !(cells instanceof Y.Array)) {
      throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence.`);
    }
    // A short row (the concurrent row × column race residue) may lack this
    // position's cell: the copied column stands without a cell there.
    const cellId = cells.toArray()[index];
    return cellId === undefined ? undefined : snapshotSubtree(ydoc, generateId, cellId);
  });
  localTransact(ydoc, () => {
    // The fresh column identity (the single source of the column set).
    columnOrder.insert(index + 1, [newColumnId]);
    rowIds.forEach((rowId, i) => {
      const row = getBlockMap(ydoc, rowId);
      const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : undefined;
      if (row === null || !(cells instanceof Y.Array)) {
        throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence.`);
      }
      // The copied cell's columnId re-binds to the fresh column (a short
      // row stands without a cell — the snap is absent).
      const snap = snaps[i];
      if (snap === undefined) return;
      const newCellId = writeSubtreeCopy(ydoc, snap);
      const newCell = getBlockMap(ydoc, newCellId);
      if (newCell !== null) {
        const attrs = newCell.get("attrs");
        if (attrs instanceof Y.Map) attrs.set("columnId", newColumnId);
        else newCell.set("attrs", new Y.Map<unknown>([["columnId", newColumnId]]));
      }
      cells.insert(index + 1, [newCellId]);
    });
    // The explicit width entry, if any, follows the copy to the fresh id.
    const widthMap = widthsMap(table);
    const width = widthMap instanceof Y.Map ? widthMap.get(sourceColumnId) : undefined;
    if (typeof width === "number") ensureWidthsMap(table).set(newColumnId, width);
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
    // A short row (the concurrent row × column race residue) may lack this
    // position's cell: skip it (its peers' cells still receive the op).
    if (cellId !== undefined) cellIds.push(cellId);
  }
  return cellIds;
}

/** Clears the cell content of every cell in a column (the cells stay, empty). */
function clearTableColumn(ydoc: Y.Doc, tableId: string, index: number): void {
  const table = tableOf(ydoc, tableId);
  const cols = columnOrderOf(table, tableId).length;
  assertIndex(index, cols, "Column");
  const cellIds = columnCellIds(ydoc, table, tableId, index);
  localTransact(ydoc, () => {
    for (const cellId of cellIds) clearBlockChildren(ydoc, cellId);
  });
}

/** Sets (or removes, `null`) the column color on every cell of a column. */
function setTableColumnColor(ydoc: Y.Doc, tableId: string, index: number, color: string | null): void {
  const table = tableOf(ydoc, tableId);
  const cols = columnOrderOf(table, tableId).length;
  assertIndex(index, cols, "Column");
  if (color !== null) assertCellColor("columnColor", color, tableId);
  const cellIds = columnCellIds(ydoc, table, tableId, index);
  localTransact(ydoc, () => {
    for (const cellId of cellIds) setCellColor(ydoc, cellId, "columnColor", color);
  });
}

/**
 * Sets the width of the column at `index` (>= 50; no silent clamp): a single
 * identity-keyed entry (columnId → width). An equal-value set is a zero-byte
 * no-op: the comparison (against the stored entry or the default the read
 * would stand) runs BEFORE the transaction (a transaction always stamps
 * meta.updatedAt, so the no-op must skip the transaction, not the write).
 */
function setTableColumnWidth(ydoc: Y.Doc, tableId: string, index: number, width: number): void {
  const table = tableOf(ydoc, tableId);
  const columnOrder = columnOrderOf(table, tableId);
  const cols = columnOrder.length;
  assertIndex(index, cols, "Column");
  assertWidth(width, tableId);
  const columnId = columnOrder.toArray()[index]!;
  const stored = widthsMap(table)?.get(columnId);
  const current = typeof stored === "number" ? stored : DEFAULT_TABLE_COLUMN_WIDTH;
  if (current === width) return;
  localTransact(ydoc, () => {
    ensureWidthsMap(table).set(columnId, width);
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
