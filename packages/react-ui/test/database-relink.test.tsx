// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import type { BatchOp, DatabaseBridge, MutationContext } from "../src/database/bridge";
import { BridgeError } from "../src/database/bridge";
import { newMutationContext, useDatabaseTable } from "../src/database/use-database-table";

/**
 * The database table's write identity stand: a relink (the block's
 * `tableId` change) over an in-flight write drops the late tail — the
 * previous table's rollback, error note and post-commit refetch never land
 * on the relinked grid.
 */

afterEach(cleanup);

/** The write context (a fresh operation id per call). */
function ctx(): MutationContext {
  return newMutationContext();
}

/**
 * Two tables, each with a `Value` column and one row: the relinked block's
 * stand before and after the `tableId` change.
 */
async function seedTwoTables() {
  const bridge = createMemoryDatabaseBridge();
  const first = await bridge.createTable({ name: "first" }, ctx());
  const second = await bridge.createTable({ name: "second" }, ctx());
  const column = { name: "Value", type: "text", position: 0, nullable: true } as const;
  const firstCol = (await bridge.createColumn(first.result.id, { column }, ctx())).result.id;
  await bridge.createColumn(second.result.id, { column }, ctx());
  const firstRow = (
    await bridge.batchRows(
      first.result.id,
      { ops: [{ op: "create", row: { [firstCol]: "A" }, beforeRowId: null }] },
      ctx()
    )
  ).result.rows[0]!.id;
  return { bridge, firstId: first.result.id, secondId: second.result.id, firstCol, firstRow };
}

/** The bridge whose `batchRows` waits for the gate (the in-flight write). */
function gatedBridge(bridge: DatabaseBridge, gate: Promise<void>): DatabaseBridge {
  return new Proxy(bridge, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop === "batchRows") {
        return async (tableId: string, input: { ops: BatchOp[] }, context: MutationContext) => {
          await gate;
          return target.batchRows(tableId, input, context);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as DatabaseBridge;
}

describe("the database write's identity stand over a relink", () => {
  it("a rejected in-flight write of the previous table stands no rollback over the relinked grid", async () => {
    const { bridge, firstId, secondId, firstCol, firstRow } = await seedTwoTables();
    let fail: (() => void) | null = null;
    const gate = new Promise<void>((_resolve, reject) => {
      fail = () => reject(new BridgeError("unavailable", "the write's outcome is unknown"));
    });
    // The gated bridge stands ONE instance: a fresh proxy per render would
    // re-run the bootstrap effect on every render (the identity dependency).
    const gated = gatedBridge(bridge, gate);

    const { result, rerender } = renderHook(({ table }: { table: string }) => useDatabaseTable(gated, table), {
      initialProps: { table: firstId },
    });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    let operation: Promise<void> | null = null;
    await act(async () => {
      operation = result.current.updateRow(firstRow, { [firstCol]: "B" });
    });
    // The relink while the write is in flight.
    rerender({ table: secondId });
    await waitFor(() => expect(result.current.table?.name).toBe("second"));
    fail!();
    await act(async () => {
      await expect(operation).rejects.toThrow();
    });
    // The fresh table's grid stands intact: no rows of the previous table
    // and no error note about its failure.
    expect(result.current.rows).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.phase).toBe("ready");
  });

  it("a committed in-flight write of the previous table stands no refetch over the relinked grid", async () => {
    const { bridge, firstId, secondId, firstCol, firstRow } = await seedTwoTables();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gated = gatedBridge(bridge, gate);

    const { result, rerender } = renderHook(({ table }: { table: string }) => useDatabaseTable(gated, table), {
      initialProps: { table: firstId },
    });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    let operation: Promise<void> | null = null;
    await act(async () => {
      operation = result.current.updateRow(firstRow, { [firstCol]: "B" });
    });
    rerender({ table: secondId });
    await waitFor(() => expect(result.current.table?.name).toBe("second"));
    release!();
    await act(async () => {
      await operation;
    });
    // The fresh table's page stands: no rows of the previous table, the
    // ready phase (no superseded bootstrap left loading), no undo entry
    // carried into the new table's history.
    expect(result.current.rows).toEqual([]);
    expect(result.current.phase).toBe("ready");
    expect(result.current.canUndo).toBe(false);
  });
});
