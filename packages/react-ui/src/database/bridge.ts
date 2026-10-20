/**
 * The `DatabaseBridge` contract: the operations over the consumer's
 * relational tables that back the external-form database blocks. The
 * document keeps only the `tableId` reference — the table schema and the
 * rows live in the consumer's database (Postgres or anything else); the
 * package knows only the signatures and the semantics. All methods are
 * consumer-implemented callbacks (the `blobResolver` / `syncEmbedResolver`
 * idiom); the consumer owns the backend, the transport, and the
 * authentication. The default in-memory implementation
 * (`memory-bridge.ts`) backs the dev / e2e mode.
 */
import type { DatabaseFilterPayload } from "docblocks-core";

/**
 * A bridge column. The `type` is a standard PostgreSQL type name (or the
 * consumer's own name): the contract is type-agnostic — the package does
 * not validate the set; the consumer maps type → DDL and type → cell
 * editor. `options` is the option value set (the enum-like columns).
 * `operators` is the consumer's operator catalog override; when absent,
 * the package's default catalog for the type stands (§ the filter
 * builders), and `queryRows` must apply exactly the declared operators.
 * The `decimals` / `thousands` / `prefix` / `suffix` / `allowNegative`
 * fields are the number column's display attributes (the column's own
 * data — the package's number formatter reads them; the consumer's
 * backend maps the column to integer / decimal as it stands). */
interface BridgeColumn {
  id: string;
  name: string;
  type: string;
  options?: string[];
  operators?: string[];
  /** The number's digit count after the point (default 0 = integer). */
  decimals?: number;
  /** The thousands' separator (the space grouping: `1 000 000`). */
  thousands?: boolean;
  /** The display's prefix stand (e.g. the currency sign). */
  prefix?: string;
  /** The display's suffix stand. */
  suffix?: string;
  /** Whether negative values are allowed (the edit rejects them otherwise). */
  allowNegative?: boolean;
}

/** A table entry of the consumer's database (the picker / the catalog). */
interface TableRef {
  id: string;
  name: string;
}

/**
 * The table schema plus the column metadata. `pkId` — the primary-key
 * column name (default `"id"`): the row id in the whole contract is the
 * VALUE of that column (an opaque string). `rowOrderId` — the unique
 * order column name (default `"rowOrder"`, a fractional order): the
 * extra `orderBy` keys stand BEFORE it, it is appended as the last sort
 * key — the stable cursor guarantee.
 */
interface BridgeTableDescription {
  name: string;
  columns: BridgeColumn[];
  pkId?: string;
  rowOrderId?: string;
}

/** The row query: the filter + the extra sort keys + the cursor page. */
interface RowQuery {
  /** The nested and/or filter (the block's `filter` attr). */
  filter?: DatabaseFilterPayload;
  /** `"+col"` / `"-col"`; the extra sort keys (before the row order). */
  orderBy?: string[];
  /** The page cursor; absent = the first page. */
  cursor?: string;
  /** The page size (the consumer's default when absent). */
  limit?: number;
}

/** A page of rows: row id → column id → value; the next cursor or null. */
interface RowPage {
  rows: Record<string, Record<string, unknown>>;
  nextCursor?: string | null;
}

/**
 * The live table events (the push channel). `cells` is the full row OR
 * the patch of the changed cells; `before` is the optional before
 * snapshot (the client's diff / undo without a re-fetch). The events
 * arrive for ALL rows of the table — the client filters against its own
 * row store (the subscription knows no view state).
 */
type TableEvent =
  | { type: "row.created"; rowId: string; cells: Record<string, unknown> }
  | { type: "row.updated"; rowId: string; cells: Record<string, unknown>; before?: Record<string, unknown> }
  | { type: "row.removed"; rowId: string }
  | { type: "row.moved"; rowId: string; beforeRowId: string | null }
  | { type: "schema.changed"; columns: BridgeColumn[] }
  | { type: "table.renamed"; name: string };

