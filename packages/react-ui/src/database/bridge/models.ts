/**
 * The DatabaseBridge contract's types. The stable data model: the
 * `tableId` / `rowId` / `fieldId` are stable opaque identifiers (the
 * label is never the identity); a page's rows are an ORDERED array of
 * `RowWire`, not an id-keyed record, so the server's row order survives
 * the wire. The client keeps in the document only the table reference
 * and the block's view (filter / sort / column display); the schema, the
 * rows, the event log and the authorization live in the consumer's
 * database. Every `tableId` / `rowId` / `fieldId`, filter, sort, cursor,
 * cell and the document's reference is untrusted input — the server
 * validates and normalizes each one and scopes the lookup by the
 * verified session.
 *
 * The grid-facing shapes (`BridgeColumn` / `BridgeTableDescription`) are
 * the hook's view over the wire schema (the display attributes flattened);
 * the cell annotation + the value parse + the filter evaluation stand the
 * cell editor and the filter builder.
 */
import type { BridgeError } from "./errors";

/** An opaque stable identifier (the table / row / field / operation id). */
type Id = string;
/** The consumer's revision stand (the row / column / table's version). */
type Revision = string;
/** The ISO-8601 instant (the mutation's issue time). */
type IsoInstant = string;
/** A row's cells: the field id → the stored value. `null` clears a
 *  nullable cell; an absent key stands "do not change"; `undefined` is
 *  never a stored value (it is dropped before the JSON serialization). */
type CellMap = Record<Id, unknown>;

/** The table's catalog entry (the picker / the block's reference). */
interface TableRef {
  id: Id;
  name: string;
  revision: Revision;
  /** The hidden system table (the enum's options' catalog): absent from
   *  `listTables`, reachable by id. */
  system?: boolean;
}

/** The column's schema entry (the consumer's field registry row). */
interface Column {
  id: Id;
  name: string;
  type: string;
  /** The position in the schema order (the 0-based seat). */
  position: number;
  nullable: boolean;
  revision: Revision;
  /** The operator catalog override; the consumer's default catalog for
   *  the type stands when absent. */
  operators?: string[];
  /** The reference relation over the plain column: the cell holds the
   *  referenced row's stable id (an option row id for the enum, a linked
   *  row id for the row link); `many` = the cell holds the array. */
  reference?: {
    kind: "enum" | "row";
    tableId: Id;
    many: boolean;
    /** The display column of the linked table (the row-link's stand; the
     *  default is the first text column / the pk). */
    displayColumnId?: Id;
  };
  /** The number column's display attributes. */
  numberDisplay?: {
    decimals?: number;
    thousands?: boolean;
    prefix?: string;
    suffix?: string;
    allowNegative?: boolean;
  };
}

/** The table's schema + the table reference. */
interface TableDescription {
  table: TableRef;
  columns: Column[];
  schemaRevision: Revision;
}

/** A query operator descriptor (the value's kind the filter builder
 *  renders). */
interface QueryOperator {
  id: string;
  valueKind: "none" | "scalar" | "list";
}

/** The server's query semantics (the canonicalization stand the filter /
 *  sort values normalize to). */
interface QuerySemantics {
  semanticsVersion: string;
  collation: string;
  timezone: string;
  nullOrdering: "first" | "last";
  operatorsByColumnType: Record<string, QueryOperator[]>;
}

/** One filter condition (the column + the operator + the value; the value
 *  is absent only for the valueless operators). */
interface FilterConditionInput {
  columnId: Id;
  op: string;
  value?: unknown;
}

/** The recursive and/or filter input (the block's `filter` view state; the
 *  server canonicalizes and validates it against the declared operators —
 *  the unknown column / operator / type rejects). */
interface FilterInput {
  logic: "and" | "or";
  conditions: FilterConditionInput[];
  groups?: FilterInput[] | null;
}

/** The sort input: the ordered sort keys (the null ordering per key). */
type SortInput = { fieldId: Id; direction: "asc" | "desc"; nulls?: "first" | "last" }[];

/** The page query (the filter + the sort + the page size). */
interface PageQuery {
  filter?: FilterInput;
  sort?: SortInput;
  limit?: number;
}

/** A wire row: the stable id + the canonical physical order key (a finite
 *  IEEE-754 number — never a string, NaN or infinity; the canonical total
 *  order is `(orderKey, rowId)`) + the revision + the cells. The page's
 *  row order is the array's order. */
interface RowWire {
  id: Id;
  orderKey: number;
  revision: Revision;
  cells: Record<string, unknown>;
}

