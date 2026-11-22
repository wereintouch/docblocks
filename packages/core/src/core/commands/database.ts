/**
 * Database row commands: insertRow, setCell, removeRow, moveRow, and the
 * external-form switch (setDatabaseTable). Rows are DATA on the block (the
 * `rows` cell map + the `rowOrder` order array), not blocks — the commands
 * mutate the block's own fields with the same validate-first,
 * one-transaction shape as the block commands. The block's read helpers +
 * the column validators live in database-read (the validators are
 * re-exported from this entry).
 */
import * as Y from "yjs";

import { checkDatabaseCellValue, isReservedId } from "@docblocks-core/schema";
import type { DatabaseCellValue } from "@docblocks-core/schema";

import { InvalidCellValueError, InvalidOperationError, InvalidRangeError, UnknownRowError } from "../errors";
import { localTransact } from "../layout";
import { readBlock } from "../read";
import {
  assertInlineForm,
  assertValidDatabasePatch,
  cellRow,
  columnOf,
  databaseOf,
  readRowOrder,
  readRows,
} from "./database-read";

/**
 * Appends an empty row to a database block and returns its id. An empty
 * row is `{}`: an absent cell key is an unset cell.
 */
function insertRow(ydoc: Y.Doc, generateId: () => string, databaseId: string): string {
  const block = databaseOf(ydoc, databaseId);
  assertInlineForm(block, databaseId);
  const id = generateId();
  // A reserved row id (a custom generateId) would be lost on the JSON export
  // (the id-keyed-map trap): reject it at the boundary.
  if (isReservedId(id)) {
    throw new InvalidOperationError(
      `The row id "${id}" is reserved (it collides with Object.prototype) and cannot be used.`
    );
  }
  localTransact(ydoc, () => {
    // A valid database always carries both fields (insertBlock creates
    // them); the lazy creation repairs a corrupt layout.
    const existingRows = block.get("rows");
    const rows: Y.Map<unknown> =
      existingRows instanceof Y.Map ? (existingRows as Y.Map<unknown>) : new Y.Map<unknown>();
    if (!(existingRows instanceof Y.Map)) block.set("rows", rows);
    rows.set(id, new Y.Map<unknown>());
    const existingOrder = block.get("rowOrder");
    const rowOrder: Y.Array<string> =
      existingOrder instanceof Y.Array ? (existingOrder as Y.Array<string>) : new Y.Array<string>();
    if (!(existingOrder instanceof Y.Array)) block.set("rowOrder", rowOrder);
    rowOrder.push([id]);
  });
  return id;
}

/**
 * Sets the cell value of a row, validated against the column type (the
 * same contract as the validator). `value === undefined` removes the cell
 * (the row stays); a repeated set of the current value is a no-op.
 */
function setCell(
  ydoc: Y.Doc,
  databaseId: string,
  rowId: string,
  colId: string,
  value: DatabaseCellValue | undefined
): void {
  const block = databaseOf(ydoc, databaseId);
  assertInlineForm(block, databaseId);
  const column = columnOf(block, colId, databaseId);
  const row = cellRow(block, rowId, databaseId);
  if (value === undefined) {
    const current = row.get(colId);
    if (current === undefined) return; // no-op: the cell is already unset
    localTransact(ydoc, () => row.delete(colId));
    return;
  }
  const violation = checkDatabaseCellValue(column.type, column.options, value);
  if (violation !== null) {
    throw new InvalidCellValueError(
      `Invalid cell value for row "${rowId}", column "${colId}": ${violation} (got ${JSON.stringify(value) ?? String(value)}).`
    );
  }
  // A redundant set of the same value emits no update (Yjs dedupes
  // primitives; a fresh Y.Array for a multi-select would not).
  const stored = row.get(colId);
  const current = stored instanceof Y.Array ? stored.toArray() : stored;
  if (Array.isArray(value)) {
    if (!Array.isArray(current) || current.length !== value.length || !value.every((item, i) => item === current[i])) {
      // Clone the array: a Yjs map holds plain values by reference, so the
      // caller's array must not be aliased into the CRDT.
      localTransact(ydoc, () => row.set(colId, [...value]));
    }
    return;
  }
  if (current === value) return;
  localTransact(ydoc, () => row.set(colId, value));
}