/**
 * The bridge contract (all methods async; errors reject — the package
 * neither swallows nor retries). `subscribeTable` is the only push
 * channel (the consumer's transport: WS / SSE / long-polling / polling
 * with the same event shape) and returns the unsubscribe.
 */
interface DatabaseBridge {
  /** The table catalog. */
  listTables(): Promise<TableRef[]>;
  /** Create a table by name → its id (created EMPTY — the schema is filled by the createColumn calls). */
  createTable(name: string): Promise<string>;
  /** Rename the table (the name stands on the table, shared by every block
   *  that references it). */
  renameTable(tableId: string, name: string): Promise<void>;
  /** The table schema + the pk / order column metadata. */
  describeTable(tableId: string): Promise<BridgeTableDescription>;
  /** Add a column (after `afterColumnId`, or at the end). */
  createColumn(tableId: string, column: BridgeColumn, afterColumnId?: string): Promise<void>;
  /** Remove a column (the consumer destroys its data). */
  deleteColumn(tableId: string, columnId: string): Promise<void>;
  /** Rename a column. */
  renameColumn(tableId: string, columnId: string, name: string): Promise<void>;
  /** Query a page of rows (the cursor pagination). */
  queryRows(tableId: string, query: RowQuery): Promise<RowPage>;
  /** Insert a row → its row id. */
  insertRow(tableId: string, row: Record<string, unknown>): Promise<string>;
  /** Update the cells of a row (the patch). */
  updateRow(tableId: string, rowId: string, cells: Record<string, unknown>): Promise<void>;
  /** Remove a row (the consumer may implement soft-delete behind it). */
  removeRow(tableId: string, rowId: string): Promise<void>;
  /** Restore removed rows — only when the consumer has soft-delete; when
   *  absent, a removal is NOT undoable (it never enters the undo stack). */
  undeleteRows?(tableId: string, rowIds: string[]): Promise<void>;
  /** Batch insert (e.g. a spreadsheet paste) → the row ids. */
  insertRows(tableId: string, rows: Record<string, unknown>[]): Promise<string[]>;
  /** Batch update: one row = `{ rowId, ...cells }`. */
  updateRows(tableId: string, rows: ({ rowId: string } & Record<string, unknown>)[]): Promise<void>;
  /** Batch remove. */
  removeRows(tableId: string, rowIds: string[]): Promise<void>;
  /** Move a row before `beforeRowId` (null = to the end). */
  moveRow(tableId: string, rowId: string, beforeRowId: string | null): Promise<void>;
  /** Subscribe to the table's live events → the unsubscribe. */
  subscribeTable(tableId: string, onEvents: (events: TableEvent[]) => void): () => void;
}

/** The cell value input kind the annotation derives from the column type. */
type BridgeValueInput = "text" | "number" | "boolean" | "date" | "datetime" | "select" | "none";

/** The column annotation the filter builder renders from. */
interface BridgeColumnAnnotation {
  /** The operator catalog (the consumer's `operators` override or the package default for the type). */
  operators: string[];
  /** The value input kind (none = no value is taken: empty / not-empty). */
  valueInput: BridgeValueInput;
  /** Whether the operators take no value (empty / not-empty). */
  valueless: Set<string>;
}

/** The operators that take no value (the emptiness checks). */
const VALUELESS_OPERATORS = new Set(["empty", "not empty"]);

/** The string operators (the text-like columns). */
const TEXT_OPERATORS = ["is", "is not", "contains", "not contains", "starts with", "ends with", "empty", "not empty"];
/** The comparison operators (the numeric columns). */
const NUMBER_OPERATORS = ["is", "is not", "<", "<=", ">", ">=", "between"];
/** The date / datetime operators. */
const DATE_OPERATORS = ["is", "before", "after", "between"];
/** The time-of-day operators. */
const TIME_OPERATORS = ["is", "is not", "before", "after", "between"];
/** The equality-only operators (the boolean / interval / unknown). */
const EQUALITY_OPERATORS = ["is", "is not"];