/** An ordered row page: the rows in the server's order + the opaque next
 *  cursor (null = the last page) + the snapshot's top event boundary +
 *  the schema revision + the query fingerprint (the server's signed
 *  canonical form — the client never constructs one). */
interface RowPage {
  rows: RowWire[];
  nextCursor: string | null;
  asOfSeq: number;
  schemaRevision: Revision;
  queryFingerprint: string;
}

/** The page + the query semantics. */
type PageSnapshot = RowPage & { semantics: QuerySemantics };

/** The initial load: the schema and the first page from one consistent
 *  snapshot (the `page.asOfSeq` is the R both represent). */
type TableSnapshot = TableDescription & { page: PageSnapshot };

/** The write's context: the client-issued idempotency key (a UUID, unique
 *  within the operation retention) + the issue time + the optional CAS
 *  revision (its absence selects the LWW default — the last committed
 *  write of the same cell wins). */
interface MutationContext {
  operationId: Id;
  issuedAt: IsoInstant;
  expectedRevision?: Revision;
}

/** The committed mutation's receipt: the operation's ids + the commit's
 *  sequence + the server-normalized result + the new revisions. The outer
 *  commit envelope of the same operation carries the very same receipt. */
interface MutationReceipt<T> {
  operationId: Id;
  txId: Id;
  committedSeq: number;
  result: T;
  revisions: Record<Id, Revision>;
}

/** The operation's status (the lost-response reconciliation: the
 *  committed receipt or the pending stand). */
type OperationStatus<T = unknown> = { state: "committed"; receipt: MutationReceipt<T> } | { state: "pending" };

/** The protocol capability (the baseline set every conformant bridge
 *  declares; the optional sets gate the UI paths that need them). */
type ProtocolCapability =
  | "orderedRows"
  | "snapshotReplay"
  | "idempotentWrites"
  | "structuredErrors"
  | "viewInvalidation"
  | "cas"
  | "rowRestore"
  | "columnRestore"
  | "serverSort"
  | "mixedBatch"
  | "materializedWindow";

/** The negotiated finite limits (the server enforces the filter's depth /
 *  terms, the page size, the batch's count, the request / frame bytes and
 *  the active subscriptions with `limit_exceeded` / `payload_too_large`). */
interface ProtocolLimits {
  maxFilterDepth: number;
  maxFilterTerms: number;
  maxPageSize: number;
  maxBatchOps: number;
  maxRequestBytes: number;
  maxFrameBytes: number;
  maxSubscriptions: number;
}

/** The protocol descriptor (the version + the capabilities + the limits +
 *  the retention horizons). */
interface ProtocolDescriptor {
  protocolVersion: 2;
  capabilities: readonly ProtocolCapability[];
  limits: ProtocolLimits;
  operationRetentionSeconds: number;
  retryHorizonSeconds: number;
}

/** The domain event (the nested record of a committed transaction's
 *  envelope — the nested events never carry their own seq). */
type DomainEvent =
  | { type: "table.created"; payload: { table: TableDescription } }
  | { type: "table.renamed"; payload: { table: TableRef } }
  | { type: "table.deleted"; payload: { tableId: Id; revision: Revision } }
  | {
      type: "field.created" | "field.updated" | "field.restored";
      payload: { column: Column; schemaRevision: Revision };
    }
  | { type: "field.deleted"; payload: { columnId: Id; before: Column; schemaRevision: Revision } }
  | { type: "row.created" | "row.updated" | "row.restored" | "row.moved"; payload: { row: RowWire } }
  | { type: "row.deleted"; payload: { rowId: Id; deletedRevision: Revision; before: RowWire } }
  | { type: "enum.option.renamed"; payload: { catalogTableId: Id; option: RowWire } };

/** The committed transaction's envelope base (the per-table ordered
 *  stream's frame). */
interface TableEnvelopeBase {
  tableId: Id;
  /** The envelope's monotonic sequence (not necessarily the previous's + 1). */
  seq: number;
  /** The previous committed envelope's seq (null for the table's first) —
   *  the client detects a loss by the chain, not by the arithmetic. */
  prevSeq: number | null;
  txId: Id;
}

/** The per-table stream's frame: one committed transaction → one outer
 *  envelope → one `seq` / `prevSeq`; the `commit` kind carries the ordered
 *  nested domain events, the `invalidate` kind stands the explicit
 *  rebaseline (the server reset signal, the large rebalance). */
