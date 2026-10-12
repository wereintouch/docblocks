/**
 * Database row commands: insertRow, setCell, removeRow, moveRow. Rows are
 * DATA on the block (the `rows` cell map + the `rowOrder` order array),
 * not blocks — the commands mutate the block's own fields with the same
 * validate-first, one-transaction shape as the block commands.
 */
import * as Y from "yjs";

import { checkDatabaseCellValue, validateDatabaseBlock } from "@docblocks-core/schema";
import type { Block, DatabaseCellValue, ValidationError } from "@docblocks-core/schema";

import {
  InvalidAttrsError,
  InvalidCellValueError,
  InvalidOperationError,
  InvalidRangeError,
  UnknownBlockError,
  UnknownColumnError,
  UnknownRowError,
  formatValidationErrors,
} from "../errors";
import { localTransact } from "../layout";
import { blockTypeOf, getBlockMap } from "./structure";

/**
 * The database's block-level column invariants for a fresh insert (empty
 * rows / rowOrder): the type-dependent options presence, the duplicate ids.
 * The attrs are `unknown`: the caller's generic attr type cannot be narrowed
 * at the call site — the shape is the validator's job.
 */
function assertValidDatabaseInsert(attrs: unknown): void {
  const errors: ValidationError[] = [];
  validateDatabaseBlock({ type: "database", attrs, rows: {}, rowOrder: [] }, "blocks.new", errors);
  if (errors.length > 0) {
    throw new InvalidAttrsError(`Invalid database for block type "database": ${formatValidationErrors(errors)}`);
  }
}

/** The database's block-level column invariants for a post-patch block, checked against the existing rows. */
function assertValidDatabasePatch(snapshot: Block | null, attrs: unknown, id: string): void {
  const block =
    snapshot !== null && snapshot.type === "database"
      ? { ...snapshot, attrs }
      : { type: "database" as const, attrs, rows: {}, rowOrder: [] as string[] };
  const errors: ValidationError[] = [];
  validateDatabaseBlock(block, `blocks.${id}`, errors);
  if (errors.length > 0) {
    throw new InvalidAttrsError(`Invalid database for block "${id}": ${formatValidationErrors(errors)}`);
  }
}

/** The columns of a database block, read from the attrs (corrupt entries skipped). */
interface DatabaseColumnView {
  id: string;
  name: string;
  type: string;
  options: string[] | undefined;
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The columns array elements are plain immutable values (Yjs arrays carry
 * no nested Y types): each element is a plain object of the column shape.
 */
function readColumns(block: Y.Map<unknown>): DatabaseColumnView[] {
  const attrs = block.get("attrs");
  if (!(attrs instanceof Y.Map)) return [];
  const columns = attrs.get("columns");
  if (!(columns instanceof Y.Array)) return [];
  const result: DatabaseColumnView[] = [];
  columns.forEach((column) => {
    if (!isPlainRecord(column)) return;
    const id = column.id;
    const name = column.name;
    const type = column.type;
    if (typeof id !== "string" || id.length === 0 || typeof type !== "string") return;
    const options = column.options;
    result.push({
      id,
      name: typeof name === "string" ? name : "",
      type,
      options: Array.isArray(options)
        ? options.filter((option): option is string => typeof option === "string")
        : undefined,
    });
  });
  return result;
}

/** The database block's Y.Map; typed errors when the id is missing or not a database. */
function databaseOf(ydoc: Y.Doc, databaseId: string): Y.Map<unknown> {
  const type = blockTypeOf(ydoc, databaseId);
  if (type === null) throw new UnknownBlockError(`Unknown block "${databaseId}".`);
  if (type !== "database") {
    throw new InvalidOperationError(`Block "${databaseId}" is a ${type}, not a database.`);
  }
  const block = getBlockMap(ydoc, databaseId);
  if (block === null) throw new UnknownBlockError(`Unknown block "${databaseId}".`);
  return block;
}

/** The block's row-order array; null when the layout is corrupt (no array). */
function readRowOrder(block: Y.Map<unknown>): Y.Array<string> | null {
  const rowOrder = block.get("rowOrder");
  return rowOrder instanceof Y.Array ? (rowOrder as Y.Array<string>) : null;
}

/** The block's rows map; null when the layout is corrupt (no map). */
function readRows(block: Y.Map<unknown>): Y.Map<unknown> | null {
  const rows = block.get("rows");
  return rows instanceof Y.Map ? rows : null;
}

/** The row's cell map; typed error when the row is absent (or the layout is corrupt). */
function cellRow(block: Y.Map<unknown>, rowId: string, databaseId: string): Y.Map<unknown> {
  const row = readRows(block)?.get(rowId);
  if (!(row instanceof Y.Map)) {
    throw new UnknownRowError(`Unknown row "${rowId}" of database "${databaseId}".`);
  }
  return row;
}

/** The column by id; typed error when the id is not in the columns. */
function columnOf(block: Y.Map<unknown>, colId: string, databaseId: string): DatabaseColumnView {
  const column = readColumns(block).find((entry) => entry.id === colId);
  if (column === undefined) {
    throw new UnknownColumnError(`Unknown column "${colId}" of database "${databaseId}".`);
  }
  return column;
}

/**
 * Appends an empty row to a database block and returns its id. An empty
 * row is `{}`: an absent cell key is an unset cell.
 */
function insertRow(ydoc: Y.Doc, generateId: () => string, databaseId: string): string {
  const block = databaseOf(ydoc, databaseId);
  const id = generateId();
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

export { assertValidDatabaseInsert, assertValidDatabasePatch, insertRow, moveRow, removeRow, setCell };
