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
 */
interface BridgeColumn {
  id: string;
  name: string;
  type: string;
  options?: string[];
  operators?: string[];
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
  | { type: "schema.changed"; columns: BridgeColumn[] };

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
type BridgeValueInput = "text" | "number" | "boolean" | "date" | "select" | "none";

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

/** The package's default operator catalogs per PostgreSQL type name. */
const TYPE_OPERATORS: Record<string, string[]> = {
  text: ["is", "is not", "contains", "not contains", "starts with", "ends with", "empty", "not empty"],
  varchar: ["is", "is not", "contains", "not contains", "starts with", "ends with", "empty", "not empty"],
  char: ["is", "is not", "contains", "not contains", "starts with", "ends with", "empty", "not empty"],
  integer: ["is", "is not", "<", "<=", ">", ">=", "between"],
  bigint: ["is", "is not", "<", "<=", ">", ">=", "between"],
  smallint: ["is", "is not", "<", "<=", ">", ">=", "between"],
  numeric: ["is", "is not", "<", "<=", ">", ">=", "between"],
  real: ["is", "is not", "<", "<=", ">", ">=", "between"],
  "double precision": ["is", "is not", "<", "<=", ">", ">=", "between"],
  boolean: ["is", "is not"],
  date: ["is", "before", "after", "between"],
  timestamp: ["is", "before", "after", "between"],
  timestamptz: ["is", "before", "after", "between"],
};

/** The value input kind per PostgreSQL type name. */
const TYPE_VALUE_INPUTS: Record<string, BridgeValueInput> = {
  text: "text",
  varchar: "text",
  char: "text",
  integer: "number",
  bigint: "number",
  smallint: "number",
  numeric: "number",
  real: "number",
  "double precision": "number",
  boolean: "boolean",
  date: "date",
  timestamp: "date",
  timestamptz: "date",
};

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
    operators = TYPE_OPERATORS[column.type] ?? ["is", "is not"];
  }
  let valueInput: BridgeValueInput;
  if (column.options !== undefined) valueInput = "select";
  else valueInput = TYPE_VALUE_INPUTS[column.type] ?? "text";
  const valueless = new Set(operators.filter((operator) => VALUELESS_OPERATORS.has(operator)));
  return { operators, valueInput, valueless };
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
    case "before":
      return stringOf(value) < stringOf(expected);
    case "after":
      return stringOf(value) > stringOf(expected);
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

export { VALUELESS_OPERATORS, columnAnnotation, conditionMatches };
export type {
  BridgeColumn,
  BridgeColumnAnnotation,
  BridgeTableDescription,
  BridgeValueInput,
  DatabaseBridge,
  RowPage,
  RowQuery,
  TableEvent,
  TableRef,
};
