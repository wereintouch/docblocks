/**
 * The DatabaseBridge contract's types: the column / table / row shapes, the
 * live table events, the bridge interface itself, and the cell annotation +
 * parse result types the filter builder and the cell editor render from.
 */
import type { DatabaseFilterPayload } from "docblocks-core";

/**
 * A bridge column. The `type` is a standard PostgreSQL type name (or the
 * consumer's own name): the contract is type-agnostic — the package does
 * not validate the set; the consumer maps type → DDL and type → cell
 * editor. `operators` is the consumer's operator catalog override; when absent,
 * the package's default catalog for the type stands (§ the filter
 * builders), and `queryRows` must apply exactly the declared operators.
 * The `decimals` / `thousands` / `prefix` / `suffix` / `allowNegative`
 * fields are the number column's display attributes (the column's own
 * data — the package's number formatter reads them; the consumer's
 * backend maps the column to integer / decimal as it stands).
 * The reference fields declare a RELATION over the plain column:
 * `refKind "enum"` — the cell value is an option of the dict table
 * (`refTableId`); the dict table's PK IS the option label (the option
 * rename stands the consumer backend's PK update); `refKind "row"` — the
 * cell value is the linked table's row id (`refDisplayColumn` declares
 * which column of the linked table stands the display; the default is
 * the first text column / the pk). `refMany` is the many cardinality
 * (the cell value is an ARRAY of the option labels / the row ids; the
 * consumer maps the array to a junction table behind the `updateRow`).
 */
interface BridgeColumn {
  id: string;
  name: string;
  type: string;
  operators?: string[];
  /** The reference table (the dict table for the enum options / the
   *  linked table for the row links). */
  refTableId?: string;
  /** The reference kind: "enum" (the dict table's rows are the options)
   *  or "row" (the cell holds the linked row's row id). */
  refKind?: "enum" | "row";
  /** The many cardinality (the cell value is an array). */
  refMany?: boolean;
  /** The display column of the linked table (the row-link display; the
   *  default is the first text column / the pk). */
  refDisplayColumn?: string;
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
  | { type: "table.created"; tableId: string; name: string; columns: BridgeColumn[]; system?: boolean }
  | { type: "row.created"; rowId: string; cells: Record<string, unknown> }
  | { type: "row.updated"; rowId: string; cells: Record<string, unknown>; before?: Record<string, unknown> }
  | { type: "row.removed"; rowId: string }
  | { type: "row.moved"; rowId: string; beforeRowId: string | null }
  // The soft-delete restore (the `undeleteRows`'s stand — the idempotent re-
  // publication of the row). Carries the cells and the original fractional
  // position, so the restore lands at the row's previous seat on every client.
  | { type: "row.restored"; rowId: string; cells: Record<string, unknown>; orderValue: number }
  | { type: "schema.changed"; columns: BridgeColumn[] }
  | { type: "table.renamed"; name: string };

/**
 * The bridge contract (all methods async; errors reject — the package
 * neither swallows nor retries). `subscribeTable` is the only push
 * channel (the consumer's transport: WS / SSE / long-polling / polling
 * with the same event shape) and returns the unsubscribe.
 */
interface DatabaseBridge {
  /** The table catalog (the consumer's visible tables — the system
   *  tables, created over `createTable` with the `system` flag, stand
   *  excluded; their schema / rows stay reachable by id). */
  listTables(): Promise<TableRef[]>;
  /** Create a table by name → its id (created EMPTY — the schema is filled by the createColumn calls). The `system` flag marks the hidden table (absent from `listTables` — the enum's options' stand). The optional `id` fixes the table's identity independently of the name (the restore / import stand: a consumer that persists tables restores them under their original id, so the doc's `tableId` references survive a rename; absent, the id stands the name's deterministic slug). */
  createTable(name: string, options?: { system?: boolean; id?: string }): Promise<string>;
  /** Rename the table (the name stands on the table, shared by every block
   *  that references it). */
  renameTable(tableId: string, name: string): Promise<void>;
  /** The table schema + the pk / order column metadata. */
  describeTable(tableId: string): Promise<BridgeTableDescription>;
  /** Add a column (after `afterColumnId`, or at the end). */
  createColumn(tableId: string, column: BridgeColumn, afterColumnId?: string): Promise<void>;
  /** Update the column's attributes (the patch over the existing column —
   *  the name stands the `renameColumn`'s domain; the patch never
   *  removes an attribute, the undefined entries stand skipped). */
  updateColumn(tableId: string, columnId: string, patch: Partial<Omit<BridgeColumn, "id" | "name">>): Promise<void>;
  /** Resolve the row displays for the row-link cells (the join stands in
   *  the consumer backend; `displayColumn` = the column's declared
   *  display column, else the first text column / the pk). */
  resolveRowDisplay(tableId: string, rowIds: string[], displayColumn?: string): Promise<Record<string, string>>;
  /** Remove a column. The consumer MAY stand the soft-delete posture:
   *  keep the column's cell values (and its definition) so the removal
   *  can be restored via `restoreDeletedColumn`; the destructing posture
   *  (the values are destroyed) stands the no-`restoreDeletedColumn`
   *  bridge (the removal is then not undoable). */
  deleteColumn(tableId: string, columnId: string): Promise<void>;
  /** Restore a deleted column — its schema, its column position, and the
   *  cell values the soft-delete `deleteColumn` preserved. Only present
   *  when the consumer's `deleteColumn` preserves the column's data; when
   *  absent, a column removal is NOT undoable (it never enters the undo
   *  stack). A no-op when the column stands in the schema again (it was
   *  re-created over the detached data — the old data was dropped). */
  restoreDeletedColumn?(tableId: string, columnId: string): Promise<void>;
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
type BridgeValueInput = "text" | "number" | "boolean" | "date" | "datetime" | "enum" | "row-link" | "none";

/** The column annotation the filter builder renders from. */
interface BridgeColumnAnnotation {
  /** The operator catalog (the consumer's `operators` override or the package default for the type). */
  operators: string[];
  /** The value input kind (none = no value is taken: empty / not-empty). */
  valueInput: BridgeValueInput;
  /** Whether the operators take no value (empty / not-empty). */
  valueless: Set<string>;
}

/**
 * The parse result of a typed cell / filter value: the committed value
 * (`null` for the empty string) or the validation error (the input is not
 * committed — the editor keeps / reverts to the last valid value).
 */
type CellValueParse = { ok: true; value: unknown } | { ok: false; error: string };

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