type TableEvent = TableEnvelopeBase &
  (
    | {
        kind: "commit";
        /** The session id of the write's origin (the per-connection stand
         *  — a second tab of the same user is NOT the origin). */
        originSessionId: Id;
        operationId: Id;
        receipt: MutationReceipt<unknown>;
        events: DomainEvent[];
      }
    | {
        kind: "invalidate";
        /** Present for a client mutation, null for a server reset signal. */
        originSessionId: Id | null;
        operationId: Id | null;
        receipt: MutationReceipt<unknown> | null;
        events: [];
      }
  );

/** The subscription's status (the bootstrap's phases). */
type SubscriptionStatus = "connecting" | "replaying" | "live" | "closed";

/** The subscription's observer: the readiness (the replay's cursor + the
 *  table's head + the protocol), the ordered at-least-once stream, the
 *  transport's errors, and the forced rebaseline signals. */
interface SubscriptionObserver {
  /** The subscriber is registered: the replay stands the events after
   *  `afterSeq`, `headSeq` is the table's current head. */
  ready: (value: { afterSeq: number; headSeq: number; protocol: ProtocolDescriptor }) => void;
  event: (value: TableEvent) => void;
  status: (value: SubscriptionStatus) => void;
  error: (error: BridgeError) => void;
  /** The local page is discarded and a fresh snapshot is taken (the
   *  replay expired, the permission lost, the gap detected). */
  reset: (value: { code: "replay_expired" | "permission_lost" | "gap_detected" }) => void;
}

/** The subscription's handle. */
interface SubscriptionHandle {
  unsubscribe(): void;
}

/**
 * A bridge column (the grid's view over the wire's `Column` — the display
 * attributes flattened, the reference relation's fields in the wire's
 * `reference` stand). The `type` is a standard PostgreSQL type name (or
 * the consumer's own name): the contract is type-agnostic — the package
 * does not validate the set; the consumer maps type → DDL and type →
 * cell editor. `operators` is the consumer's operator catalog override;
 * when absent, the package's default catalog for the type stands (the
 * filter builders), and the query must apply exactly the declared
 * operators. The `decimals` / `thousands` / `prefix` / `suffix` /
 * `allowNegative` fields are the number column's display attributes (the
 * column's own data — the package's number formatter reads them). The
 * reference fields declare a RELATION over the plain column:
 * `refKind "enum"` — the cell value is the option row id of the dict
 * table (`refTableId`); `refKind "row"` — the cell value is the linked
 * table's row id (`refDisplayColumn` declares which column of the linked
 * table stands the display; the default is the first text column / the
 * pk). `refMany` is the many cardinality (the cell value is an ARRAY of
 * the option row ids / the row ids; the consumer maps the array to a
 * junction table behind the row's write).
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

/**
 * The table description (the grid's view over the wire's
 * `TableDescription`): the table's name + the grid's columns.
 */
