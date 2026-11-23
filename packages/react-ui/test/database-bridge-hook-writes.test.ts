// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BatchOp, DatabaseBridge, MutationContext, TableEvent } from "../src/database/bridge";
import { useDatabaseTable } from "../src/database/use-database-table";

// The data provider hook's write's tails (the rollback, the error note, the relink's identity).

function ctx(operationId?: string): MutationContext {
  return { operationId: operationId ?? crypto.randomUUID(), issuedAt: new Date().toISOString() };
}

/** Seeds the table (the Name column + the given rows). */
async function seed(bridge: ReturnType<typeof createMemoryDatabaseBridge>) {
  const table = await bridge.createTable({ name: "People" }, ctx());
  const column = await bridge.createColumn(
    table.result.id,
    { column: { name: "Name", type: "text", position: 0, nullable: true } },
    ctx()
  );
  const rowIds: string[] = [];
  for (const name of ["Alice", "Bob"]) {
    const receipt = await bridge.batchRows(
      table.result.id,
      { ops: [{ op: "create", row: { [column.result.id]: name }, beforeRowId: null }] },
      ctx()
    );
    rowIds.push(receipt.result.rows[0]!.id);
  }
  return { tableId: table.result.id, nameColumnId: column.result.id, rowIds };
}

describe("the data provider hook — the bootstrap + the stream's stands", () => {
  it("the mixed paste stands the one batch (the updates + the overflow's creates) + the one undo", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge); // Alice, Bob
    const { result } = renderHook(() => useDatabaseTable(bridge, seeded.tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    const [r1] = seeded.rowIds;
    // The paste: 3 values over the 2 loaded rows — the 2 updates + the
    // 1 create (the overflow).
    const createdIds = await result.current.pasteRows({
      updates: [
        { rowId: r1!, cells: { [seeded.nameColumnId]: "№1" } },
        { rowId: seeded.rowIds[1]!, cells: { [seeded.nameColumnId]: "№2" } },
      ],
      creates: [{ [seeded.nameColumnId]: "№3" }],
      beforeRowId: null,
    });
    expect(createdIds).toHaveLength(1);
    await waitFor(() => expect(result.current.rows.length).toBe(3));
    expect(result.current.rows[0]!.cells[seeded.nameColumnId]).toBe("№1");
    expect(result.current.rows[1]!.cells[seeded.nameColumnId]).toBe("№2");
    expect(result.current.rows[2]!.cells[seeded.nameColumnId]).toBe("№3");
    // The one undo: the updates' restore + the created row's deletion.
    expect(result.current.canUndo).toBe(true);
    await result.current.undo();
    await waitFor(() => expect(result.current.rows.length).toBe(2));
    expect(result.current.rows[0]!.cells[seeded.nameColumnId]).toBe("Alice");
    expect(result.current.rows[1]!.cells[seeded.nameColumnId]).toBe("Bob");
    // The redo stands the batch again (the created row over the fresh id).
    await result.current.redo();
    await waitFor(() => expect(result.current.rows.length).toBe(3));
    expect(result.current.rows[2]!.cells[seeded.nameColumnId]).toBe("№3");
  });
  it("the all-unchanged paste over no creates stands the no-op (no bridge call, no undo entry)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const { result } = renderHook(() => useDatabaseTable(bridge, seeded.tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    const [r1] = seeded.rowIds;
    await result.current.pasteRows({
      updates: [{ rowId: r1!, cells: { [seeded.nameColumnId]: "Alice" } }], // the same value
      creates: [],
      beforeRowId: null,
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.error).toBeNull();
  });
  it("the failed undo entry stands retryable (the entry stays on the stack)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const { result } = renderHook(() => useDatabaseTable(bridge, seeded.tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    const rowId = await result.current.insertRow({ [seeded.nameColumnId]: "Doomed" });
    await waitFor(() => expect(result.current.rows.length).toBe(3));
    await result.current.removeRow(rowId);
    await waitFor(() => expect(result.current.rows.length).toBe(2));
    // The peer's GC drops the tombstone (the reference's stand): the
    // inverse stands the safe not_found.
    bridge.gcTable(seeded.tableId);
    await result.current.undo();
    await waitFor(() => expect(result.current.errorCode).toBe("not_found"));
    // The entry stands on the stack (the retry stand).
    expect(result.current.canUndo).toBe(true);
  });
  it("the CAS stand: the `cas` capability selects the expectedRevision over the live revision", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const calls: Array<{ ops: BatchOp[] }> = [];
    const spyBridge = {
      ...bridge,
      batchRows: (tableId: string, input: { ops: BatchOp[] }, context: MutationContext) => {
        calls.push(input);
        return bridge.batchRows(tableId, input, context);
      },
    } as unknown as DatabaseBridge;
    const { result } = renderHook(() => useDatabaseTable(spyBridge, seeded.tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.capabilities).toContain("cas");
    const rowId = seeded.rowIds[0]!;
    const revision = result.current.revisionOf(rowId);
    expect(revision).toBeDefined();
    await result.current.updateRow(rowId, { [seeded.nameColumnId]: "Edited" });
    expect(calls.at(-1)!.ops[0]!).toMatchObject({ expectedRevision: revision });
  });
  it("the CAS stand: the absent `cas` capability stands the LWW default (no expectedRevision)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const descriptor = await bridge.describeProtocol();
    const calls: Array<{ ops: BatchOp[] }> = [];
    const nonCasBridge = {
      ...bridge,
      describeProtocol: async () => ({
        ...descriptor,
        capabilities: descriptor.capabilities.filter((capability) => capability !== "cas"),
      }),
      batchRows: (tableId: string, input: { ops: BatchOp[] }, context: MutationContext) => {
        calls.push(input);
        return bridge.batchRows(tableId, input, context);
      },
    } as unknown as DatabaseBridge;
    const { result } = renderHook(() => useDatabaseTable(nonCasBridge, seeded.tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.capabilities).not.toContain("cas");
    const rowId = seeded.rowIds[0]!;
    // The live revision is known (the CAS would stand) — the capability's
    // absence stands the LWW default (the expectedRevision is not sent to
    // a bridge that does not stand the capability).
    expect(result.current.revisionOf(rowId)).toBeDefined();
    await result.current.updateRow(rowId, { [seeded.nameColumnId]: "Edited" });
    expect(calls.at(-1)!.ops[0]!).not.toHaveProperty("expectedRevision");
  });
  it("the failed write stands the optimistic rollback over the pre-op snapshot", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const { result } = renderHook(() => useDatabaseTable(bridge, seeded.tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    const rowId = seeded.rowIds[0]!;
    // The peer deletes the row (the event's refetch stands the fresh state)
    // — the hook's write over the gone row stands the not_found rejection.
    await bridge.batchRows(seeded.tableId, { ops: [{ op: "delete", rowId }] }, ctx());
    await waitFor(() => expect(result.current.rows.length).toBe(1));
    await expect(result.current.updateRow(rowId, { [seeded.nameColumnId]: "Ghost" })).rejects.toThrow();
    await waitFor(() => expect(result.current.errorCode).toBe("not_found"));
    expect(result.current.rows.length).toBe(1);
  });
  it("the pinned-revision write over the peer's mid-session commit stands the conflict (the peer's value stands)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const { result } = renderHook(() => useDatabaseTable(bridge, seeded.tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    const rowId = seeded.rowIds[0]!;
    // The draft session's open stand: the revision as of the open (the
    // read's surface).
    const openRevision = result.current.revisionOf(rowId);
    expect(openRevision).toBeDefined();
    // The peer's commit over the same row (the event's refetch re-baselines
    // the hook's live revision map over the fresh revision).
    await bridge.batchRows(
      seeded.tableId,
      { ops: [{ op: "update", rowId, cells: { [seeded.nameColumnId]: "peer" } }] },
      ctx()
    );
    await waitFor(() => expect(result.current.rows[0]?.cells[seeded.nameColumnId]).toBe("peer"));
    // The draft session's close commits over the open-time pin: the stale
    // CAS rejects (the conflict) — the peer's value stands (no silent
    // overwrite).
    await expect(result.current.updateRow(rowId, { [seeded.nameColumnId]: "local" }, openRevision)).rejects.toThrow();
    await waitFor(() => expect(result.current.errorCode).toBe("conflict"));
    expect(result.current.rows[0]?.cells[seeded.nameColumnId]).toBe("peer");
    // The un-pinned stand reads the live revision (the LWW's default):
    // the explicit write commits over it.
    await result.current.updateRow(rowId, { [seeded.nameColumnId]: "local" });
    await waitFor(() => expect(result.current.rows[0]?.cells[seeded.nameColumnId]).toBe("local"));
  });
  it("dedups the at-least-once replay and rebaselines on the broken prevSeq chain", async () => {
    const real = createMemoryDatabaseBridge();
    const seeded = await seed(real);
    // The synthetic envelopes over the real table's wire stand: the valid
    // frame (chained to the snapshot's R), its at-least-once duplicate,
    // then the gapped frame (its prevSeq skips the applied one).
    const baseline = await real.snapshotTable(seeded.tableId, { limit: 10 });
    const R = baseline.page.asOfSeq;
    const wire = baseline.page.rows[0]!;
    const synthetic = (seq: number, prevSeq: number | null): TableEvent => ({
      tableId: seeded.tableId,
      seq,
      prevSeq,
      txId: `tx-${seq}`,
      kind: "commit",
      originSessionId: "session-synthetic",
      operationId: `op-${seq}`,
      receipt: { operationId: `op-${seq}`, txId: `tx-${seq}`, committedSeq: seq, result: {}, revisions: {} },
      events: [{ type: "row.updated", payload: { row: wire } }],
    });
    let snapshotCalls = 0;
    let subscribeCalls = 0;
    const bridge: DatabaseBridge = {
      ...real,
      snapshotTable: (tableId, query) => {
        snapshotCalls += 1;
        return real.snapshotTable(tableId, query);
      },
      subscribeTable: (tableId, input, observer) => {
        subscribeCalls += 1;
        if (subscribeCalls !== 1) return real.subscribeTable(tableId, input, observer);
        const applied = synthetic(R + 1, R);
        const gapped = synthetic(R + 2, R);
        setTimeout(() => observer.event(applied), 0);
        setTimeout(() => observer.event(applied), 5);
        setTimeout(() => observer.event(gapped), 10);
        return real.subscribeTable(tableId, input, {
          ready: () => undefined,
          event: () => undefined,
          status: () => undefined,
          error: () => undefined,
          reset: () => undefined,
        });
      },
    };
    const { result } = renderHook(() => useDatabaseTable(bridge, seeded.tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    // The scripted deliveries + the refetch / the rebaseline settle over
    // the real bridge's instant resolutions.
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The duplicate stands no re-apply (the seen-seq's dedup); the broken
    // chain stands the full rebaseline: the fresh snapshot + the
    // re-subscription over the fresh R — the total stand of the three
    // snapshots (the bootstrap, the applied frame's refetch, the
    // rebaseline) and the two subscriptions.
    expect(snapshotCalls).toBe(3);
    expect(subscribeCalls).toBe(2);
    expect(result.current.phase).toBe("ready");
    expect(result.current.rows.map((row) => row.rowId)).toEqual(seeded.rowIds);
  });
});
