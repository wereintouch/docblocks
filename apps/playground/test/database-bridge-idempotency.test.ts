/** The in-memory reference bridge's conformance — the idempotency — the operation id's stand. */
import type { BatchOp } from "docblocks-react-ui";
import { describe, expect, it } from "vitest";

import { createMemoryDatabaseBridge } from "../src/memory-bridge";
import { codeOf, ctx, seedTable } from "./database-bridge-helpers";

describe("the idempotency — the operation id's stand", () => {
  it("the same operationId + the same body returns the stored receipt (no second effect)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, rowIds, nameColumnId } = await seedTable(bridge);
    const operationId = crypto.randomUUID();
    const body: { ops: BatchOp[] } = { ops: [{ op: "create", row: { [nameColumnId]: "Twin" }, beforeRowId: null }] };
    const first = await bridge.batchRows(tableId, body, ctx(operationId));
    const second = await bridge.batchRows(tableId, body, ctx(operationId));
    expect(second).toEqual(first);
    // No second effect: the row count stands.
    const snapshot = await bridge.snapshotTable(tableId, {});
    expect(snapshot.page.rows.length).toBe(rowIds.length + 1);
    // The reconciliation: the lost response stands the committed receipt.
    const status = await bridge.getOperationStatus(operationId);
    expect(status.state).toBe("committed");
    if (status.state === "committed") expect(status.receipt).toEqual(first);
  });

  it("the same operationId with a different body rejects with the idempotency_conflict", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, rowIds, nameColumnId } = await seedTable(bridge);
    const operationId = crypto.randomUUID();
    await bridge.batchRows(
      tableId,
      { ops: [{ op: "create", row: { [nameColumnId]: "A" }, beforeRowId: null }] },
      ctx(operationId)
    );
    const conflict = await bridge
      .batchRows(
        tableId,
        { ops: [{ op: "create", row: { [nameColumnId]: "B" }, beforeRowId: null }] },
        ctx(operationId)
      )
      .catch((error: unknown) => error);
    expect(codeOf(conflict)).toBe("idempotency_conflict");
    // The second body was never executed.
    const snapshot = await bridge.snapshotTable(tableId, {});
    expect(snapshot.page.rows.length).toBe(rowIds.length + 1);
  });

  it("the operation past the retention rejects with the idempotency_expired (never re-executed)", async () => {
    const bridge = createMemoryDatabaseBridge({ operationRetentionSeconds: 0 });
    const { tableId, rowIds, nameColumnId } = await seedTable(bridge);
    const operationId = crypto.randomUUID();
    const body: { ops: BatchOp[] } = { ops: [{ op: "create", row: { [nameColumnId]: "Late" }, beforeRowId: null }] };
    await bridge.batchRows(tableId, body, ctx(operationId));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const expired = await bridge.batchRows(tableId, body, ctx(operationId)).catch((error: unknown) => error);
    expect(codeOf(expired)).toBe("idempotency_expired");
    // The sticky tombstone: a LATER retry of the same id stands the same
    // stand (the deleted-entry stand would re-execute the operation — a
    // second effect).
    const again = await bridge.batchRows(tableId, body, ctx(operationId)).catch((error: unknown) => error);
    expect(codeOf(again)).toBe("idempotency_expired");
    const snapshot = await bridge.snapshotTable(tableId, {});
    expect(snapshot.page.rows.length).toBe(rowIds.length + 1);
    const unknown = await bridge.getOperationStatus(operationId).catch((error: unknown) => error);
    expect(codeOf(unknown)).toBe("operation_unknown");
  });

  it("the replay of a committed deleteColumn stands the stored receipt (not the not_found)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, ageColumnId } = await seedTable(bridge);
    const operationId = crypto.randomUUID();
    const first = await bridge.deleteColumn(tableId, ageColumnId, ctx(operationId));
    // The lost response stand: the replay (the same id, the same body)
    // returns the stored receipt — the column stands gone, the state
    // check must not reject the replay with the not_found.
    const replay = await bridge.deleteColumn(tableId, ageColumnId, ctx(operationId));
    expect(replay).toEqual(first);
  });

  it("the unknown operationId stands the operation_unknown (never a new mutation)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const unknown = await bridge.getOperationStatus(crypto.randomUUID()).catch((error: unknown) => error);
    expect(codeOf(unknown)).toBe("operation_unknown");
  });
});
