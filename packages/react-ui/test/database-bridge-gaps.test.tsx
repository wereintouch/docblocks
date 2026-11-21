// @vitest-environment jsdom
// The data provider's stream losses: a dropped frame (the transport's loss —
// the next frame's prevSeq names the missing one) stands the full rebaseline
// over the fresh snapshot, and a `permission_lost` frame stands the death
// (the sensitive cache cleared, the delivery stopped).
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  DatabaseBridge,
  MutationContext,
  SubscriptionHandle,
  SubscriptionObserver,
  TableEvent,
} from "../src/database/bridge";
import { useDatabaseTable } from "../src/database/use-database-table";

function ctx(): MutationContext {
  return { operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() };
}

/** Seeds the table (the Name column + two rows). */
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

describe("the data provider's stream losses", () => {
  it("a dropped frame stands the full rebaseline (the fresh snapshot carries the missed write)", async () => {
    const real = createMemoryDatabaseBridge();
    const seeded = await seed(real);
    let subscriptions = 0;
    let dropped = false;
    // The lossy transport: the first subscription's first delivered frame
    // never reaches the client (the network's drop), so the next frame's
    // prevSeq names a frame the client never applied.
    const lossy: DatabaseBridge = {
      ...real,
      subscribeTable: (tableId: string, input: { afterSeq: number }, observer: SubscriptionObserver) => {
        subscriptions += 1;
        if (subscriptions !== 1) return real.subscribeTable(tableId, input, observer) as SubscriptionHandle;
        return real.subscribeTable(tableId, input, {
          ...observer,
          event: (envelope: TableEvent) => {
            if (!dropped) {
              dropped = true;
              return;
            }
            observer.event(envelope);
          },
        }) as SubscriptionHandle;
      },
    };
    const { result } = renderHook(() => useDatabaseTable(lossy, seeded.tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.rows.length).toBe(2);

    // The first write's frame stands dropped; the second write's frame
    // chains to it — the client detects the loss and rebaselines.
    await real.batchRows(
      seeded.tableId,
      { ops: [{ op: "create", row: { [seeded.nameColumnId]: "Carol" }, beforeRowId: null }] },
      ctx()
    );
    await real.batchRows(
      seeded.tableId,
      { ops: [{ op: "create", row: { [seeded.nameColumnId]: "Dave" }, beforeRowId: null }] },
      ctx()
    );
    await waitFor(() => expect(subscriptions).toBe(2));
    // The fresh snapshot carries both writes: the lost frame's row stands
    // in the page (the rebaseline is the loss' recovery, not a stale page).
    await waitFor(() => expect(result.current.rows.length).toBe(4));
    expect(result.current.rows.map((row) => row.cells[seeded.nameColumnId])).toEqual(["Alice", "Bob", "Carol", "Dave"]);
    expect(result.current.phase).toBe("ready");
  });

  it("the `permission_lost` reset stands the fresh bootstrap (the rebaseline is the loss' recovery)", async () => {
    const real = createMemoryDatabaseBridge();
    const seeded = await seed(real);
    let observer: SubscriptionObserver | null = null;
    let subscriptions = 0;
    const wrapped: DatabaseBridge = {
      ...real,
      subscribeTable: (tableId: string, input: { afterSeq: number }, subscriber: SubscriptionObserver) => {
        subscriptions += 1;
        observer = subscriber;
        return real.subscribeTable(tableId, input, subscriber) as SubscriptionHandle;
      },
    };
    const { result } = renderHook(() => useDatabaseTable(wrapped, seeded.tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(subscriptions).toBe(1);

    // The access's change over the live stream: the bridge closes the
    // replay stand and names `permission_lost` — the client's stand is the
    // fresh bootstrap (the snapshot + the re-subscription), never a silent
    // continuation over the stale stream.
    const write = real.batchRows(
      seeded.tableId,
      { ops: [{ op: "create", row: { [seeded.nameColumnId]: "Carol" }, beforeRowId: null }] },
      ctx()
    );
    observer!.reset({ code: "permission_lost" });
    await write;
    await waitFor(() => expect(subscriptions).toBe(2));
    await waitFor(() => expect(result.current.rows.length).toBe(3));
    expect(result.current.phase).toBe("ready");
    expect(result.current.errorCode).toBeNull();
  });
});
