// @vitest-environment jsdom
// The undo stack's per-(bridge, tableId) identity (the relink's reset, the
// bridge swap's stand, the in-flight op's drop over the relink).
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import type { BatchOp, DatabaseBridge, MutationContext } from "../src/database/bridge";
import { useDatabaseTable } from "../src/database/use-database-table";
import { cellsOf, ctx } from "./database-integrity.helpers";

afterEach(cleanup);

describe("the forward-only undo/redo over the bridge", () => {
  it("the undo stack does not target a previous table after relinking", async () => {
    const bridge = createMemoryDatabaseBridge();
    const first = await bridge.createTable({ name: "First" }, ctx());
    const second = await bridge.createTable({ name: "Second" }, ctx());
    const firstValueCol = (
      await bridge.createColumn(
        first.result.id,
        { column: { name: "Value", type: "text", position: 0, nullable: true } },
        ctx()
      )
    ).result.id;
    await bridge.createColumn(
      second.result.id,
      { column: { name: "Value", type: "text", position: 0, nullable: true } },
      ctx()
    );
    const firstRow = (
      await bridge.batchRows(
        first.result.id,
        { ops: [{ op: "create", row: { [firstValueCol]: "A" }, beforeRowId: null }] },
        ctx()
      )
    ).result.rows[0]!.id;

    const { result, rerender } = renderHook(({ table }: { table: string }) => useDatabaseTable(bridge, table), {
      initialProps: { table: first.result.id },
    });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => {
      await result.current.updateRow(firstRow, { [firstValueCol]: "B" });
    });
    expect(result.current.canUndo).toBe(true);
    // Relink the hook to a different table: the history stands dropped
    // (the stacks stand per table), the undo stands unavailable.
    rerender({ table: second.result.id });
    await waitFor(() => expect(result.current.table?.name).toBe("Second"));
    expect(result.current.canUndo).toBe(false);
    await act(async () => {
      await result.current.undo();
    });
    expect((await cellsOf(bridge, first.result.id, firstRow))?.[firstValueCol]).toBe("B");
  });

  it("the undo stack does not target a previous bridge after the bridge swap", async () => {
    const firstBridge = createMemoryDatabaseBridge();
    const secondBridge = createMemoryDatabaseBridge();
    const first = await firstBridge.createTable({ name: "bridge first" }, ctx());
    const second = await secondBridge.createTable({ name: "bridge second" }, ctx());
    const firstValueCol = (
      await firstBridge.createColumn(
        first.result.id,
        { column: { name: "Value", type: "text", position: 0, nullable: true } },
        ctx()
      )
    ).result.id;
    await secondBridge.createColumn(
      second.result.id,
      { column: { name: "Value", type: "text", position: 0, nullable: true } },
      ctx()
    );
    const firstRow = (
      await firstBridge.batchRows(
        first.result.id,
        { ops: [{ op: "create", row: { [firstValueCol]: "A" }, beforeRowId: null }] },
        ctx()
      )
    ).result.rows[0]!.id;

    const { result, rerender } = renderHook(
      ({ bridge, table }: { bridge: DatabaseBridge; table: string }) => useDatabaseTable(bridge, table),
      { initialProps: { bridge: firstBridge, table: first.result.id } }
    );
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => {
      await result.current.updateRow(firstRow, { [firstValueCol]: "B" });
    });
    rerender({ bridge: secondBridge, table: second.result.id });
    await waitFor(() => expect(result.current.table?.name).toBe("bridge second"));
    expect(result.current.canUndo).toBe(false);
    await act(async () => {
      await result.current.undo();
    });
    expect((await cellsOf(firstBridge, first.result.id, firstRow))?.[firstValueCol]).toBe("B");
  });

  it("an in-flight op of the previous table stands no undo entry after the relink", async () => {
    const bridge = createMemoryDatabaseBridge();
    const first = await bridge.createTable({ name: "inflight first" }, ctx());
    const second = await bridge.createTable({ name: "inflight second" }, ctx());
    const firstValueCol = (
      await bridge.createColumn(
        first.result.id,
        { column: { name: "Value", type: "text", position: 0, nullable: true } },
        ctx()
      )
    ).result.id;
    await bridge.createColumn(
      second.result.id,
      { column: { name: "Value", type: "text", position: 0, nullable: true } },
      ctx()
    );
    const firstRow = (
      await bridge.batchRows(
        first.result.id,
        { ops: [{ op: "create", row: { [firstValueCol]: "A" }, beforeRowId: null }] },
        ctx()
      )
    ).result.rows[0]!.id;

    // The gate bridge: the batchRows resolves AFTER the relink (the
    // in-flight stand — the op's late completion must stand no entry over
    // the new table's stack).
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gated = new Proxy(bridge, {
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

    const { result, rerender } = renderHook(({ table }: { table: string }) => useDatabaseTable(gated, table), {
      initialProps: { table: first.result.id },
    });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    let operation: Promise<void> | null = null;
    await act(async () => {
      operation = result.current.updateRow(firstRow, { [firstValueCol]: "B" });
    });
    // Relink while the op is in flight.
    rerender({ table: second.result.id });
    await waitFor(() => expect(result.current.table?.name).toBe("inflight second"));
    release!();
    await act(async () => {
      await operation;
    });
    expect(result.current.canUndo).toBe(false);
    await act(async () => {
      await result.current.undo();
    });
    // The committed stand keeps (the op was over the previous table and
    // stands committed there — not undoable from the relinked block).
    expect((await cellsOf(bridge, first.result.id, firstRow))?.[firstValueCol]).toBe("B");
  });
});
