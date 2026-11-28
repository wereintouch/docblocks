// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { act } from "react";

import type { DatabaseFilterPayload } from "docblocks-core";

import type {
  BatchOp,
  DatabaseBridge,
  MutationContext,
  PageQuery,
  SubscriptionObserver,
  TableEvent,
} from "../src/database/bridge";
import { BridgeError } from "../src/database/bridge";
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
  it("keeps the current rows ready while a filter change awaits its snapshot", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    let snapshotCalls = 0;
    let releaseFilter = (): void => undefined;
    const filterGate = new Promise<void>((resolve) => {
      releaseFilter = resolve;
    });
    const gated: DatabaseBridge = {
      ...bridge,
      snapshotTable: async (tableId: string, query: PageQuery) => {
        snapshotCalls += 1;
        if (snapshotCalls === 2) await filterGate;
        return bridge.snapshotTable(tableId, query);
      },
    };
    const { result, rerender } = renderHook(
      ({ filter }: { filter?: DatabaseFilterPayload }) => useDatabaseTable(gated, seeded.tableId, filter),
      { initialProps: { filter: undefined } as { filter?: DatabaseFilterPayload } }
    );
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    rerender({
      filter: {
        logic: "and",
        conditions: [{ columnId: seeded.nameColumnId, op: "is", value: "Alice" }],
      },
    });
    await waitFor(() => expect(snapshotCalls).toBe(2));
    expect(result.current.phase).toBe("ready");
    expect(result.current.rows.map((row) => row.rowId)).toEqual(seeded.rowIds);
    await act(async () => {
      releaseFilter();
      await filterGate;
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.rows[0]?.cells[seeded.nameColumnId]).toBe("Alice");
    expect(result.current.phase).toBe("ready");
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
        return bridge.subscribeTable(tableId, input, {
          ...observer,
          event: (envelope) => {
            captured = envelope;
            observer.event(envelope);
          },
        });
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
        const handle = bridge.subscribeTable(tableId, input, {
          ...observer,
          ready: (value) => {
            headSeq = value.headSeq;
            observer.ready(value);
          },
        });
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
  it("the fatal forbidden over the bootstrap stands the death (the not_found's parity)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const wrapped: DatabaseBridge = {
      ...bridge,
      snapshotTable: async (tableId: string, query: PageQuery) => {
        if (tableId === seeded.tableId) throw new BridgeError("forbidden", "The access to the table was revoked.");
        return bridge.snapshotTable(tableId, query);
      },
    } as unknown as DatabaseBridge;
    const { result } = renderHook(() => useDatabaseTable(wrapped, seeded.tableId));
    // The `forbidden` code stands the table-level fatal stand: the death
    // (the sensitive cache's clear, the broken phase — the not_found's
    // parity over the read's path).
    await waitFor(() => expect(result.current.phase).toBe("broken"));
    expect(result.current.errorCode).toBe("forbidden");
    expect(result.current.rows).toEqual([]);
  });
  it("the re-entrant undo stands the drop (the inverse stands once, not twice)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    let batchCalls = 0;
    const spyBridge = {
      ...bridge,
      batchRows: (tableId: string, input: { ops: BatchOp[] }, context: MutationContext) => {
        batchCalls += 1;
        return bridge.batchRows(tableId, input, context);
      },
    } as unknown as DatabaseBridge;
    const { result } = renderHook(() => useDatabaseTable(spyBridge, seeded.tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await result.current.insertRow({ [seeded.nameColumnId]: "Par" });
    await waitFor(() => expect(result.current.rows.length).toBe(3));
    const beforeUndo = batchCalls;
    // The parallel undo (the second press over the first's in-flight
    // inverse): the inverse stands ONCE (the re-entrant call stands the
    // drop, not the second inverse over the same entry).
    void result.current.undo();
    void result.current.undo();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(batchCalls).toBe(beforeUndo + 1);
    expect(result.current.rows.length).toBe(2);
  });
});
