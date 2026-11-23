/**
 * The Doc facade's database-block delegates: the command calls behind the
 * database row/cell methods and the external-table link.
 */
import type * as Y from "yjs";

import type { BlockId, DatabaseCellValue } from "@docblocks-core/schema";

import {
  insertRow as insertRowCommand,
  moveRow as moveRowCommand,
  removeRow as removeRowCommand,
  setCell as setCellCommand,
  setDatabaseTable as setDatabaseTableCommand,
} from "../commands";

/** Appends an empty row to a database block and returns its row id. */
function insertRow(ydoc: Y.Doc, generateId: () => string, databaseId: BlockId): BlockId {
  return insertRowCommand(ydoc, generateId, databaseId);
}

/** Sets the cell value of a database row, validated against the column type. */
function setCell(
  ydoc: Y.Doc,
  databaseId: BlockId,
  rowId: string,
  colId: string,
  value: DatabaseCellValue | undefined
): void {
  setCellCommand(ydoc, databaseId, rowId, colId, value);
}

/** Removes a database row: its cells entry and its rowOrder entry. */
function removeRow(ydoc: Y.Doc, databaseId: BlockId, rowId: string): void {
  removeRowCommand(ydoc, databaseId, rowId);
}

/** Moves a database row to `toIndex` (pre-move index semantics). */
function moveRow(ydoc: Y.Doc, databaseId: BlockId, rowId: string, toIndex: number): void {
  moveRowCommand(ydoc, databaseId, rowId, toIndex);
}

/**
 * Moves a database block to the external form: the inline rows and the
 * schema leave the document (the consumer moves them into its relational
 * table first), and the block keeps the `tableId` reference plus its other
 * attrs. One transaction — one undo step, one wire update. Re-linking an
 * already-external block to another table changes only the reference.
 */
function setDatabaseTable(ydoc: Y.Doc, databaseId: BlockId, tableId: string): void {
  setDatabaseTableCommand(ydoc, databaseId, tableId);
}

export { insertRow, moveRow, removeRow, setCell, setDatabaseTable };