/** The standard PostgreSQL type names per operator / input group. The contract
 *  is type-agnostic — this is the package's DEFAULT catalog; a non-standard
 *  type name falls back to the minimal `is` / `is not` + the text input, and
 *  the consumer's `operators` override always wins. */
const TEXT_TYPES = new Set([
  "text",
  "varchar",
  "character varying",
  "char",
  "character",
  "citext",
  "name",
  "xml",
  "tsvector",
  "tsquery",
  "uuid",
  "json",
  "jsonb",
  "bytea",
  "inet",
  "cidr",
  "macaddr",
  "macaddr8",
  "point",
  "line",
  "lseg",
  "box",
  "path",
  "polygon",
  "circle",
]);
const NUMBER_TYPES = new Set([
  "number",
  "smallint",
  "integer",
  "int",
  "bigint",
  "real",
  "double precision",
  "numeric",
  "decimal",
  "money",
]);
const BOOLEAN_TYPES = new Set(["boolean", "bool"]);
const DATE_TYPES = new Set(["date"]);
const DATETIME_TYPES = new Set(["timestamp", "timestamptz", "timestamp with time zone", "timestamp without time zone"]);
const TIME_TYPES = new Set(["time", "timetz", "time with time zone", "time without time zone"]);
const INTERVAL_TYPES = new Set(["interval"]);

/** The base type of a (possibly array) type name: `integer[]` → `integer`. */
function baseType(type: string): string {
  return type.replace(/\[\]$/, "").trim();
}

/** The package's default operator catalog for a type name (undefined = the minimal fallback). */
function operatorCatalog(type: string): string[] | undefined {
  const base = baseType(type);
  if (TEXT_TYPES.has(base)) return TEXT_OPERATORS;
  if (NUMBER_TYPES.has(base)) return NUMBER_OPERATORS;
  if (BOOLEAN_TYPES.has(base) || INTERVAL_TYPES.has(base)) return EQUALITY_OPERATORS;
  if (DATE_TYPES.has(base) || DATETIME_TYPES.has(base)) return DATE_OPERATORS;
  if (TIME_TYPES.has(base)) return TIME_OPERATORS;
  return undefined;
}

/** The package's default value input kind for a type name (undefined = the text fallback). */
function valueInputFor(type: string): BridgeValueInput | undefined {
  const base = baseType(type);
  if (TEXT_TYPES.has(base)) return "text";
  if (NUMBER_TYPES.has(base)) return "number";
  if (BOOLEAN_TYPES.has(base)) return "boolean";
  if (DATE_TYPES.has(base)) return "date";
  if (DATETIME_TYPES.has(base)) return "datetime";
  if (TIME_TYPES.has(base) || INTERVAL_TYPES.has(base)) return "text";
  return undefined;
}

/**
 * Builds the column annotation from the `BridgeColumn`: the operator
 * catalog (the consumer's `operators` override, else the option-based
 * catalog for the option columns, else the package default for the
 * Postgres type, else the minimal `is` / `is not`) + the value input
 * kind. The filter builder renders from this; `queryRows` must apply
 * exactly the declared operators.
 */
function columnAnnotation(column: BridgeColumn): BridgeColumnAnnotation {
  let operators: string[];
  if (column.operators !== undefined) {
    operators = [...column.operators];
  } else if (column.options !== undefined) {
    operators = ["is", "is not", "in", "not in"];
  } else {
    operators = operatorCatalog(column.type) ?? ["is", "is not"];
  }
  let valueInput: BridgeValueInput;
  if (column.options !== undefined) valueInput = "select";
  else valueInput = valueInputFor(column.type) ?? "text";
  const valueless = new Set(operators.filter((operator) => VALUELESS_OPERATORS.has(operator)));
  return { operators, valueInput, valueless };
}

/**
 * The parse result of a typed cell / filter value: the committed value
 * (`null` for the empty string) or the validation error (the input is not
 * committed — the editor keeps / reverts to the last valid value).
 */
type CellValueParse = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Validates a raw (string) value against the value input kind before it is
 * written to the row (the number must parse, the date / datetime must be a
 * real date). The empty string is a valid "clear" (null). text / select /
 * boolean pass through (the browser input already constrains them).
 */
