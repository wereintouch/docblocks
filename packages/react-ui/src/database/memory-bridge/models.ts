/** The in-memory bridge's internal shapes: the table (the schema + the
 *  rows + the envelope outbox), the factory options, and the idempotency
 *  store's entry. */
import type { Column, MutationReceipt, TableEvent } from "../bridge";

/** A row entry: the cells (the `cells` map is the single source of truth) +
 *  the order key + the tombstone. The order is NOT the array position — the
 *  physical order is `(orderKey, id)` over the retained (live + tombstoned)
 *  rows; the array holds the rows in insertion order only. */
interface MemoryRow {
  id: string;
  /** The float order key (the head = 1, the middle = the mean of the
   *  neighbours, the tail = the left bound + 1). */
  orderKey: number;
  /** The row's current revision (bumped on every value write / restore). */
  revision: string;
  /** columnId → the raw value (the absent key = an unset cell). */
  cells: Record<string, unknown>;
  /** The tombstone: the delete commit's timestamp (null = live). */
  deletedAt: number | null;
  /** The revision the row stood at when it was deleted (null = live). */
  deletedRevision: string | null;
}

/** A table: the schema (the live + the soft-deleted columns) + the rows +
 *  the envelope outbox (the append-only stream the replay + the `headSeq`
 *  key off). The stream is never trimmed — the reference bridge lives as
 *  long as the session, and the outbox stands its replay window. */
interface MemoryTable {
  id: string;
  name: string;
  /** The system (hidden) table — absent from `listTables`. */
  system: boolean;
  /** The table's revision (bumped on a rename). */
  revision: string;
  /** The live columns, in the registry order (the `position` mirrors the
   *  index, re-derived on every schema mutation). */
  columns: Column[];
  /** The soft-deleted columns (the `deleteColumn`'s preserved state): the
   *  definition keeps its position at deletion + the cell values stay in
   *  the rows, so the `restoreDeletedColumn` re-inserts the schema and the
   *  values are already in place. */
  detachedColumns: Column[];
  rows: MemoryRow[];
  /** The stream's head (the last `seq` committed to this table). */
  headSeq: number;
  /** The envelope outbox (the replay source). */
  envelopes: TableEvent[];
  /** The current schema revision (bumped on a column create/update/delete/
   *  restore). */
  schemaRevision: string;
  /** The revision counter (the `rev-N` ids are unique per table). */
  revisionCounter: number;
  /** The row / column id counters (the `r-<tableId>-N` / `c-<tableId>-N`
   *  allocation). */
  nextRowSeq: number;
  nextColumnSeq: number;
}

/** The factory options (the retention / replay stand). */
interface MemoryBridgeOptions {
  /** The idempotency retention horizon (seconds, the default 7 days). */
  operationRetentionSeconds?: number;
  /** The retry horizon the descriptor advertises (seconds, the default
   *  300). */
  retryHorizonSeconds?: number;
  /** The tombstone retention (ms, the default 0 — the tombstone is
   *  GC-eligible immediately, via the `gcTable` stand). */
  tombstoneRetentionMs?: number;
  /** The replay window (envelopes behind the head, the default unlimited). */
  replayWindow?: number;
}

/** The idempotency store's entry: the operation id → the committed state.
 *  The `receipt: null` stand is the expired tombstone: the id is never
 *  re-executed past the horizon (the entry stands, the receipt drops). */
interface MemoryIdempotencyEntry {
  /** The canonical body's hash (the same-id conflict's discriminator). */
  fingerprint: string;
  /** The commit's receipt (the replay's stand; null = the expired tombstone). */
  receipt: MutationReceipt<unknown> | null;
  /** The commit's timestamp (the retention horizon's key). */
  committedAt: number;
}

export type { MemoryBridgeOptions, MemoryIdempotencyEntry, MemoryRow, MemoryTable };
