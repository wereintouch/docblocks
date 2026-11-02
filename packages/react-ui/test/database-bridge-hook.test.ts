// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  BatchOp,
  DatabaseBridge,
  MutationContext,
  PageQuery,
  SubscriptionObserver,
  TableEvent,
} from "../src/database/bridge";
import { BridgeError } from "../src/database/bridge";
import { createMemoryDatabaseBridge } from "../src/database/memory-bridge";
import { useDatabaseTable } from "../src/database/use-database-table";

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
  it("bootstraps over the snapshot → subscribe order and maps the wire schema to the grid's stand", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const { result } = renderHook(() => useDatabaseTable(bridge, seeded.tableId));
    expect(result.current.phase).toBe("loading");
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.table?.name).toBe("People");
    expect(result.current.table?.columns.map((column) => column.name)).toEqual(["Name"]);
    expect(result.current.rows.map((row) => row.rowId)).toEqual(seeded.rowIds);
    expect(result.current.rows[0]?.cells[seeded.nameColumnId]).toBe("Alice");
    // The negotiated capabilities stand the optional paths' gate.
    for (const capability of ["rowRestore", "columnRestore", "cas", "serverSort", "mixedBatch"]) {
      expect(result.current.capabilities).toContain(capability);
    }
    expect(result.current.errorCode).toBeNull();
  });

  it("refetches the page over the event and stands the subscription alive (the second write delivers)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const { result } = renderHook(() => useDatabaseTable(bridge, seeded.tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    // The peer's write (the direct bridge surface — the push channel's
    // delivery): the event stands the page refetch.
    await bridge.batchRows(
      seeded.tableId,
      { ops: [{ op: "create", row: { [seeded.nameColumnId]: "Zed" }, beforeRowId: null }] },
      ctx()
    );
    await waitFor(() => expect(result.current.rows.length).toBe(3));
    expect(result.current.rows.at(-1)?.cells[seeded.nameColumnId]).toBe("Zed");
    // The subscription stands alive over the refetch: the next write
    // delivers too.
    await bridge.batchRows(
      seeded.tableId,
      { ops: [{ op: "create", row: { [seeded.nameColumnId]: "Yan" }, beforeRowId: null }] },
      ctx()
    );
    await waitFor(() => expect(result.current.rows.length).toBe(4));
    expect(result.current.rows.at(-1)?.cells[seeded.nameColumnId]).toBe("Yan");
  });

  it("the stale duplicate envelope stands the drop (no rebaseline loop over the redelivery)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    let snapshotCalls = 0;
    let subscriptions = 0;
    let liveObserver: SubscriptionObserver | null = null;
    let captured: TableEvent | null = null;
    const wrapped: DatabaseBridge = {
      ...bridge,
      snapshotTable: async (tableId: string, query: PageQuery) => {
        snapshotCalls += 1;
        return bridge.snapshotTable(tableId, query);
      },
      subscribeTable: (tableId: string, input: { afterSeq: number }, observer: SubscriptionObserver) => {
        subscriptions += 1;
        liveObserver = observer;
        return bridge.subscribeTable(
          tableId,
          input,
          {
            ...observer,
            event: (envelope) => {
              captured = envelope;
              observer.event(envelope);
            },
          }
        );
      },
    } as unknown as DatabaseBridge;
    const { result } = renderHook(() => useDatabaseTable(wrapped, seeded.tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    // The peer's write: the envelope stands the refetch (captured for the
    // redelivery below).
    await bridge.batchRows(
      seeded.tableId,
      { ops: [{ op: "create", row: { [seeded.nameColumnId]: "Late" }, beforeRowId: null }] },
      ctx()
    );
    await waitFor(() => expect(result.current.rows.length).toBe(3));
    const envelope = captured;
    if (envelope === null) throw new Error("the envelope was not captured");
    // The forced rebaseline (the reset signal): the bootstrap clears the
    // dedup set (the stand — the redelivery below stands the stale class).
    const snapshotsAfterBootstrap = snapshotCalls;
    liveObserver!.reset({ code: "replay_expired" });
    await waitFor(() => expect(subscriptions).toBe(2));
    // The at-least-once redelivery of the ALREADY-SEEN envelope (the seq at
    // the fresh head, absent from the cleared dedup set): the stale
    // duplicate stands the drop — no rebaseline over the redelivery (the
    // loop stand) and the page stands intact.
    const live = liveObserver!;
    live.event({ ...(envelope as TableEvent) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(subscriptions).toBe(2);
    expect(snapshotCalls).toBe(snapshotsAfterBootstrap + 1);
    expect(result.current.phase).toBe("ready");
    expect(result.current.rows.length).toBe(3);
  });

  it("the fatal not_found over the bootstrap stands the death (the stale rows stand cleared, the phase broken)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const { result, rerender } = renderHook((tableId: string) => useDatabaseTable(bridge, tableId), {
      initialProps: seeded.tableId,
    });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.rows.length).toBe(2);
    // The relink to the dead table (the block's tableId over the deleted
    // one): the bootstrap's not_found stands the death (the contract's
    // stand: the operation stops, the sensitive cache stands cleared).
    rerender("t-dead-table");
    await waitFor(() => expect(result.current.phase).toBe("broken"));
    expect(result.current.errorCode).toBe("not_found");
    // The sensitive cache stands cleared (the stale rows / the cursor /
    // the revisions of the live table are not a stand over the dead one).
    expect(result.current.rows).toEqual([]);
    expect(result.current.nextCursor).toBeNull();
  });

  it("the fatal not_found over the refetch stands the death (the page cleared, the delivery stopped)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    let snapshotCalls = 0;
    let liveObserver: SubscriptionObserver | null = null;
    let headSeq = 0;
    let unsubscribed = 0;
    const wrapped: DatabaseBridge = {
      ...bridge,
      snapshotTable: async (tableId: string, query: PageQuery) => {
        snapshotCalls += 1;
        // The second snapshot stands the table's death (the deleted-table
        // stand — the first one stands the bootstrap).
        if (snapshotCalls >= 2) throw new BridgeError("not_found", 'The table "t-dead" is unknown.');
        return bridge.snapshotTable(tableId, query);
      },
      subscribeTable: (tableId: string, input: { afterSeq: number }, observer: SubscriptionObserver) => {
        liveObserver = observer;
        const handle = bridge.subscribeTable(
          tableId,
          input,
          { ...observer, ready: (value) => { headSeq = value.headSeq; observer.ready(value); } }
        );
        return {
          unsubscribe: () => {
            unsubscribed += 1;
            handle.unsubscribe();
          },
        };
      },
    } as unknown as DatabaseBridge;
    const { result } = renderHook(() => useDatabaseTable(wrapped, seeded.tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.rows.length).toBe(2);
    // The stream's invalidate stands the refetch — the refetch hits the
    // dead table (the fatal code): the page stands cleared, the phase
    // stands broken, the delivery stands stopped (the unsubscribe).
    liveObserver!.event({
      tableId: seeded.tableId,
      seq: headSeq + 1,
      prevSeq: headSeq,
      txId: "tx-death",
      kind: "invalidate",
      originSessionId: null,
      operationId: null,
      receipt: null,
      events: [],
    });
    await waitFor(() => expect(result.current.phase).toBe("broken"));
    expect(result.current.errorCode).toBe("not_found");
    expect(result.current.rows).toEqual([]);
    expect(unsubscribed).toBe(1);
  });

  it("the protocol mismatch stands the broken phase + the structured code (no silent downgrade)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const descriptor = await bridge.describeProtocol();
    const badBridge = {
      ...bridge,
      describeProtocol: async () => ({ ...descriptor, protocolVersion: 1 as unknown as 2 }),
    } as unknown as DatabaseBridge;
    const { result } = renderHook(() => useDatabaseTable(badBridge, seeded.tableId));
    await waitFor(() => expect(result.current.phase).toBe("broken"));
    expect(result.current.errorCode).toBe("protocol_mismatch");
  });

  it("insertRow stands the receipt's row id; the undo stands the inverse remove (the redo re-creates)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const { result } = renderHook(() => useDatabaseTable(bridge, seeded.tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    const rowId = await result.current.insertRow({ [seeded.nameColumnId]: "New" });
    expect(rowId).toBeDefined();
    await waitFor(() => expect(result.current.rows.length).toBe(3));
    expect(result.current.canUndo).toBe(true);
    await result.current.undo();
    await waitFor(() => expect(result.current.rows.length).toBe(2));
    expect(result.current.canRedo).toBe(true);
    await result.current.redo();
    await waitFor(() => expect(result.current.rows.length).toBe(3));
    expect(result.current.rows.at(-1)?.cells[seeded.nameColumnId]).toBe("New");
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