function parseCellValue(kind: BridgeValueInput, raw: string): CellValueParse {
  if (raw === "") return { ok: true, value: null };
  switch (kind) {
    case "number": {
      const n = Number(raw);
      return Number.isNaN(n) ? { ok: false, error: "The value is not a number" } : { ok: true, value: n };
    }
    case "date":
      return isValidDate(raw) ? { ok: true, value: raw } : { ok: false, error: "The value is not a valid date" };
    case "datetime":
      return !Number.isNaN(Date.parse(raw))
        ? { ok: true, value: raw }
        : { ok: false, error: "The value is not a valid date and time" };
    default:
      return { ok: true, value: raw };
  }
}

/** A valid ISO calendar date (`YYYY-MM-DD` that resolves to a real day). */
function isValidDate(raw: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw));
}

/** The timestamp of a date / datetime cell value (the `before` / `after`
 *  comparison); null when it is not a parseable date. */
function timestampOf(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? null : t;
}

/** Evaluates one filter condition against a cell value. */
function conditionMatches(op: string, value: unknown, expected: unknown): boolean {
  const hasValue = value !== undefined && value !== null && value !== "";
  switch (op) {
    case "is":
      if (expected === undefined || expected === null || expected === "") return !hasValue;
      return equalsLoose(value, expected);
    case "is not":
      if (expected === undefined || expected === null || expected === "") return hasValue;
      return !equalsLoose(value, expected);
    case "contains":
      return stringOf(value).includes(stringOf(expected));
    case "not contains":
      return !stringOf(value).includes(stringOf(expected));
    case "starts with":
      return stringOf(value).startsWith(stringOf(expected));
    case "ends with":
      return stringOf(value).endsWith(stringOf(expected));
    case "empty":
      return !hasValue;
    case "not empty":
      return hasValue;
    case "<":
      return numberOr(value) < numberOr(expected);
    case "<=":
      return numberOr(value) <= numberOr(expected);
    case ">":
      return numberOr(value) > numberOr(expected);
    case ">=":
      return numberOr(value) >= numberOr(expected);
    case "between":
      return between(value, expected);
    case "before": {
      const a = timestampOf(value);
      const b = timestampOf(expected);
      if (a !== null && b !== null) return a < b;
      return stringOf(value) < stringOf(expected);
    }
    case "after": {
      const a = timestampOf(value);
      const b = timestampOf(expected);
      if (a !== null && b !== null) return a > b;
      return stringOf(value) > stringOf(expected);
    }
    case "in": {
      const list = Array.isArray(expected) ? expected.map(stringOf) : [stringOf(expected)];
      return list.includes(stringOf(value));
    }
    case "not in": {
      const list = Array.isArray(expected) ? expected.map(stringOf) : [stringOf(expected)];
      return !list.includes(stringOf(value));
    }
    default:
      // An unknown operator never matches (the bridge declares its
      // catalog; the filter UI offers only the declared ones).
      return false;
  }
}

function equalsLoose(a: unknown, b: unknown): boolean {
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  if (typeof a === "number" || typeof b === "number") return numberOr(a) === numberOr(b);
  return stringOf(a) === stringOf(b);
}

function stringOf(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function numberOr(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isNaN(parsed) ? -Infinity : parsed;
}

/** `between`: the expected is a two-item [low, high] pair. */
function between(value: unknown, expected: unknown): boolean {
  const pair = Array.isArray(expected) ? expected : [expected, expected];
  const num = numberOr(value);
  return num >= numberOr(pair[0]) && num <= numberOr(pair[1]);
}

export { VALUELESS_OPERATORS, columnAnnotation, conditionMatches, parseCellValue };
export type {
  BridgeColumn,
  BridgeColumnAnnotation,
  BridgeTableDescription,
  BridgeValueInput,
  CellValueParse,
  DatabaseBridge,
  RowPage,
  RowQuery,
  TableEvent,
  TableRef,
};
