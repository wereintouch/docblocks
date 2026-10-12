/**
 * The database block types: the rows are DATA, not blocks — a flat cell
 * map plus an explicit row order (field-level CRDT merge, no block
 * machinery per row).
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

interface DatabaseAttrs {
  /** The columns; a cell key references a column id. */
  columns: DatabaseColumn[];
}

interface DatabaseBlock {
  type: "database";
  attrs: DatabaseAttrs;
  /** Row id -> column id -> cell value; an absent key is an unset cell. */
  rows: Record<string, Record<string, DatabaseCellValue>>;
  /** The row order; the set of ids equals the rows' key set. */
  rowOrder: string[];
}

export type { DatabaseAttrs, DatabaseBlock, DatabaseCellType, DatabaseCellValue, DatabaseColumn };
