/**
 * The in-memory reference bridge: a single-process `DatabaseBridge`
 * that demonstrates the normative contract end to end — the
 * snapshot → subscribe(`afterSeq = R`) → replay → live bootstrap, the
 * append-only per-table envelope stream (one committed transaction → one
 * `seq` / `prevSeq`, the replay gap is the envelope's absence), the
 * structured errors, the idempotent writes, and the atomic mixed batch with
 * the order-key allocation + the in-transaction rebalance.
 *
 * The contract stands this implementation pins:
 * - `snapshotTable` is the sole initial read; its `page.asOfSeq` is the `R`
 *  both the schema and the page represent. `queryNextPage` only follows the
 *  opaque cursor bound to `R` + the query fingerprint; any commit that
 *  advanced the table's public head after `R` rejects with `cursor_expired`.
 * - the envelope is appended to the outbox BEFORE the live notification —
 *  the subscriber never sees an event it cannot replay.
 * - the `commit` and the `invalidate` envelopes both stand the explicit
 *  rebaseline: the caller takes a fresh snapshot (the in-place refill is
 *  not a stand).
 * - idempotency: the same `operationId` + the same canonical body returns
 *  the stored receipt without a second effect; the same id with a different
 *  body rejects with `idempotency_conflict`; an id past the retention
 *  horizon rejects with `idempotency_expired` and is never re-executed.
 * - `batchRows` is one atomic operation: every op is validated before any
 *  mutation lands, and a failure restores the pre-batch state (no partial
 *  envelope). The first unexecutable op carries its `ops[i]` path.
 * - the order key allocation follows the normative candidates (head = the
 *  right bound − 1, middle = the mean, tail = the left bound + 1); a
 *  collapse / occupancy triggers the full baseline rebalance within the
 *  same transaction — the order is rewritten, the op is written exactly
 *  once, and the batch publishes one `invalidate` envelope instead of the
 *  row frames (the canonical receipt still stands).
 * - soft delete: the tombstone (the `deletedAt` stamp) keeps the row's
 *  cells; `gcTable` is the reference stand of the consumer-side GC — it is
 *  invisible (no envelope, no head advance), and a restore of a GC'd row
 *  stands the safe `not_found`.
 * - the cell value is the single source of truth: no denormalized display
 *  fields exist in the bridge's state.
 */
import { TEXT_TYPES, columnAnnotation, conditionMatches } from "../bridge";
import type { BridgeColumn } from "../bridge";
import { BridgeError, toBridgeError } from "../bridge";
import type {
  BatchOp,
  BridgeErrorCode,
  Column,
  DatabaseBridge,
  DomainEvent,
  FilterInput,
  MutationContext,
  MutationReceipt,
  OperationStatus,
  PageQuery,
  PageSnapshot,
  ProtocolDescriptor,
  QueryOperator,
  QuerySemantics,
  RowWire,
  SortInput,
  SubscriptionHandle,
  SubscriptionObserver,
  TableDescription,
  TableEvent,
  TableRef,
  TableSnapshot,
} from "../bridge";
import {
  DEFAULT_LIMIT,
  DEFAULT_OPERATION_RETENTION_SECONDS,
  DEFAULT_REPLAY_WINDOW,
  DEFAULT_RETRY_HORIZON_SECONDS,
  DEFAULT_TOMBSTONE_RETENTION_MS,
  MAX_BATCH_OPS,
  MAX_FILTER_DEPTH,
  MAX_FILTER_TERMS,
  MAX_FRAME_BYTES,
  MAX_PAGE_SIZE,
  MAX_REQUEST_BYTES,
  MAX_SUBSCRIPTIONS,
  PROTOCOL_CAPABILITIES,
  SEMANTICS_COLLATION,
  SEMANTICS_NULL_ORDERING,
  SEMANTICS_TIMEZONE,
  SEMANTICS_VERSION,
} from "./constants";
import type { MemoryBridgeOptions, MemoryIdempotencyEntry, MemoryRow, MemoryTable } from "./models";
import { canonicalJson, decodeCursor, deepEqual, encodeCursor, fnv1aHex, physicalCompare, tableIdFor } from "./utils";

/** The reference bridge's public surface (the contract + the GC test stand). */
interface MemoryDatabaseBridge extends DatabaseBridge {
  /** The reference stand of the consumer-side tombstone GC: drops the rows
   *  past the `tombstoneRetentionMs`. Invisible — no envelope, no head
   *  advance; the public stream stands unchanged. */
  gcTable(tableId: string): void;
}