interface BridgeTableDescription {
  name: string;
  columns: BridgeColumn[];
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

/** A batch operation (the mixed batch's element; the ordered `ops[]`
 *  commit as one transaction — either the whole batch or none). */
type BatchOp =
  | { op: "create"; row: CellMap; beforeRowId?: Id | null }
  | { op: "update"; rowId: Id; cells: CellMap; expectedRevision?: Revision }
  | { op: "delete"; rowId: Id; expectedRevision?: Revision }
  | { op: "move"; rowId: Id; beforeRowId: Id | null; expectedRevision?: Revision };

/**
 * The bridge contract (all methods async; a failure rejects with a
 * `BridgeError`). `snapshotTable` is the sole initial read; `queryNextPage`
 * only follows it over the opaque query-bound cursor. `subscribeTable` is
 * the only push channel: the client takes the snapshot R first, then
 * subscribes with `afterSeq: R` — the server registers the subscriber,
 * replays every `seq > R` in the table's order, then continues the same
 * stream live. A repeated `operationId` with the same operation body
 * returns the initial committed result without a second effect; a repeated
 * id with a different body rejects with `idempotency_conflict`; an id
 * outside the retention rejects with `idempotency_expired` and is never
 * executed again.
 */
interface DatabaseBridge {
  /** The protocol descriptor (the version + the capabilities + the
   *  limits): the client negotiates it before any use — a version /
   *  baseline-capability mismatch stands the `protocol_mismatch`, not a
   *  silent downgrade. */
  describeProtocol(): Promise<ProtocolDescriptor>;
  /** The visible tables (the system tables stand excluded). */
  listTables(): Promise<TableRef[]>;
  /** Create the table (empty — the schema stands the `createColumn`
   *  calls) → the committed table reference. */
  createTable(input: { name: string; system?: boolean }, ctx: MutationContext): Promise<MutationReceipt<TableRef>>;
  /** Rename the table (the name stands on the table, shared by every
   *  block that references it). */
  renameTable(tableId: Id, input: { name: string }, ctx: MutationContext): Promise<MutationReceipt<TableRef>>;
  /** The table schema + the pk / order metadata. */
  describeTable(tableId: Id): Promise<TableDescription>;
  /** The sole initial load: the schema and the first page from one
   *  consistent snapshot (the `page.asOfSeq` is the R both represent). */
  snapshotTable(tableId: Id, query: PageQuery): Promise<TableSnapshot>;
  /** The next page over the opaque keyset cursor (the cursor is signed
   *  and bound to its table, its snapshot R and its normalized query);
   *  any commit that advanced the table's public head after R rejects
   *  with `cursor_expired` — the client takes a fresh `snapshotTable`. */
  queryNextPage(
    tableId: Id,
    input: { cursor: string; asOfSeq: number; queryFingerprint: string }
  ): Promise<PageSnapshot>;
  /** Add a column (after `afterColumnId`, or at the end). */
  createColumn(
    tableId: Id,
    input: { column: Omit<Column, "id" | "revision">; afterColumnId?: Id },
    ctx: MutationContext
  ): Promise<MutationReceipt<Column>>;
  /** Patch the column's attributes (the rename stands the `name` key —
   *  the name is an attribute). */
  updateColumn(
    tableId: Id,
    columnId: Id,
    patch: Partial<Omit<Column, "id" | "revision">>,
    ctx: MutationContext
  ): Promise<MutationReceipt<Column>>;
  /** Remove a column. The consumer MAY stand the soft-delete posture
   *  (the definition, the position and the cell values stay preserved,
   *  the removal restorable over `restoreDeletedColumn`); the destructing
   *  posture stands the removal not undoable. */
  deleteColumn(tableId: Id, columnId: Id, ctx: MutationContext): Promise<MutationReceipt<{ columnId: Id }>>;
  /** Restore the soft-deleted column — its schema, its position and the
   *  preserved cell values; the no-op when the column stands in the
   *  schema again. */
  restoreDeletedColumn(tableId: Id, columnId: Id, ctx: MutationContext): Promise<MutationReceipt<Column>>;
  /** The row displays for the row-link cells (the join stands in the
   *  consumer backend; the missing / deleted target stands `null` — no
   *  data of the absent target is revealed). */
  resolveRowDisplay(tableId: Id, input: { rowIds: Id[]; displayColumn?: Id }): Promise<Record<Id, string | null>>;
  /** The atomic mixed batch: the ordered `ops[]` commit as one
   *  transaction (either the whole batch or none); the failure stands the
   *  first unexecutable operation's index and code and publishes no
   *  partial envelope. */
  batchRows(
    tableId: Id,
    input: { ops: BatchOp[] },
    ctx: MutationContext
  ): Promise<MutationReceipt<{ rows: RowWire[] }>>;
  /** Restore the soft-deleted rows: one atomic operation, independent of
   *  the input id order (the rows keep their saved order); the row past
   *  its physical GC stands the safe `not_found`. */
  undeleteRows(
    tableId: Id,
    input: { rowIds: Id[] },
    ctx: MutationContext
  ): Promise<MutationReceipt<{ rows: RowWire[] }>>;
  /** The push channel (the consumer's transport): the bootstrap's
   *  subscriber (the `afterSeq` replay cursor), the ordered at-least-once
   *  per-table stream, and the unsubscribe. */
  subscribeTable(tableId: Id, input: { afterSeq: number }, observer: SubscriptionObserver): SubscriptionHandle;
  /** The operation's status (the lost-response reconciliation): the
   *  committed receipt, the pending stand, or the `operation_unknown`
   *  rejection (an unknown id is never a new mutation). */
  getOperationStatus(operationId: Id): Promise<OperationStatus>;
}

export type {
  BatchOp,
  BridgeColumn,
  BridgeColumnAnnotation,
  BridgeTableDescription,
  BridgeValueInput,
  CellMap,
  CellValueParse,
  Column,
  DatabaseBridge,
  DomainEvent,
  FilterConditionInput,
  FilterInput,
  Id,
  IsoInstant,
  MutationContext,
  MutationReceipt,
  OperationStatus,
  PageQuery,
  PageSnapshot,
  ProtocolCapability,
  ProtocolDescriptor,
  ProtocolLimits,
  QueryOperator,
  QuerySemantics,
  Revision,
  RowPage,
  RowWire,
  SortInput,
  SubscriptionHandle,
  SubscriptionObserver,
  SubscriptionStatus,
  TableDescription,
  TableEnvelopeBase,
  TableEvent,
  TableRef,
  TableSnapshot,
};
