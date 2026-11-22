/** The table layout's accessors (the Yjs maps/arrays with typed errors on
 * a corrupt layout) + the structural bounds checks. They run inside the
 * caller's transaction; none of them opens a transaction of its own.
 * The value checks / the widths / the colors / the subtree-copy helpers
 * stand in the sibling modules (common-values.ts / common-copy.ts), the
 * former common.ts's stand. */
import * as Y from "yjs";

import {
  DetachedBlockError,
  InvalidAttrsError,
  InvalidOperationError,
  InvalidRangeError,
  UnknownBlockError,
} from "../../errors";
import { blockTypeOf, findParent, getBlockMap } from "../structure";

/** The table block's Y.Map; typed errors when the id is missing or not a table. */
function tableOf(ydoc: Y.Doc, tableId: string): Y.Map<unknown> {
  const type = blockTypeOf(ydoc, tableId);
  if (type === null) throw new UnknownBlockError(`Unknown block "${tableId}".`);
  if (type !== "table") throw new InvalidOperationError(`Block "${tableId}" is a ${type}, not a table.`);
  const block = getBlockMap(ydoc, tableId);
  if (block === null) throw new UnknownBlockError(`Unknown block "${tableId}".`);
  return block;
}

/** The table's row sequence; typed error on a corrupt layout. */
function rowsOf(table: Y.Map<unknown>, tableId: string): Y.Array<string> {
  const rows = table.get("children");
  if (!(rows instanceof Y.Array)) {
    throw new InvalidOperationError(`Table "${tableId}" has no row sequence (corrupt layout).`);
  }
  return rows as Y.Array<string>;
}

/** The table's column identities + order (the single source of the column set); typed error on a corrupt layout. */
function columnOrderOf(table: Y.Map<unknown>, tableId: string): Y.Array<string> {
  const columnOrder = table.get("columnOrder");
  if (!(columnOrder instanceof Y.Array)) {
    throw new InvalidOperationError(`Table "${tableId}" has no columnOrder (corrupt layout).`);
  }
  return columnOrder as Y.Array<string>;
}

/** The row by id; typed error when the id is not a child of the table. */
function rowOf(ydoc: Y.Doc, tableId: string, table: Y.Map<unknown>, rowId: string): Y.Map<unknown> {
  const rows = rowsOf(table, tableId).toArray();
  if (!rows.includes(rowId)) throw new DetachedBlockError(`Row "${rowId}" is not a child of table "${tableId}".`);
  const row = getBlockMap(ydoc, rowId);
  if (row === null) throw new UnknownBlockError(`Unknown row "${rowId}" of table "${tableId}".`);
  return row;
}

/** The row's cell sequence; typed error on a corrupt layout. */
function cellsOf(row: Y.Map<unknown>, tableId: string, rowId: string): Y.Array<string> {
  const cells = row.get("children");
  if (!(cells instanceof Y.Array)) {
    throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence (corrupt layout).`);
  }
  return cells as Y.Array<string>;
}

/**
 * The table cell's column binding (the strict validator's doc-level
 * invariant, the `validateTableInvariants`'s stand): over a FULL row (cell
 * count === the table's columnOrder count) the cell's `columnId` must stand
 * the column at the cell's position in the columnOrder. The short / overfull
 * rows and the corrupt parent chain / columnOrder stand the validator's
 * skip-stands (those conditions are the validator's report, not the
 * commands'). The generic attr's path (updateBlock / removeBlockAttr) keeps
 * the live document valid over the binding — like the database's patch
 * check against its rows.
 */
function assertValidCellColumnBinding(ydoc: Y.Doc, cellId: string, columnId: unknown): void {
  const rowId = findParent(ydoc, cellId);
  if (rowId === null || blockTypeOf(ydoc, rowId) !== "table-row") return;
  const tableId = findParent(ydoc, rowId);
  if (tableId === null || blockTypeOf(ydoc, tableId) !== "table") return;
  const row = getBlockMap(ydoc, rowId);
  const cells = row instanceof Y.Map ? row.get("children") : null;
  if (!(cells instanceof Y.Array)) return;
  const cellIds = cells.toArray();
  const position = cellIds.indexOf(cellId);
  if (position === -1) return; // detached from the row: the missing-parent's validator stand
  const table = getBlockMap(ydoc, tableId);
  const columnOrder = table instanceof Y.Map ? table.get("columnOrder") : null;
  if (!(columnOrder instanceof Y.Array)) return; // the corrupt columnOrder stands the table's own error
  const columnIds = columnOrder.toArray();
  if (cellIds.length !== columnIds.length) return; // the short / overfull row's validator stand
  const expected = columnIds[position];
  if (typeof expected !== "string") return; // the corrupt columnOrder entry stands the table's own error
  if (columnId !== expected) {
    throw new InvalidAttrsError(
      `Invalid attrs for block "${cellId}": the cell's columnId must stand ${JSON.stringify(expected)} (its position in the table's columnOrder); found ${JSON.stringify(columnId)}.`
    );
  }
}

/** The column index bounds check (inclusive start, exclusive end). */
function assertIndex(index: number, cols: number, what: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= cols) {
    throw new InvalidRangeError(`${what} index must be an integer in [0, ${cols - 1}] (got ${index}).`);
  }
}

/** The insert position check (inclusive both ends: 0 = first, count = append). */
function assertInsertIndex(index: number, count: number, what: string): void {
  if (!Number.isInteger(index) || index < 0 || index > count) {
    throw new InvalidRangeError(`${what} position must be an integer in [0, ${count}] (got ${index}).`);
  }
}

export { assertIndex, assertInsertIndex, assertValidCellColumnBinding, cellsOf, columnOrderOf, rowOf, rowsOf, tableOf };
