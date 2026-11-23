/**
 * The table's column-cell mechanics and the cell-fan-out column commands:
 * the cell's columnId binding read (readColumnIdOf), the row's cell of a
 * column resolved by binding (columnCellOfRow), the column's cell ids
 * (columnCellIds), and the commands that fan out over a column's cells —
 * duplicateTableColumn, clearTableColumn, setTableColumnColor,
 * setTableColumnWidth. The cell stands by its columnId binding, not
 * position (a positional scan would stand a foreign column's cell over a
 * leading-cell-absent short row); a legacy row (no bindings) keeps the
 * positional stand. The width entry is identity-keyed and follows the
 * column's id.
 */
import * as Y from "yjs";

import { InvalidOperationError } from "../../errors";
import { localTransact } from "../../layout";
import { getBlockMap } from "../structure";
import {
  DEFAULT_TABLE_COLUMN_WIDTH,
  assertCellColor,
  assertIndex,
  assertWidth,
  clearBlockChildren,
  columnOrderOf,
  ensureWidthsMap,
  rowsOf,
  setCellColor,
  snapshotSubtree,
  tableOf,
  widthsMap,
  writeSubtreeCopy,
} from "./common";

/** The cell's `columnId` binding (null when the cell has no attrs / no binding — the legacy positional stand). */
function readColumnIdOf(ydoc: Y.Doc, cellId: string): string | null {
  const cell = getBlockMap(ydoc, cellId);
  if (cell === null) return null;
  const attrs = cell.get("attrs");
  if (!(attrs instanceof Y.Map)) return null;
  const value = attrs.get("columnId");
  return typeof value === "string" ? value : null;
}

/**
 * The row's cell of the column `columnId` (null when the row lacks it): the
 * binding stands by id, not position (the short row's residue stands by id
 * — a positional scan would stand a foreign column's cell over a
 * leading-cell-absent row). A legacy row (no columnId bindings) keeps the
 * positional stand (`positionalIndex`).
 */
function columnCellOfRow(
  ydoc: Y.Doc,
  rowId: string,
  columnId: string,
  positionalIndex: number
): { cellId: string; position: number } | null {
  const row = getBlockMap(ydoc, rowId);
  const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : undefined;
  if (row === null || !(cells instanceof Y.Array)) {
    throw new InvalidOperationError(`Row "${rowId}" has no cell sequence.`);
  }
  const cellIds = cells.toArray();
  const boundIndex = cellIds.findIndex((cellId) => readColumnIdOf(ydoc, cellId) === columnId);
  const hasBindings = cellIds.some((cellId) => readColumnIdOf(ydoc, cellId) !== null);
  const position =
    boundIndex !== -1 ? boundIndex : !hasBindings && positionalIndex < cellIds.length ? positionalIndex : -1;
  if (position === -1) return null;
  return { cellId: cellIds[position]!, position };
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
  const snaps: Array<{ snap: ReturnType<typeof snapshotSubtree>; position: number } | undefined> = rowIds.map(
    (rowId) => {
      // The source cell stands by its binding (a positional scan would copy
      // a foreign column's cell over a leading-cell-absent short row); a
      // short row may lack the source column's cell: the copied column
      // stands without a cell there.
      const source = columnCellOfRow(ydoc, rowId, sourceColumnId, index);
      return source === null
        ? undefined
        : { snap: snapshotSubtree(ydoc, generateId, source.cellId), position: source.position };
    }
  );
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
      // row stands without a cell — the snap is absent); the copy lands
      // next to the source cell (the bound position, not the positional
      // index — the two stand apart over a short row).
      const source = snaps[i];
      if (source === undefined) return;
      const newCellId = writeSubtreeCopy(ydoc, source.snap);
      const newCell = getBlockMap(ydoc, newCellId);
      if (newCell !== null) {
        const attrs = newCell.get("attrs");
        if (attrs instanceof Y.Map) attrs.set("columnId", newColumnId);
        else newCell.set("attrs", new Y.Map<unknown>([["columnId", newColumnId]]));
      }
      cells.insert(source.position + 1, [newCellId]);
    });
    // The explicit width entry, if any, follows the copy to the fresh id.
    const widthMap = widthsMap(table);
    const width = widthMap instanceof Y.Map ? widthMap.get(sourceColumnId) : undefined;
    if (typeof width === "number") ensureWidthsMap(table).set(newColumnId, width);
  });
}

/** The cell id of the column at `index` in every row (by the columnId binding — see columnCellOfRow); typed error on a corrupt row. */
function columnCellIds(ydoc: Y.Doc, table: Y.Map<unknown>, tableId: string, index: number): string[] {
  const cellIds: string[] = [];
  const columnId = columnOrderOf(table, tableId).toArray()[index]!;
  for (const rowId of rowsOf(table, tableId).toArray()) {
    // The cell stands by its binding (see columnCellOfRow); a short row may
    // lack the column's cell: skip it (its peers' cells still receive the
    // op).
    const cell = columnCellOfRow(ydoc, rowId, columnId, index);
    if (cell !== null) cellIds.push(cell.cellId);
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
  columnCellOfRow,
  duplicateTableColumn,
  readColumnIdOf,
  setTableColumnColor,
  setTableColumnWidth,
};
