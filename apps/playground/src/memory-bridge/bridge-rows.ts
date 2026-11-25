/**
 * The in-memory bridge's row mutations (over the core): the atomic mixed
 * batch (every op is validated before any mutation lands, a failure
 * restores the pre-batch state over the checkpoint — no partial envelope;
 * the first unexecutable op carries its `ops[i]` path; the order-key's
 * rebalance stands the `invalidate` envelope) and the trash's restore
 * (the pre-validated all-or-nothing undelete).
 */
import type {
  BatchOp,
  BridgeErrorCode,
  DomainEvent,
  MutationContext,
  MutationReceipt,
  RowWire,
} from "docblocks-react-ui";
import { BridgeError, toBridgeError } from "docblocks-react-ui";

import { MAX_BATCH_OPS, MAX_REQUEST_BYTES } from "./constants";
import { noOpReceipt } from "./core";
import type { MemoryBridgeCore } from "./core";
import type { MemoryRow } from "./models";
import {
  allocateOrderKey,
  assertCas,
  assertNoLiveEnumOptionReference,
  liveRowOf,
  moveIsNoOp,
  nextRevision,
  rowWireOf,
  stripUndefinedCells,
  validateCells,
} from "./rows";
import { cloneTableCheckpoint, restoreTableCheckpoint } from "./schema";
import { clone, deepEqual, jsonSizeOf } from "./utils";

async function batchRows(
  core: MemoryBridgeCore,
  tableId: string,
  input: { ops: BatchOp[] },
  ctx: MutationContext
): Promise<MutationReceipt<{ rows: RowWire[] }>> {
  const table = core.tableOf(tableId);
  const ops: BatchOp[] = Array.isArray(input.ops) ? input.ops : [];
  if (ops.length > MAX_BATCH_OPS) {
    throw new BridgeError("limit_exceeded", `The batch exceeds the limit of ${MAX_BATCH_OPS} operations.`);
  }
  if (jsonSizeOf(ops) > MAX_REQUEST_BYTES) {
    throw new BridgeError("payload_too_large", `The batch exceeds the request limit of ${MAX_REQUEST_BYTES} bytes.`);
  }
  const fingerprint = core.fingerprintOf("batchRows", { tableId, ops });
  return core.idempotent(ctx, fingerprint, () => {
    const checkpoint = cloneTableCheckpoint(table);
    try {
      let rebalanced = false;
      const events: DomainEvent[] = [];
      const affected: MemoryRow[] = [];
      const touched = new Set<string>();
      const createdRows: MemoryRow[] = [];
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
            if (jsonSizeOf(op.row) > MAX_REQUEST_BYTES) {
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
            createdRows.push(row);
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
            assertNoLiveEnumOptionReference(core.tables, table, op.rowId, fail);
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
      // The receipt's rows stand the CREATED rows over the create op's
      // order (the caller's created-id read — the single-create
      // contract's `rows[0]` pin). The updated / the moved rows stand
      // the envelope's events + the revisions (a no-op contribution
      // touches no row, so the set is exact).
      const result: { rows: RowWire[] } = { rows: createdRows.map(rowWireOf) };
      if (events.length === 0) {
        // The all-no-op batch stands the no-op receipt (no envelope, no
        // head advance): the commit sequence stands the table's head.
        return noOpReceipt(ctx, table, result);
      }
      return core.publish(table, ctx.operationId, result, revisions, events, rebalanced);
    } catch (error) {
      restoreTableCheckpoint(table, checkpoint);
      throw toBridgeError(error);
    }
  });
}

async function undeleteRows(
  core: MemoryBridgeCore,
  tableId: string,
  input: { rowIds: string[] },
  ctx: MutationContext
): Promise<MutationReceipt<{ rows: RowWire[] }>> {
  const table = core.tableOf(tableId);
  const rowIds = Array.isArray(input.rowIds) ? input.rowIds : [];
  const fingerprint = core.fingerprintOf("undeleteRows", { tableId, rowIds: [...rowIds].sort() });
  return core.idempotent(ctx, fingerprint, () => {
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
    return core.publish(table, ctx.operationId, result, revisions, events, false);
  });
}

export { batchRows, undeleteRows };