/** Removes a row: its cells entry and its rowOrder entry. */
function removeRow(ydoc: Y.Doc, databaseId: string, rowId: string): void {
  const block = databaseOf(ydoc, databaseId);
  assertInlineForm(block, databaseId);
  cellRow(block, rowId, databaseId); // the typed error when the row is absent
  localTransact(ydoc, () => {
    const rows = readRows(block);
    if (rows !== null) rows.delete(rowId);
    const rowOrder = readRowOrder(block);
    if (rowOrder !== null) {
      const index = rowOrder.toArray().indexOf(rowId);
      if (index !== -1) rowOrder.delete(index, 1);
    }
  });
}

/** Moves a row to `toIndex` (pre-move index semantics, like moveBlock). */
function moveRow(ydoc: Y.Doc, databaseId: string, rowId: string, toIndex: number): void {
  const block = databaseOf(ydoc, databaseId);
  assertInlineForm(block, databaseId);
  const rowOrder = readRowOrder(block);
  const ids = rowOrder !== null ? rowOrder.toArray() : [];
  const fromIndex = ids.indexOf(rowId);
  if (rowOrder === null || fromIndex === -1) {
    throw new UnknownRowError(`Unknown row "${rowId}" of database "${databaseId}".`);
  }
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > ids.length) {
    throw new InvalidRangeError(`toIndex must be an integer in [0, ${ids.length}] (got ${toIndex}).`);
  }
  localTransact(ydoc, () => {
    rowOrder.delete(fromIndex, 1);
    // Pre-move indices: the removal shifts a later target left by one.
    const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
    rowOrder.insert(insertAt, [rowId]);
  });
}

/**
 * Moves the database block to the external form: the inline rows and the
 * schema leave the document (the consumer moves them into its relational
 * table first), and the block keeps the `tableId` reference plus its other
 * attrs. One transaction — one undo step, one wire update. Re-linking an
 * already-external block to another table changes only the reference.
 */
function setDatabaseTable(ydoc: Y.Doc, databaseId: string, tableId: string): void {
  if (typeof tableId !== "string" || tableId.length === 0) {
    throw new InvalidOperationError(`The external table reference must be a non-empty string.`);
  }
  const block = databaseOf(ydoc, databaseId);
  localTransact(ydoc, () => {
    const attrs = block.get("attrs");
    if (attrs instanceof Y.Map) {
      attrs.set("tableId", tableId);
      if (attrs.has("columns")) attrs.delete("columns");
    } else {
      // The corrupt layout (no attrs map): create the minimal one.
      block.set("attrs", new Y.Map([["tableId", tableId]]) as Y.Map<unknown>);
    }
    // The inline data leaves the document (the reader emits empty rows /
    // rowOrder for the external form).
    if (block.has("rows")) block.delete("rows");
    if (block.has("rowOrder")) block.delete("rowOrder");
  });
  // The post-patch invariants (the external form: no columns, no rows).
  const snapshot = readBlock(ydoc, databaseId);
  // The merged attrs stand the snapshot's keys (the data's stand — a
  // hostile `__proto__`'s key stands the inert own entry, not the
  // prototype's write): the null-prototype's map.
  const merged = Object.create(null) as Record<string, unknown>;
  if (snapshot !== null && "attrs" in snapshot && snapshot.attrs !== undefined) {
    for (const [key, value] of Object.entries(snapshot.attrs)) {
      if (key !== "columns") merged[key] = value;
    }
  }
  merged.tableId = tableId;
  assertValidDatabasePatch(snapshot, merged, databaseId);
}

export { assertValidDatabaseInsert, assertValidDatabasePatch } from "./database-read";
export { insertRow, moveRow, removeRow, setCell, setDatabaseTable };