function createMemoryDatabaseBridge(options: MemoryBridgeOptions = {}): MemoryDatabaseBridge {
  const operationRetentionSeconds = options.operationRetentionSeconds ?? DEFAULT_OPERATION_RETENTION_SECONDS;
  const operationRetentionMs = operationRetentionSeconds * 1000;
  const retryHorizonSeconds = options.retryHorizonSeconds ?? DEFAULT_RETRY_HORIZON_SECONDS;
  const tombstoneRetentionMs = options.tombstoneRetentionMs ?? DEFAULT_TOMBSTONE_RETENTION_MS;
  const replayWindow = options.replayWindow ?? DEFAULT_REPLAY_WINDOW;

  const tables = new Map<string, MemoryTable>();
  const subscribers = new Map<string, Set<SubscriptionObserver>>();
  const idempotency = new Map<string, MemoryIdempotencyEntry>();
  /** The instance's session id (the envelope's `originSessionId` stand —
   *  the per-connection id the consumer assigns). */
  const originSessionId = `session-${Math.random().toString(36).slice(2, 10)}`;

  const descriptor: ProtocolDescriptor = {
    protocolVersion: 2,
    capabilities: PROTOCOL_CAPABILITIES,
    limits: {
      maxFilterDepth: MAX_FILTER_DEPTH,
      maxFilterTerms: MAX_FILTER_TERMS,
      maxPageSize: MAX_PAGE_SIZE,
      maxBatchOps: MAX_BATCH_OPS,
      maxRequestBytes: MAX_REQUEST_BYTES,
      maxFrameBytes: MAX_FRAME_BYTES,
      maxSubscriptions: MAX_SUBSCRIPTIONS,
    },
    operationRetentionSeconds,
    retryHorizonSeconds,
  };

  // ---------- the basics ----------

  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function nextRevision(table: MemoryTable): string {
    table.revisionCounter += 1;
    return `rev-${table.revisionCounter}`;
  }

  function newTxId(): string {
    return `tx-${Math.random().toString(36).slice(2, 12)}`;
  }

  function tableRefOf(table: MemoryTable): TableRef {
    return {
      id: table.id,
      name: table.name,
      revision: table.revision,
      ...(table.system ? { system: true } : {}),
    };
  }

  function rowWireOf(row: MemoryRow): RowWire {
    return { id: row.id, orderKey: row.orderKey, revision: row.revision, cells: clone(row.cells) };
  }

  /** The retained physical order (the live + the tombstoned rows) sorted by
   *  `(orderKey, id)`. */
  function physicalOrder(table: MemoryTable): MemoryRow[] {
    return [...table.rows].sort((a, b) => physicalCompare(a, b));
  }

  function liveRows(table: MemoryTable): MemoryRow[] {
    return physicalOrder(table).filter((row) => row.deletedAt === null);
  }

  function liveRowOf(table: MemoryTable, rowId: string): MemoryRow | undefined {
    return table.rows.find((row) => row.id === rowId && row.deletedAt === null);
  }

  function tableOf(tableId: string): MemoryTable {
    const table = tables.get(tableId);
    if (table === undefined) throw new BridgeError("not_found", `The table "${tableId}" is unknown.`);
    return table;
  }

  // ---------- the stream ----------

  /** The live delivery (the outbox was already appended — the replay
   *  coverage of a delivered event always holds). */
  function notify(tableId: string, envelope: TableEvent): void {
    const set = subscribers.get(tableId);
    if (set === undefined) return;
    for (const observer of [...set]) observer.event(clone(envelope));
  }

  /** One committed transaction → one outer envelope (the `commit` kind
   *  with the ordered nested events, or the `invalidate` kind when the
   *  rebalance rewrote the order keys). The receipt stands in both. */
  function publish<T>(
    table: MemoryTable,
    operationId: string,
    result: T,
    revisions: Record<string, string>,
    events: DomainEvent[],
    rebalanced = false
  ): MutationReceipt<T> {
    table.headSeq += 1;
    const seq = table.headSeq;
    const previous = table.envelopes[table.envelopes.length - 1];
    const txId = newTxId();
    const receipt: MutationReceipt<T> = {
      operationId,
      txId,
      committedSeq: seq,
      result: clone(result),
      revisions: clone(revisions),
    };
    const base = {
      tableId: table.id,
      seq,
      prevSeq: previous !== undefined ? previous.seq : null,
      txId,
    };
    const envelope: TableEvent = rebalanced
      ? {
          ...base,
          kind: "invalidate" as const,
          originSessionId,
          operationId,
          receipt: receipt as MutationReceipt<unknown>,
          events: [],
        }
      : {
          ...base,
          kind: "commit" as const,
          originSessionId,
          operationId,
          receipt: receipt as MutationReceipt<unknown>,
          events: clone(events),
        };
    table.envelopes.push(envelope);
    notify(table.id, envelope);
    return receipt;
  }

  /** The no-op mutation's receipt (no envelope, no head advance): the
   *  commit sequence stands the table's current head. */
  function noOpReceipt<T>(ctx: MutationContext, table: MemoryTable, result: T): MutationReceipt<T> {
    return {
      operationId: ctx.operationId,
      txId: newTxId(),
      committedSeq: table.headSeq,
      result: clone(result),
      revisions: {},
    };
  }

  // ---------- the idempotency ----------

  /** The same operation id + the same canonical body → the stored receipt
   *  (never a second effect); the same id with a different body →
   *  `idempotency_conflict`; past the retention → `idempotency_expired`
   *  (never re-executed). */
  function idempotent<T>(
    ctx: MutationContext,
    fingerprint: string,
    execute: () => MutationReceipt<T>
  ): MutationReceipt<T> {
    const entry = idempotency.get(ctx.operationId);
    if (entry !== undefined) {
      // The expiry is sticky (the tombstone stand): an id past the horizon
      // is never re-executed — the entry stands (a deleted entry would let
      // a later retry re-execute the operation), the receipt drops.
      if (entry.receipt === null || Date.now() - entry.committedAt > operationRetentionMs) {
        entry.receipt = null;
        throw new BridgeError(
          "idempotency_expired",
          `The operation "${ctx.operationId}" is outside the retention horizon and is never re-executed.`
        );
      }
      if (entry.fingerprint !== fingerprint) {
        throw new BridgeError(
          "idempotency_conflict",
          `The operation "${ctx.operationId}" was committed with a different body.`
        );
      }
      return entry.receipt as MutationReceipt<T>;
    }
    const receipt = execute();
    idempotency.set(ctx.operationId, {
      fingerprint,
      receipt: receipt as MutationReceipt<unknown>,
      committedAt: Date.now(),
    });
    return receipt;
  }

  function fingerprintOf(kind: string, payload: Record<string, unknown>): string {
    return `fnv1a-${fnv1aHex(canonicalJson({ kind, ...payload }))}`;
  }

  // ---------- the query validation + evaluation ----------

  /** The column's effective operator catalog (the consumer's `operators`
   *  override, else the option catalog for the reference columns, else the
   *  type's default — */
  function columnAsBridge(column: Column): BridgeColumn {
    const bridge: BridgeColumn = {
      id: column.id,
      name: column.name,
      type: column.type,
      ...(column.operators !== undefined ? { operators: [...column.operators] } : {}),
      ...(column.reference !== undefined
        ? {
            refKind: column.reference.kind,
            refTableId: column.reference.tableId,
            refMany: column.reference.many,
            ...(column.reference.displayColumnId !== undefined
              ? { refDisplayColumn: column.reference.displayColumnId }
              : {}),
          }
        : {}),
    };
    return bridge;
  }

  function validateFilter(table: MemoryTable, filter: FilterInput, depth = 0, terms = { count: 0 }): void {
    if (depth > MAX_FILTER_DEPTH)
      throw new BridgeError("limit_exceeded", `The filter depth exceeds ${MAX_FILTER_DEPTH}.`);
    if (typeof filter !== "object" || filter === null || Array.isArray(filter)) {
      throw new BridgeError("invalid_filter", "The filter must be a plain object.");
    }
    if (filter.logic !== "and" && filter.logic !== "or") {
      throw new BridgeError("invalid_filter", 'The filter logic must be "and" or "or".');
    }
    if (!Array.isArray(filter.conditions))
      throw new BridgeError("invalid_filter", "The filter conditions must be an array.");
    for (const condition of filter.conditions) {
      terms.count += 1;
      if (terms.count > MAX_FILTER_TERMS) {
        throw new BridgeError("limit_exceeded", `The filter terms exceed ${MAX_FILTER_TERMS}.`);
      }
      if (typeof condition !== "object" || condition === null || Array.isArray(condition)) {
        throw new BridgeError("invalid_filter", "A filter condition must be a plain object.");
      }
      if (typeof condition.columnId !== "string" || typeof condition.op !== "string") {
        throw new BridgeError("invalid_filter", "A filter condition requires the columnId and the operator.");
      }
      const column = table.columns.find((entry) => entry.id === condition.columnId);
      if (column === undefined) {
        throw new BridgeError("invalid_column", `The filter references the unknown column "${condition.columnId}".`);
      }
      const annotation = columnAnnotation(columnAsBridge(column));
      if (!annotation.operators.includes(condition.op)) {
        throw new BridgeError(
          "invalid_operator",
          `The operator "${condition.op}" is not declared for the column type "${column.type}".`
        );
      }
      if (annotation.valueless.has(condition.op) && condition.value !== undefined) {
        throw new BridgeError("invalid_filter", `The operator "${condition.op}" takes no value.`);
      }
    }
    for (const group of filter.groups ?? []) validateFilter(table, group, depth + 1, terms);
  }

  function validateSort(table: MemoryTable, sort: SortInput): void {
    for (const key of sort) {
      if (typeof key?.fieldId !== "string" || (key.direction !== "asc" && key.direction !== "desc")) {
        throw new BridgeError("invalid_filter", "A sort key requires the fieldId and the direction.");
      }
      if (!table.columns.some((column) => column.id === key.fieldId)) {
        throw new BridgeError("invalid_column", `The sort references the unknown column "${key.fieldId}".`);
      }
    }
  }

  function validateQuery(table: MemoryTable, query: PageQuery): void {
    if (query.filter !== undefined) validateFilter(table, query.filter);
    if (query.sort !== undefined) validateSort(table, query.sort);
    if (
      query.limit !== undefined &&
      (!Number.isInteger(query.limit) || query.limit <= 0 || query.limit > MAX_PAGE_SIZE)
    ) {
      throw new BridgeError("limit_exceeded", `The page limit must be an integer in 1..${MAX_PAGE_SIZE}.`);
    }
  }

  function filterMatches(filter: FilterInput, cells: Record<string, unknown>): boolean {
    const conditionResults = filter.conditions.map((condition) =>
      conditionMatches(condition.op, cells[condition.columnId], condition.value)
    );
    const groupResults = (filter.groups ?? []).map((group) => filterMatches(group, cells));
    const all = [...conditionResults, ...groupResults];
    return filter.logic === "and" ? all.every(Boolean) : all.some(Boolean);
  }

  function compareSortKey(
    key: { fieldId: string; direction: "asc" | "desc"; nulls?: "first" | "last" },
    a: Record<string, unknown>,
    b: Record<string, unknown>
  ): number {
    const va = a[key.fieldId];
    const vb = b[key.fieldId];
    const aNull = va === undefined || va === null;
    const bNull = vb === undefined || vb === null;
    if (aNull || bNull) {
      if (aNull === bNull) return 0;
      const nullFirst = key.nulls ?? SEMANTICS_NULL_ORDERING;
      return aNull ? (nullFirst === "first" ? -1 : 1) : nullFirst === "first" ? 1 : -1;
    }
    let result: number;
    if (typeof va === "number" && typeof vb === "number") result = va - vb;
    else if (typeof va === "boolean" && typeof vb === "boolean") result = Number(va) - Number(vb);
    else {
      const sa = String(va);
      const sb = String(vb);
      result = sa < sb ? -1 : sa > sb ? 1 : 0;
    }
    return key.direction === "desc" ? -result : result;
  }

  /** The filtered + sorted visible rows (the input order stands the
   *  physical order; the sort tie-break keeps it). */
  function orderedQueryRows(
    table: MemoryTable,
    filter: FilterInput | undefined,
    sort: SortInput | undefined
  ): MemoryRow[] {
    let rows = liveRows(table);
    if (filter !== undefined) rows = rows.filter((row) => filterMatches(filter, row.cells));
    if (sort !== undefined && sort.length > 0) {
      rows = [...rows].sort((a, b) => {
        for (const key of sort) {
          const result = compareSortKey(key, a.cells, b.cells);
          if (result !== 0) return result;
        }
        return physicalCompare(a, b);
      });
    }
    return rows;
  }

  // ---------- the query fingerprint + the semantics ----------

  /** The server's signed canonical form: the hash of the canonical query
   *  together with the table, the snapshot boundary, the schema revision
   *  and the declared semantics (the client never constructs one). */
  function queryFingerprint(
    table: MemoryTable,
    R: number,
    filter: FilterInput | undefined,
    sort: SortInput | undefined,
    limit: number
  ): string {
    return `fp-${fnv1aHex(
      canonicalJson({
        tableId: table.id,
        R,
        schemaRevision: table.schemaRevision,
        filter:
          filter === undefined
            ? null
            : { logic: filter.logic, conditions: filter.conditions, groups: filter.groups ?? [] },
        sort: sort ?? null,
        limit,
        semanticsVersion: SEMANTICS_VERSION,
        collation: SEMANTICS_COLLATION,
        nullOrdering: SEMANTICS_NULL_ORDERING,
      })
    )}`;
  }

  function semanticsOf(table: MemoryTable): QuerySemantics {
    const operatorsByColumnType: Record<string, QueryOperator[]> = {};
    for (const type of [...new Set(table.columns.map((column) => column.type))]) {
      const column = table.columns.find((entry) => entry.type === type);
      if (column === undefined) continue;
      const bridge = columnAsBridge(column);
      const annotation = columnAnnotation(bridge);
      operatorsByColumnType[type] = annotation.operators.map((op) => ({
        id: op,
        valueKind: annotation.valueless.has(op) ? "none" : bridge.refMany ? "list" : "scalar",
      }));
    }
    return {
      semanticsVersion: SEMANTICS_VERSION,
      collation: SEMANTICS_COLLATION,
      timezone: SEMANTICS_TIMEZONE,
      nullOrdering: SEMANTICS_NULL_ORDERING,
      operatorsByColumnType,
    };
  }

  // ---------- the page cursor ----------

  function buildCursor(
    table: MemoryTable,
    R: number,
    filter: FilterInput | undefined,
    sort: SortInput | undefined,
    limit: number,
    afterRow: MemoryRow | null
  ): string {
    return encodeCursor({
      tableId: table.id,
      R,
      fp: queryFingerprint(table, R, filter, sort, limit),
      filter: filter ?? null,
      sort: sort ?? null,
      limit,
      afterOrderKey: afterRow === null ? null : afterRow.orderKey,
      afterRowId: afterRow === null ? null : afterRow.id,
    });
  }

  // ---------- the column schema ----------

  function reindexColumns(table: MemoryTable): void {
    table.columns.forEach((column, index) => {
      column.position = index;
    });
  }

  function validateColumnSpec(table: MemoryTable, spec: Omit<Column, "id" | "revision">): void {
    if (typeof spec?.name !== "string" || spec.name.trim() === "") {
      throw new BridgeError("validation", "The column name must be a non-empty string.");
    }
    if (typeof spec?.type !== "string" || spec.type === "") {
      throw new BridgeError("validation", "The column type must be a non-empty string.");
    }
    if (typeof spec.position !== "number" || !Number.isInteger(spec.position) || spec.position < 0) {
      throw new BridgeError("validation", "The column position must be a non-negative integer.");
    }
    if (typeof spec.nullable !== "boolean")
      throw new BridgeError("validation", "The column nullability must be a boolean.");
    if (spec.operators !== undefined && !spec.operators.every((op) => typeof op === "string")) {
      throw new BridgeError("validation", "The column operators must be strings.");
    }
    const reference = spec.reference;
    if (reference !== undefined) {
      if (reference.kind !== "enum" && reference.kind !== "row") {
        throw new BridgeError("validation", 'The column reference kind must be "enum" or "row".');
      }
      if (typeof reference.many !== "boolean") {
        throw new BridgeError("validation", "The column reference cardinality must be a boolean.");
      }
      const linked = tables.get(reference.tableId);
      if (linked === undefined) {
        throw new BridgeError("not_found", `The referenced table "${reference.tableId}" is unknown.`);
      }
      if (
        reference.displayColumnId !== undefined &&
        !linked.columns.some((column) => column.id === reference.displayColumnId)
      ) {
        throw new BridgeError(
          "invalid_column",
          `The reference display column "${reference.displayColumnId}" is unknown in the linked table.`
        );
      }
    }
    if (spec.numberDisplay !== undefined) {
      const display = spec.numberDisplay;
      if (
        display.decimals !== undefined &&
        (typeof display.decimals !== "number" || !Number.isInteger(display.decimals) || display.decimals < 0)
      ) {
        throw new BridgeError("validation", "The number display decimals must be a non-negative integer.");
      }
      for (const key of ["thousands", "allowNegative"] as const) {
        if (display[key] !== undefined && typeof display[key] !== "boolean") {
          throw new BridgeError("validation", `The number display ${key} must be a boolean.`);
        }
      }
      for (const key of ["prefix", "suffix"] as const) {
        if (display[key] !== undefined && typeof display[key] !== "string") {
          throw new BridgeError("validation", `The number display ${key} must be a string.`);
        }
      }
    }
  }

  // ---------- the row batch ----------

  interface TableCheckpoint {
    revision: string;
    columns: Column[];
    detachedColumns: Column[];
    rows: MemoryRow[];
    headSeq: number;
    envelopes: TableEvent[];
    schemaRevision: string;
    revisionCounter: number;
    nextRowSeq: number;
    nextColumnSeq: number;
  }

  function cloneTableCheckpoint(table: MemoryTable): TableCheckpoint {
    return clone({
      revision: table.revision,
      columns: table.columns,
      detachedColumns: table.detachedColumns,
      rows: table.rows,
      headSeq: table.headSeq,
      envelopes: table.envelopes,
      schemaRevision: table.schemaRevision,
      revisionCounter: table.revisionCounter,
      nextRowSeq: table.nextRowSeq,
      nextColumnSeq: table.nextColumnSeq,
    });
  }

  function restoreTableCheckpoint(table: MemoryTable, checkpoint: TableCheckpoint): void {
    table.revision = checkpoint.revision;
    table.columns = checkpoint.columns;
    table.detachedColumns = checkpoint.detachedColumns;
    table.rows = checkpoint.rows;
    table.headSeq = checkpoint.headSeq;
    table.envelopes = checkpoint.envelopes;
    table.schemaRevision = checkpoint.schemaRevision;
    table.revisionCounter = checkpoint.revisionCounter;
    table.nextRowSeq = checkpoint.nextRowSeq;
    table.nextColumnSeq = checkpoint.nextColumnSeq;
  }

  /** The cell keys against the schema + the value stands (the unknown
   *  column, the null into the non-nullable, the non-scalar into the
   *  plain column, the non-array into the many reference). */
  function validateCells(
    table: MemoryTable,
    cells: Record<string, unknown>,
    fail: (code: BridgeErrorCode, message: string) => never
  ): void {
    for (const [fieldId, value] of Object.entries(cells)) {
      const column = table.columns.find((entry) => entry.id === fieldId);
      if (column === undefined) fail("invalid_column", `The cell references the unknown column "${fieldId}".`);
      if (value === null && !column.nullable) fail("validation", `The column "${column.name}" is not nullable.`);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        fail("validation", `The column "${column.name}" holds scalar values (or an id array for a many reference).`);
      }
      if (column.reference !== undefined && column.reference.many && value !== null && !Array.isArray(value)) {
        fail("validation", `The column "${column.name}" is a many reference and holds an id array.`);
      }
    }
  }

  function assertCas(
    current: string,
    expected: string | undefined,
    fail: (code: BridgeErrorCode, message: string) => never,
    what: string
  ): void {
    if (expected !== undefined && expected !== current) {
      fail("conflict", `The expected revision of ${what} is stale (expected "${expected}", current "${current}").`);
    }
  }

  /** The enum option's live-reference guard: the delete of an option row
   *  a live cell of a `kind: "enum"` column references (the scalar match
   *  or the many array's membership) stands the default refusal — the
   *  explicit replacement migration is the consumer's separate operation,
   *  never a plain delete. */
  function assertNoLiveEnumOptionReference(
    source: MemoryTable,
    rowId: string,
    fail: (code: BridgeErrorCode, message: string) => never
  ): void {
    for (const other of tables.values()) {
      for (const column of other.columns) {
        const reference = column.reference;
        if (reference === undefined || reference.kind !== "enum" || reference.tableId !== source.id) continue;
        for (const row of liveRows(other)) {
          const value = row.cells[column.id];
          const referenced = value === rowId || (Array.isArray(value) && value.includes(rowId));
          if (referenced) {
            fail(
              "enum.option_in_use",
              `The enum option "${rowId}" is referenced by a live cell of table "${other.id}".`
            );
          }
        }
      }
    }
  }

  /** The order key allocation: the normative candidate for the (left,
   *  right) bounds — the right bound − 1 for the head, the mean for the
   *  middle, the left bound + 1 for the tail. The bounds read over the
   *  RETAINED rows (a tombstone between two live rows keeps its key), the
   *  anchor is a live row. A collapse / occupancy triggers the full
   *  baseline rebalance: the retained sequence is rewritten to the dense
   *  integers, the bounds are re-read, and the candidate is validated
   *  again — the original op is then written exactly once. */
  function allocateOrderKey(
    table: MemoryTable,
    beforeRowId: string | null,
    movingRowId: string | undefined,
    fail: (code: BridgeErrorCode, message: string) => never
  ): { key: number; rebalanced: boolean } {
    const bounds = (retained: MemoryRow[]): { left: MemoryRow | undefined; right: MemoryRow | undefined } => {
      const live = retained.filter((row) => row.deletedAt === null);
      if (beforeRowId === null) {
        return { left: retained[retained.length - 1], right: undefined };
      }
      const anchorIndex = live.findIndex((row) => row.id === beforeRowId);
      if (anchorIndex === -1) fail("not_found", `The anchor row "${beforeRowId}" is unknown or deleted.`);
      const anchor = live[anchorIndex]!;
      const retainedIndex = retained.findIndex((row) => row.id === anchor.id);
      return { left: retainedIndex > 0 ? retained[retainedIndex - 1] : undefined, right: anchor };
    };
    const candidate = (left: MemoryRow | undefined, right: MemoryRow | undefined): number =>
      right === undefined
        ? (left?.orderKey ?? 0) + 1
        : left === undefined
          ? right.orderKey - 1
          : left.orderKey + (right.orderKey - left.orderKey) / 2;
    const valid = (
      key: number,
      retained: MemoryRow[],
      left: MemoryRow | undefined,
      right: MemoryRow | undefined
    ): boolean => {
      if (!Number.isFinite(key)) return false;
      if (right === undefined) {
        if (left !== undefined && key <= left.orderKey) return false;
      } else if (left === undefined) {
        if (key >= right.orderKey) return false;
      } else if (key <= left.orderKey || key >= right.orderKey) {
        return false;
      }
      return !retained.some((row) => row.id !== movingRowId && row.orderKey === key);
    };
    const retained = physicalOrder(table);
    const { left, right } = bounds(retained);
    const key = candidate(left, right);
    if (valid(key, retained, left, right)) return { key, rebalanced: false };
    // The collapse / occupancy: the full baseline rebalance within the
    // same transaction.
    retained.forEach((row, index) => {
      row.orderKey = index + 1;
    });
    const retained2 = physicalOrder(table);
    const bounds2 = bounds(retained2);
    const rebalancedKey = candidate(bounds2.left, bounds2.right);
    if (!valid(rebalancedKey, retained2, bounds2.left, bounds2.right)) {
      fail("conflict", "The row order allocation is still invalid after the rebalance; the batch rolled back.");
    }
    return { key: rebalancedKey, rebalanced: true };
  }

  /** The move's no-op stand: the row is already the immediate predecessor
   *  of the anchor (or already at the requested tail / head) in the
   *  VISIBLE order. */
  function moveIsNoOp(table: MemoryTable, rowId: string, beforeRowId: string | null): boolean {
    const live = physicalOrder(table).filter((row) => row.deletedAt === null);
    if (beforeRowId === null) return live[live.length - 1]?.id === rowId;
    if (beforeRowId === rowId) return true;
    const index = live.findIndex((row) => row.id === rowId);
    if (index === -1) return false;
    return live[index + 1]?.id === beforeRowId;
  }

  function stripUndefinedCells(cells: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(cells)) {
      if (value !== undefined) out[key] = value;
    }
    return out;
  }

  // ---------- the display ----------

  function formatCellDisplay(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (Array.isArray(value)) {
      const parts = value.map((item) => formatCellDisplay(item)).filter((part): part is string => part !== null);
      return parts.length > 0 ? parts.join(", ") : null;
    }
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  // ---------- the bridge ----------

  const bridge: MemoryDatabaseBridge = {
    async describeProtocol(): Promise<ProtocolDescriptor> {
      return descriptor;
    },

    async listTables(): Promise<TableRef[]> {
      return [...tables.values()].filter((table) => !table.system).map(tableRefOf);
    },

    async createTable(
      input: { name: string; system?: boolean },
      ctx: MutationContext
    ): Promise<MutationReceipt<TableRef>> {
      const name = typeof input.name === "string" ? input.name : "";
      if (name.trim() === "") throw new BridgeError("validation", "The table name must be a non-empty string.");
      const fingerprint = fingerprintOf("createTable", { name, system: input.system === true });
      return idempotent(ctx, fingerprint, () => {
        const base = tableIdFor(name);
        let id = base;
        let suffix = 2;
        while (tables.has(id)) id = `${base}-${suffix++}`;
        const table: MemoryTable = {
          id,
          name,
          system: input.system === true,
          revision: "",
          columns: [],
          detachedColumns: [],
          rows: [],
          headSeq: 0,
          envelopes: [],
          schemaRevision: "",
          revisionCounter: 0,
          nextRowSeq: 0,
          nextColumnSeq: 0,
        };
        table.revision = nextRevision(table);
        table.schemaRevision = nextRevision(table);
        tables.set(id, table);
        const ref = tableRefOf(table);
        return publish(table, ctx.operationId, ref, { [id]: ref.revision }, [
          {
            type: "table.created",
            payload: { table: { table: ref, columns: [], schemaRevision: table.schemaRevision } },
          },
        ]);
      });
    },

    async renameTable(
      tableId: string,
      input: { name: string },
      ctx: MutationContext
    ): Promise<MutationReceipt<TableRef>> {
      const table = tableOf(tableId);
      const name = typeof input.name === "string" ? input.name : "";
      if (name.trim() === "") throw new BridgeError("validation", "The table name must be a non-empty string.");
      const fingerprint = fingerprintOf("renameTable", { tableId, name });
      return idempotent(ctx, fingerprint, () => {
        if (table.name === name) return noOpReceipt(ctx, table, tableRefOf(table));
        table.name = name;
        table.revision = nextRevision(table);
        const ref = tableRefOf(table);
        return publish(table, ctx.operationId, ref, { [tableId]: ref.revision }, [
          { type: "table.renamed", payload: { table: ref } },
        ]);
      });
    },

    async describeTable(tableId: string): Promise<TableDescription> {
      const table = tableOf(tableId);
      return { table: tableRefOf(table), columns: clone(table.columns), schemaRevision: table.schemaRevision };
    },

    async snapshotTable(tableId: string, query: PageQuery): Promise<TableSnapshot> {
      const table = tableOf(tableId);
      if (JSON.stringify(query ?? null).length > MAX_REQUEST_BYTES) {
        throw new BridgeError(
          "payload_too_large",
          `The query exceeds the request limit of ${MAX_REQUEST_BYTES} bytes.`
        );
      }
      validateQuery(table, query);
      const limit = query.limit ?? DEFAULT_LIMIT;
      const R = table.headSeq;
      const rows = orderedQueryRows(table, query.filter, query.sort);
      const pageRows = rows.slice(0, limit);
      return {
        table: tableRefOf(table),
        columns: clone(table.columns),
        schemaRevision: table.schemaRevision,
        page: {
          rows: pageRows.map(rowWireOf),
          nextCursor:
            pageRows.length > 0 && pageRows.length < rows.length
              ? buildCursor(table, R, query.filter, query.sort, limit, pageRows[pageRows.length - 1]!)
              : null,
          asOfSeq: R,
          schemaRevision: table.schemaRevision,
          queryFingerprint: queryFingerprint(table, R, query.filter, query.sort, limit),
          semantics: semanticsOf(table),
        },
      };
    },

    async queryNextPage(
      tableId: string,
      input: { cursor: string; asOfSeq: number; queryFingerprint: string }
    ): Promise<PageSnapshot> {
      const table = tableOf(tableId);
      const cursor = decodeCursor(input.cursor);
      if (
        cursor === null ||
        cursor.tableId !== tableId ||
        cursor.R !== input.asOfSeq ||
        input.asOfSeq !== table.headSeq ||
        cursor.fp !== input.queryFingerprint ||
        cursor.fp !==
          queryFingerprint(table, input.asOfSeq, cursor.filter ?? undefined, cursor.sort ?? undefined, cursor.limit)
      ) {
        throw new BridgeError(
          "cursor_expired",
          "The page cursor is stale, foreign, or bound to a different snapshot or query."
        );
      }
      const rows = orderedQueryRows(table, cursor.filter ?? undefined, cursor.sort ?? undefined);
      let start = 0;
      if (cursor.afterOrderKey !== null && cursor.afterRowId !== null) {
        const at = rows.findIndex((row) => row.orderKey === cursor.afterOrderKey && row.id === cursor.afterRowId);
        if (at === -1)
          throw new BridgeError("cursor_expired", "The page cursor's position no longer exists in the table.");
        start = at + 1;
      }
      const pageRows = rows.slice(start, start + cursor.limit);
      return {
        rows: pageRows.map(rowWireOf),
        nextCursor:
          pageRows.length > 0 && start + pageRows.length < rows.length
            ? buildCursor(
                table,
                input.asOfSeq,
                cursor.filter ?? undefined,
                cursor.sort ?? undefined,
                cursor.limit,
                pageRows[pageRows.length - 1]!
              )
            : null,
        asOfSeq: input.asOfSeq,
        schemaRevision: table.schemaRevision,
        queryFingerprint: input.queryFingerprint,
        semantics: semanticsOf(table),
      };
    },

    async createColumn(
      tableId: string,
      input: { column: Omit<Column, "id" | "revision">; afterColumnId?: string },
      ctx: MutationContext
    ): Promise<MutationReceipt<Column>> {
      const table = tableOf(tableId);
      validateColumnSpec(table, input.column);
      const fingerprint = fingerprintOf("createColumn", {
        tableId,
        column: input.column,
        afterColumnId: input.afterColumnId ?? null,
      });
      return idempotent(ctx, fingerprint, () => {
        let position: number;
        if (input.afterColumnId !== undefined) {
          const anchor = table.columns.findIndex((column) => column.id === input.afterColumnId);
          if (anchor === -1)
            throw new BridgeError("invalid_column", `The anchor column "${input.afterColumnId}" is unknown.`);
          position = anchor + 1;
        } else {
          position = Math.min(input.column.position, table.columns.length);
        }
        const column: Column = {
          id: `c-${table.id}-${++table.nextColumnSeq}`,
          name: input.column.name,
          type: input.column.type,
          position,
          nullable: input.column.nullable,
          revision: nextRevision(table),
          ...(input.column.operators !== undefined ? { operators: [...input.column.operators] } : {}),
          ...(input.column.reference !== undefined ? { reference: clone(input.column.reference) } : {}),
          ...(input.column.numberDisplay !== undefined ? { numberDisplay: clone(input.column.numberDisplay) } : {}),
        };
        table.columns.splice(position, 0, column);
        reindexColumns(table);
        table.schemaRevision = nextRevision(table);
        const wire = clone(column);
        return publish(table, ctx.operationId, wire, { [column.id]: column.revision }, [
          { type: "field.created", payload: { column: wire, schemaRevision: table.schemaRevision } },
        ]);
      });
    },

    async updateColumn(
      tableId: string,
      columnId: string,
      patch: Partial<Omit<Column, "id" | "revision">>,
      ctx: MutationContext
    ): Promise<MutationReceipt<Column>> {
      const table = tableOf(tableId);
      const column = table.columns.find((entry) => entry.id === columnId);
      if (column === undefined) throw new BridgeError("invalid_column", `The column "${columnId}" is unknown.`);
      const fingerprint = fingerprintOf("updateColumn", { tableId, columnId, patch });
      return idempotent(ctx, fingerprint, () => {
        // Pre-validate the whole patch before the mutation: an invalid key
        // stands no partial apply (the patch's all-or-nothing stand).
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined || key === "id" || key === "revision") continue;
          if (key === "position" && (typeof value !== "number" || !Number.isInteger(value) || value < 0)) {
            throw new BridgeError("validation", "The column position must be a non-negative integer.");
          }
          if (key === "name" && (typeof value !== "string" || value.trim() === "")) {
            throw new BridgeError("validation", "The column name must be a non-empty string.");
          }
          if (key === "nullable" && typeof value !== "boolean") {
            throw new BridgeError("validation", "The column nullability must be a boolean.");
          }
        }
        let changed = false;
        for (const [key, value] of Object.entries(patch)) {
          if (
            value === undefined ||
            key === "id" ||
            key === "revision" ||
            deepEqual(column[key as keyof Column], value)
          )
            continue;
          (column as unknown as Record<string, unknown>)[key] = clone(value);
          changed = true;
        }
        if (!changed) return noOpReceipt(ctx, table, clone(column));
        reindexColumns(table);
        table.schemaRevision = nextRevision(table);
        column.revision = nextRevision(table);
        const wire = clone(column);
        return publish(table, ctx.operationId, wire, { [columnId]: column.revision }, [
          { type: "field.updated", payload: { column: wire, schemaRevision: table.schemaRevision } },
        ]);
      });
    },

    async deleteColumn(
      tableId: string,
      columnId: string,
      ctx: MutationContext
    ): Promise<MutationReceipt<{ columnId: string }>> {
      const table = tableOf(tableId);
      const fingerprint = fingerprintOf("deleteColumn", { tableId, columnId });
      // The state check stands the fresh execution only (inside the
      // closure): a replay of the committed delete must stand the stored
      // receipt, not the not_found of the already-gone column.
      return idempotent(ctx, fingerprint, () => {
        const at = table.columns.findIndex((column) => column.id === columnId);
        if (at === -1) throw new BridgeError("not_found", `The column "${columnId}" is unknown or already deleted.`);
        const column = table.columns.splice(at, 1)[0]!;
        reindexColumns(table);
        table.detachedColumns.push(column);
        table.schemaRevision = nextRevision(table);
        column.revision = nextRevision(table);
        const before = clone(column);
        return publish(table, ctx.operationId, { columnId }, { [columnId]: column.revision }, [
          { type: "field.deleted", payload: { columnId, before, schemaRevision: table.schemaRevision } },
        ]);
      });
    },

    async restoreDeletedColumn(
      tableId: string,
      columnId: string,
      ctx: MutationContext
    ): Promise<MutationReceipt<Column>> {
      const table = tableOf(tableId);
      const live = table.columns.find((column) => column.id === columnId);
      if (live !== undefined) {
        const fingerprint = fingerprintOf("restoreDeletedColumn", { tableId, columnId });
        return idempotent(ctx, fingerprint, () => noOpReceipt(ctx, table, clone(live)));
      }
      const at = table.detachedColumns.findIndex((column) => column.id === columnId);
      if (at === -1) throw new BridgeError("not_found", `No deleted column "${columnId}" to restore.`);
      const fingerprint = fingerprintOf("restoreDeletedColumn", { tableId, columnId });
      return idempotent(ctx, fingerprint, () => {
        const column = table.detachedColumns.splice(at, 1)[0]!;
        table.columns.splice(Math.min(column.position, table.columns.length), 0, column);
        reindexColumns(table);
        table.schemaRevision = nextRevision(table);
        column.revision = nextRevision(table);
        const wire = clone(column);
        return publish(table, ctx.operationId, wire, { [columnId]: column.revision }, [
          { type: "field.restored", payload: { column: wire, schemaRevision: table.schemaRevision } },
        ]);
      });
    },

    async resolveRowDisplay(
      tableId: string,
      input: { rowIds: string[]; displayColumn?: string }
    ): Promise<Record<string, string | null>> {
      const table = tableOf(tableId);
      const rowIds = Array.isArray(input.rowIds) ? input.rowIds : [];
      let column: Column | undefined;
      if (input.displayColumn !== undefined) column = table.columns.find((entry) => entry.id === input.displayColumn);
      if (column === undefined) {
        column =
          table.columns.find((entry) => TEXT_TYPES.has(entry.type.replace(/\[\]$/, "").trim())) ?? table.columns[0];
      }
      const displays: Record<string, string | null> = {};
      for (const rowId of rowIds) {
        const row = liveRowOf(table, rowId);
        displays[rowId] = row === undefined || column === undefined ? null : formatCellDisplay(row.cells[column.id]);
      }
      return displays;
    },

    async batchRows(
      tableId: string,
      input: { ops: BatchOp[] },
      ctx: MutationContext
    ): Promise<MutationReceipt<{ rows: RowWire[] }>> {
      const table = tableOf(tableId);
      const ops: BatchOp[] = Array.isArray(input.ops) ? input.ops : [];
      if (ops.length > MAX_BATCH_OPS) {
        throw new BridgeError("limit_exceeded", `The batch exceeds the limit of ${MAX_BATCH_OPS} operations.`);
      }
      if (JSON.stringify(ops).length > MAX_REQUEST_BYTES) {
        throw new BridgeError(
          "payload_too_large",
          `The batch exceeds the request limit of ${MAX_REQUEST_BYTES} bytes.`
        );
      }
      const fingerprint = fingerprintOf("batchRows", { tableId, ops });
      return idempotent(ctx, fingerprint, () => {
        const checkpoint = cloneTableCheckpoint(table);
        try {
          let rebalanced = false;
          const events: DomainEvent[] = [];
          const affected: MemoryRow[] = [];
          const touched = new Set<string>();
          const touch = (row: MemoryRow) => {
            if (!touched.has(row.id)) {
              touched.add(row.id);
              affected.push(row);
            }
          };
          ops.forEach((op, index) => {
            function fail(code: BridgeErrorCode, message: string): never {
              throw new BridgeError(code, message, { path: `ops[${index}]` });
            }
            switch (op.op) {
              case "create": {
                if (JSON.stringify(op.row).length > MAX_REQUEST_BYTES) {
                  fail("payload_too_large", "The row exceeds the request limit.");
                }
                validateCells(table, op.row, fail);
                const allocated = allocateOrderKey(table, op.beforeRowId ?? null, undefined, fail);
                rebalanced = rebalanced || allocated.rebalanced;
                const row: MemoryRow = {
                  id: `r-${table.id}-${++table.nextRowSeq}`,
                  orderKey: allocated.key,
                  revision: nextRevision(table),
                  cells: stripUndefinedCells(op.row),
                  deletedAt: null,
                  deletedRevision: null,
                };
                table.rows.push(row);
                touch(row);
                events.push({ type: "row.created", payload: { row: rowWireOf(row) } });
                break;
              }
              case "update": {
                const row = liveRowOf(table, op.rowId);
                if (row === undefined) fail("not_found", `The row "${op.rowId}" is unknown or deleted.`);
                assertCas(row.revision, op.expectedRevision, fail, `the row "${op.rowId}"`);
                validateCells(table, op.cells, fail);
                let changed = false;
                for (const [fieldId, value] of Object.entries(op.cells)) {
                  if (deepEqual(row.cells[fieldId], value)) continue;
                  row.cells[fieldId] = value === null ? null : clone(value);
                  changed = true;
                }
                if (!changed) break;
                row.revision = nextRevision(table);
                touch(row);
                events.push({ type: "row.updated", payload: { row: rowWireOf(row) } });
                break;
              }
              case "delete": {
                const row = liveRowOf(table, op.rowId);
                if (row === undefined) fail("not_found", `The row "${op.rowId}" is unknown or deleted.`);
                assertCas(row.revision, op.expectedRevision, fail, `the row "${op.rowId}"`);
                assertNoLiveEnumOptionReference(table, op.rowId, fail);
                const before = rowWireOf(row);
                row.deletedAt = Date.now();
                row.deletedRevision = row.revision;
                touch(row);
                events.push({
                  type: "row.deleted",
                  payload: { rowId: row.id, deletedRevision: row.deletedRevision, before },
                });
                break;
              }
              case "move": {
                const row = liveRowOf(table, op.rowId);
                if (row === undefined) fail("not_found", `The row "${op.rowId}" is unknown or deleted.`);
                assertCas(row.revision, op.expectedRevision, fail, `the row "${op.rowId}"`);
                if (moveIsNoOp(table, row.id, op.beforeRowId)) break;
                const allocated = allocateOrderKey(table, op.beforeRowId, row.id, fail);
                rebalanced = rebalanced || allocated.rebalanced;
                row.orderKey = allocated.key;
                touch(row);
                events.push({ type: "row.moved", payload: { row: rowWireOf(row) } });
                break;
              }
            }
          });
          const revisions: Record<string, string> = {};
          for (const row of affected) revisions[row.id] = row.revision;
          const result: { rows: RowWire[] } = { rows: affected.map(rowWireOf) };
          if (events.length === 0) {
            // The all-no-op batch stands the no-op receipt (no envelope, no
            // head advance): the commit sequence stands the table's head.
            return noOpReceipt(ctx, table, result);
          }
          return publish(table, ctx.operationId, result, revisions, events, rebalanced);
        } catch (error) {
          restoreTableCheckpoint(table, checkpoint);
          throw toBridgeError(error);
        }
      });
    },

    async undeleteRows(
      tableId: string,
      input: { rowIds: string[] },
      ctx: MutationContext
    ): Promise<MutationReceipt<{ rows: RowWire[] }>> {
      const table = tableOf(tableId);
      const rowIds = Array.isArray(input.rowIds) ? input.rowIds : [];
      const fingerprint = fingerprintOf("undeleteRows", { tableId, rowIds: [...rowIds].sort() });
      return idempotent(ctx, fingerprint, () => {
        // Pre-validate every id before the mutation: the restore is one
        // atomic operation (a failed id stands no partial restore).
        const byId = new Map(table.rows.map((row) => [row.id, row]));
        const toRestore: MemoryRow[] = [];
        for (const rowId of rowIds) {
          const row = byId.get(rowId);
          if (row === undefined)
            throw new BridgeError("not_found", `The row "${rowId}" is unknown or past its physical GC.`);
          if (row.deletedAt === null) continue; // the already-live stand: the no-op contribution
          toRestore.push(row);
        }
        if (toRestore.length === 0) return noOpReceipt(ctx, table, { rows: [] });
        const events: DomainEvent[] = [];
        const revisions: Record<string, string> = {};
        for (const row of toRestore) {
          row.deletedAt = null;
          row.deletedRevision = null;
          row.revision = nextRevision(table);
          revisions[row.id] = row.revision;
          events.push({ type: "row.restored", payload: { row: rowWireOf(row) } });
        }
        const result = { rows: toRestore.map(rowWireOf) };
        return publish(table, ctx.operationId, result, revisions, events, false);
      });
    },

    subscribeTable(tableId: string, input: { afterSeq: number }, observer: SubscriptionObserver): SubscriptionHandle {
      const table = tableOf(tableId);
      const noopHandle: SubscriptionHandle = { unsubscribe(): void {} };
      if (typeof input.afterSeq !== "number" || !Number.isInteger(input.afterSeq) || input.afterSeq < 0) {
        observer.status("connecting");
        observer.error(new BridgeError("validation", "The subscription afterSeq must be a non-negative integer."));
        observer.status("closed");
        return noopHandle;
      }
      if (Number.isFinite(replayWindow) && input.afterSeq < table.headSeq - replayWindow) {
        observer.status("connecting");
        observer.ready({ afterSeq: input.afterSeq, headSeq: table.headSeq, protocol: descriptor });
        observer.status("replaying");
        observer.reset({ code: "replay_expired" });
        observer.status("closed");
        return noopHandle;
      }
      let set = subscribers.get(tableId);
      if (set === undefined) {
        set = new Set();
        subscribers.set(tableId, set);
      }
      if (set.size >= MAX_SUBSCRIPTIONS) {
        observer.status("connecting");
        observer.error(
          new BridgeError("limit_exceeded", `The table's live subscriptions reach the limit of ${MAX_SUBSCRIPTIONS}.`)
        );
        observer.status("closed");
        return noopHandle;
      }
      let closed = false;
      const handle: SubscriptionHandle = {
        unsubscribe(): void {
          if (closed) return;
          closed = true;
          set.delete(observer);
          observer.status("closed");
        },
      };
      set.add(observer);
      observer.status("connecting");
      observer.ready({ afterSeq: input.afterSeq, headSeq: table.headSeq, protocol: descriptor });
      if (input.afterSeq < table.headSeq) {
        observer.status("replaying");
        for (const envelope of table.envelopes) {
          if (envelope.seq > input.afterSeq) observer.event(clone(envelope));
        }
      }
      if (!closed) observer.status("live");
      return handle;
    },

    async getOperationStatus(operationId: string): Promise<OperationStatus> {
      const entry = idempotency.get(operationId);
      if (entry === undefined) {
        throw new BridgeError("operation_unknown", `The operation "${operationId}" is unknown.`);
      }
      // The tombstone stand (the sticky expiry of the write path): an
      // expired id stands the operation_unknown (the entry is not deleted
      // — the write path's never-re-execute stand stands on it).
      if (entry.receipt === null || Date.now() - entry.committedAt > operationRetentionMs) {
        entry.receipt = null;
        throw new BridgeError("operation_unknown", `The operation "${operationId}" is outside the retention horizon.`);
      }
      return { state: "committed", receipt: entry.receipt };
    },

    gcTable(tableId: string): void {
      const table = tableOf(tableId);
      const deadline = Date.now() - tombstoneRetentionMs;
      const before = table.rows.length;
      table.rows = table.rows.filter((row) => row.deletedAt === null || row.deletedAt > deadline);
      if (table.rows.length === before) return;
      // The GC is invisible by design: no envelope, no head advance — the
      // public stream stands unchanged and a restore of a GC'd row stands
      // the safe `not_found`.
    },
  };

  return bridge;
}

/** The shared per-page default bridge (the `databaseBridge` prop fallback). */
let defaultBridge: MemoryDatabaseBridge | null = null;

/** The per-page default bridge (created lazily, shared by all the panes of the page). */
function getDefaultDatabaseBridge(): MemoryDatabaseBridge {
  if (defaultBridge === null) defaultBridge = createMemoryDatabaseBridge();
  return defaultBridge;
}

export { createMemoryDatabaseBridge, getDefaultDatabaseBridge };
export type { MemoryDatabaseBridge };
