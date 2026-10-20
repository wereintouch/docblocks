/**
 * The database block types. The rows are DATA, not blocks — a flat cell
 * map plus an explicit row order (field-level CRDT merge, no block
 * machinery per row). Two forms: the inline form (the rows and the
 * schema stand in the document) and the external form (the `tableId`
 * reference — the rows and the schema live in the consumer's relational
 * database, and the block holds only the reference).
 */

/** The cell value contract of a database column. */
type DatabaseCellType = "text" | "number" | "checkbox" | "select" | "multi-select" | "date";

/** A database column; cell values in `rows` are keyed by its `id`. */
interface DatabaseColumn {
  /** Column id (the cell key); unique within the columns. */
  id: string;
  /** Display name. */
  name: string;
  /** The cell value contract. */
  type: DatabaseCellType;
  /** Option values; `select` / `multi-select` only (required for them). */
  options?: string[];
}

/** A database cell value per the column type (rich-text cells are v2). */
type DatabaseCellValue = string | number | boolean | string[];

/** A single filter condition (the column id, the operator, the value). */
interface DatabaseFilterCondition {
  /** The column id the condition applies to. */
  columnId: string;
  /** The operator name (the consumer's catalog or the package default). */
  op: string;
  /** The JSON value; absent for the empty / not-empty operators. */
  value?: unknown;
}

/** The recursive and/or filter payload (the `filter` attr and the
 *  `queryRows` filter parameter; the recursion depth is bounded by the
 *  UI). */
interface DatabaseFilterPayload {
  logic: "and" | "or";
  conditions: DatabaseFilterCondition[];
  /** The nested groups (the recursion); absent or null = none. */
  groups?: DatabaseFilterPayload[] | null;
}

/** A saved view (a per-block snapshot of the filter + the column
 *  display state). */
interface DatabaseSavedView {
  /** The view id (local to the block). */
  id: string;
  name: string;
  filter?: DatabaseFilterPayload;
  columnOrder?: string[];
  hiddenColumns?: string[];
}

interface DatabaseAttrs {
  /** The columns; a cell key references a column id. The inline form
   *  only — the external form (the `tableId` reference) carries no
   *  schema: the columns live in the consumer's relational table. */
  columns?: DatabaseColumn[];
  /** The external table reference (the external form): the rows and the
   *  schema live in the consumer's relational database, and the block
   *  holds only this reference. Mutually exclusive with `columns`. */
  tableId?: string;
  /** The row filter (the external-form view state): the recursive and/or
   *  payload; the structure is checked by the validator's database
   *  branch. */
  filter?: DatabaseFilterPayload;
  /** The column display order (the column ids; absent = the schema's
   *  order). */
  columnOrder?: string[];
  /** The hidden column ids. */
  hiddenColumns?: string[];
  /** The saved views (the per-block instance). */
  views?: DatabaseSavedView[];
  /** The current view type (the v1 set; an unknown value falls back to
   *  `table` at render time). */
  viewType?: "table" | "kanban" | "calendar";
  /** Nesting depth in the page sequence (default 0). */
  indent?: number;
}

interface DatabaseBlock {
  type: "database";
  attrs: DatabaseAttrs;
  /** Row id -> column id -> cell value; an absent key is an unset cell. */
  rows: Record<string, Record<string, DatabaseCellValue>>;
  /** The row order; the set of ids equals the rows' key set. */
  rowOrder: string[];
}

export type {
  DatabaseAttrs,
  DatabaseBlock,
  DatabaseCellType,
  DatabaseCellValue,
  DatabaseColumn,
  DatabaseFilterCondition,
  DatabaseFilterPayload,
  DatabaseSavedView,
};
