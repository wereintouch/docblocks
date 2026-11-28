/**
 * The in-memory reference bridge: the harness's single-process `DatabaseBridge`
 * (the consumer-side stand of the normative contract) that demonstrates it
 * end to end — the
 * snapshot → subscribe(`afterSeq = R`) → replay → live bootstrap, the
 * append-only per-table envelope stream (one committed transaction → one
 * `seq` / `prevSeq`, the replay gap is the envelope's absence), the
 * structured errors, the idempotent writes, and the atomic mixed batch with
 * the order-key allocation + the in-transaction rebalance.
 *
 * The contract stands this implementation pins:
 * - `snapshotTable` is the sole initial read; its `page.asOfSeq` is the `R`
 *  both the schema and the page represent. `queryNextPage` only follows the
 *  opaque cursor signed under the instance's key and bound to `R` + the
 *  query fingerprint; a tampered payload / a foreign key / any commit that
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
 *
 * The layout stands over the core (the shared state + the stateful
 * primitives) and the thematic modules: the query pipeline, the row /
 * table helpers, the column-schema helpers, and the bridge's operations
 * (the tables, the read path, the schema, the rows, the subscription).
 */
import type { DatabaseBridge } from "docblocks-react-ui";

import { batchRows, undeleteRows } from "./bridge-rows";
import { createColumn, deleteColumn, restoreDeletedColumn, updateColumn } from "./bridge-schema";
import { queryNextPage, resolveRowDisplay, snapshotTable } from "./bridge-snapshot";
import { gcTable, getOperationStatus, subscribeTable } from "./bridge-subscribe";
import { createTable, describeProtocol, describeTable, listTables, renameTable } from "./bridge-tables";
import { buildCore } from "./core";
import type { MemoryBridgeOptions } from "./models";
import { liveRows } from "./rows";

/** The reference bridge's public surface (the contract + the GC test stand). */
interface MemoryDatabaseBridge extends DatabaseBridge {
  /** The consumer's synchronous authoritative count of live rows. */
  getRowCount(tableId: string): number | undefined;
  /** The reference stand of the consumer-side tombstone GC: drops the rows
   *  past the `tombstoneRetentionMs`. Invisible — no envelope, no head
   *  advance; the public stream stands unchanged. */
  gcTable(tableId: string): void;
}

function createMemoryDatabaseBridge(options: MemoryBridgeOptions = {}): MemoryDatabaseBridge {
  const core = buildCore(options);

  const bridge: MemoryDatabaseBridge = {
    describeProtocol: () => describeProtocol(core),
    listTables: () => listTables(core),
    createTable: (input, ctx) => createTable(core, input, ctx),
    renameTable: (tableId, input, ctx) => renameTable(core, tableId, input, ctx),
    describeTable: (tableId) => describeTable(core, tableId),
    snapshotTable: (tableId, query) => snapshotTable(core, tableId, query),
    queryNextPage: (tableId, input) => queryNextPage(core, tableId, input),
    createColumn: (tableId, input, ctx) => createColumn(core, tableId, input, ctx),
    updateColumn: (tableId, columnId, patch, ctx) => updateColumn(core, tableId, columnId, patch, ctx),
    deleteColumn: (tableId, columnId, ctx) => deleteColumn(core, tableId, columnId, ctx),
    restoreDeletedColumn: (tableId, columnId, ctx) => restoreDeletedColumn(core, tableId, columnId, ctx),
    resolveRowDisplay: (tableId, input) => resolveRowDisplay(core, tableId, input),
    batchRows: (tableId, input, ctx) => batchRows(core, tableId, input, ctx),
    undeleteRows: (tableId, input, ctx) => undeleteRows(core, tableId, input, ctx),
    subscribeTable: (tableId, input, observer) => subscribeTable(core, tableId, input, observer),
    getOperationStatus: (operationId) => getOperationStatus(core, operationId),
    getRowCount: (tableId) => {
      const table = core.tables.get(tableId);
      return table === undefined ? undefined : liveRows(table).length;
    },
    gcTable: (tableId) => gcTable(core, tableId),
  };

  return bridge;
}

export { createMemoryDatabaseBridge };
export type { MemoryDatabaseBridge };
