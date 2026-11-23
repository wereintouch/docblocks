// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BatchOp, DatabaseBridge, MutationContext, PageQuery } from "../src/database/bridge";
import { BridgeError } from "../src/database/bridge";
import { useDatabaseTable } from "../src/database/use-database-table";

// The data provider hook's pending-row stand (the pending row's lifecycle over the edit's focus).

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
  it("the relink over the in-flight inverse stands the drop (the old op stands not carried into the new table's history)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const other = await bridge.createTable({ name: "Other" }, ctx());
    let calls = 0;
    let releaseGate: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const spyBridge = {
      ...bridge,
      batchRows: async (tableId: string, input: { ops: BatchOp[] }, context: MutationContext) => {
        calls += 1;
        if (calls === 2) await gate; // the inverse's stand (the insert's undo) holds in flight
        return bridge.batchRows(tableId, input, context);
      },
    } as unknown as DatabaseBridge;
    const { result, rerender } = renderHook((tableId: string) => useDatabaseTable(spyBridge, tableId), {
      initialProps: seeded.tableId,
    });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await result.current.insertRow({ [seeded.nameColumnId]: "Relinked" });
    await waitFor(() => expect(result.current.rows.length).toBe(3));
    const undoPromise = result.current.undo(); // the inverse stands in flight (the gate)
    // The relink to the other table over the in-flight inverse: the history
    // stands cleared (the per-(bridge, tableId) stand).
    rerender(other.result.id);
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    releaseGate!();
    await undoPromise;
    // The old op stands NOT carried into the new table's history (the redo
    // / the undo stand empty over the relink) — the stand is observed over
    // the settled render (a stale result.current is not a stand).
    await waitFor(() => expect(result.current.canUndo).toBe(false), { timeout: 1000 });
    await waitFor(() => expect(result.current.canRedo).toBe(false), { timeout: 1000 });
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
  it("keeps a filtered-out insert pending until it is dismissed", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const filter = {
      logic: "and" as const,
      conditions: [{ columnId: seeded.nameColumnId, op: "is", value: "Alice" }],
    };
    const { result } = renderHook(() => useDatabaseTable(bridge, seeded.tableId, filter));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.rows).toHaveLength(1);

    const rowId = await result.current.insertRow({ [seeded.nameColumnId]: "Bob" });
    await waitFor(() => expect(result.current.pendingRow?.rowId).toBe(rowId));
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.pendingRow?.cells[seeded.nameColumnId]).toBe("Bob");
    await waitFor(() => expect(result.current.revisionOf(rowId)).toBeDefined());

    result.current.dismissPendingRow();
    await waitFor(() => expect(result.current.pendingRow).toBeNull());
    const snapshot = await bridge.snapshotTable(seeded.tableId, {});
    expect(snapshot.page.rows.some((row) => row.id === rowId)).toBe(true);
  });
  it("does not mark a matching insert as pending before its snapshot arrives", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    let snapshotCalls = 0;
    let releaseSnapshot: () => void = () => undefined;
    const snapshotGate = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });
    const wrapped: DatabaseBridge = {
      ...bridge,
      snapshotTable: async (tableId: string, query: PageQuery) => {
        snapshotCalls += 1;
        if (snapshotCalls >= 2) await snapshotGate;
        return bridge.snapshotTable(tableId, query);
      },
    } as unknown as DatabaseBridge;
    const filter = {
      logic: "and" as const,
      conditions: [{ columnId: seeded.nameColumnId, op: "is", value: "Alice" }],
    };
    const { result } = renderHook(() => useDatabaseTable(wrapped, seeded.tableId, filter));
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    await result.current.insertRow({ [seeded.nameColumnId]: "Alice" });
    expect(result.current.pendingRow).toBeNull();
    releaseSnapshot();
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.pendingRow).toBeNull();
  });
  it("normalizes a pending row when an edit makes it match the filter", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const filter = {
      logic: "and" as const,
      conditions: [{ columnId: seeded.nameColumnId, op: "is", value: "Alice" }],
    };
    const { result } = renderHook(() => useDatabaseTable(bridge, seeded.tableId, filter));
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    const rowId = await result.current.insertRow({ [seeded.nameColumnId]: "Bob" });
    await waitFor(() => expect(result.current.pendingRow?.rowId).toBe(rowId));
    await result.current.updateRow(rowId, { [seeded.nameColumnId]: "Alice" });
    await waitFor(() => {
      expect(result.current.pendingRow).toBeNull();
      expect(result.current.rows).toHaveLength(2);
    });
    expect(result.current.rows.at(-1)?.cells[seeded.nameColumnId]).toBe("Alice");
  });
  it("clears a pending insert when the row is removed", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const filter = {
      logic: "and" as const,
      conditions: [{ columnId: seeded.nameColumnId, op: "is", value: "Alice" }],
    };
    const { result } = renderHook(() => useDatabaseTable(bridge, seeded.tableId, filter));
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    const rowId = await result.current.insertRow({ [seeded.nameColumnId]: "Bob" });
    await waitFor(() => expect(result.current.pendingRow?.rowId).toBe(rowId));
    await result.current.removeRow(rowId);
    await waitFor(() => expect(result.current.pendingRow).toBeNull());
    const snapshot = await bridge.snapshotTable(seeded.tableId, {});
    expect(snapshot.page.rows.some((row) => row.id === rowId)).toBe(false);
  });
  it("restores pending cells when their update is rejected", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const wrapped = new Proxy(bridge, {
      get(target, property, receiver) {
        if (property === "batchRows") {
          return async (tableId: string, input: { ops: BatchOp[] }, context: MutationContext) => {
            if (input.ops.some((op) => op.op === "update")) {
              throw new BridgeError("unavailable", "The update was rejected.");
            }
            return target.batchRows(tableId, input, context);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as DatabaseBridge;
    const filter = {
      logic: "and" as const,
      conditions: [{ columnId: seeded.nameColumnId, op: "is", value: "Alice" }],
    };
    const { result } = renderHook(() => useDatabaseTable(wrapped, seeded.tableId, filter));
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    const rowId = await result.current.insertRow({ [seeded.nameColumnId]: "Bob" });
    await waitFor(() => expect(result.current.pendingRow?.rowId).toBe(rowId));
    await expect(result.current.updateRow(rowId, { [seeded.nameColumnId]: "Changed" })).rejects.toMatchObject({
      code: "unavailable",
    });
    await waitFor(() => expect(result.current.pendingRow?.cells[seeded.nameColumnId]).toBe("Bob"));
  });
  it("clears a pending insert when its undo removes the row", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = await seed(bridge);
    const filter = {
      logic: "and" as const,
      conditions: [{ columnId: seeded.nameColumnId, op: "is", value: "Alice" }],
    };
    const { result } = renderHook(() => useDatabaseTable(bridge, seeded.tableId, filter));
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    const rowId = await result.current.insertRow({ [seeded.nameColumnId]: "Bob" });
    await waitFor(() => expect(result.current.pendingRow?.rowId).toBe(rowId));
    await result.current.undo();
    await waitFor(() => expect(result.current.pendingRow).toBeNull());
    const snapshot = await bridge.snapshotTable(seeded.tableId, {});
    expect(snapshot.page.rows.some((row) => row.id === rowId)).toBe(false);
  });
});
