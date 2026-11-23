/**
 * The bridge's write's types (the mixed batch's operations) + the
 * `DatabaseBridge`'s contract's interface (all methods async; a failure
 * rejects with a `BridgeError`).
 */
import type {
  MutationContext,
  MutationReceipt,
  OperationStatus,
  ProtocolDescriptor,
  SubscriptionHandle,
  SubscriptionObserver,
} from "./event-types";
import type {
  CellMap,
  Column,
  Id,
  PageQuery,
  PageSnapshot,
  Revision,
  RowWire,
  TableDescription,
  TableRef,
  TableSnapshot,
} from "./wire-types";

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
   *  partial envelope. The receipt's `rows` stand the CREATED rows over
   *  the create op's order (the moved / updated / deleted rows stand the
   *  envelope's events + the `revisions`, not the `rows`). */
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

export type { BatchOp, DatabaseBridge };
