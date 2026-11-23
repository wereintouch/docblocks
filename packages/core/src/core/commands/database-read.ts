/**
 * The database block's read helpers and the column validators: the block's
 * Y.Map (databaseOf), the inline-form guard (assertInlineForm), the rows /
 * rowOrder / cell / column reads (readRows, readRowOrder, cellRow,
 * columnOf, readColumns), and the block-level column invariants for a
 * fresh insert and a post-patch block (assertValidDatabaseInsert /
 * assertValidDatabasePatch).
 */
import * as Y from "yjs";

import { validateDatabaseBlock } from "@docblocks-core/schema";
import type { Block, ValidationError } from "@docblocks-core/schema";

import {
  ExternalDatabaseError,
  InvalidAttrsError,
  InvalidOperationError,
  UnknownBlockError,
  UnknownColumnError,
  UnknownRowError,
  formatValidationErrors,
} from "../errors";
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

/**
 * The external-form guard: a non-empty `attrs.tableId` means the rows and
 * the schema live in the consumer's relational database — the row
 * commands refuse with the typed ExternalDatabaseError.
 */
function assertInlineForm(block: Y.Map<unknown>, databaseId: string): void {
  const attrs = block.get("attrs");
  if (attrs instanceof Y.Map) {
    const tableId = attrs.get("tableId");
    if (typeof tableId === "string" && tableId.length > 0) {
      throw new ExternalDatabaseError(
        `Database "${databaseId}" references the external table "${tableId}": its rows and schema live in the consumer's database, not in the document.`
      );
    }
  }
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

export {
  assertInlineForm,
  assertValidDatabaseInsert,
  assertValidDatabasePatch,
  cellRow,
  columnOf,
  databaseOf,
  readRowOrder,
  readRows,
};
