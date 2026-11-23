// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import type { DatabaseBridge, MutationContext } from "../src/database/bridge";
import { newMutationContext, useDatabaseTable } from "../src/database/use-database-table";

// the data provider spec — part 1 of 3.

// The radix Select drives the cell's pick through the pointer-capture API
// (setPointerCapture / hasPointerCapture), which jsdom does not implement.
// The stub keeps the open/pick gesture testable in the unit suite.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

/** The write context (a fresh operation id per call). */
function ctx(): MutationContext {
  return newMutationContext();
}

/** Polls the condition over the settled frames (the radix portals settle async). */
async function until(condition: () => unknown | Promise<unknown>, label: string): Promise<void> {
  const deadline = Date.now() + 2000;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

/** The row's cells over the bridge's page (the page's row order stands). */
async function cellsOf(bridge: DatabaseBridge, tableId: string, rowId: string): Promise<Record<string, unknown>> {
  const page = await bridge.snapshotTable(tableId, {});
  const row = page.page.rows.find((entry) => entry.id === rowId);
  if (row === undefined) throw new Error(`the row "${rowId}" is not in the table "${tableId}"`);
  return row.cells;
}

afterEach(() => cleanup());

describe("the data provider (the useDatabaseTable's batch commit)", () => {
  it("the renameTable commits to the bridge's table (no doc write); the undo / redo walk the name back", async () => {
    const bridge = createMemoryDatabaseBridge();
    const tableId = (await bridge.createTable({ name: "Batch" }, ctx())).result.id;
    const { result } = renderHook(() => useDatabaseTable(bridge, tableId));
    await until(() => result.current.phase === "ready", "the load");
    await act(async () => {
      await result.current.renameTable("Second Name");
    });
    expect((await bridge.describeTable(tableId)).table.name).toBe("Second Name");
    await act(async () => {
      await result.current.undo();
    });
    expect((await bridge.describeTable(tableId)).table.name).toBe("Batch");
    await act(async () => {
      await result.current.redo();
    });
    expect((await bridge.describeTable(tableId)).table.name).toBe("Second Name");
  });
  it("the updateRows stands ONE commit: the single undo restores every touched row (the redo stands the batch again)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const tableId = (await bridge.createTable({ name: "Batch" }, ctx())).result.id;
    const t = (
      await bridge.createColumn(tableId, { column: { name: "T", type: "text", position: 0, nullable: true } }, ctx())
    ).result.id;
    const n = (
      await bridge.createColumn(tableId, { column: { name: "N", type: "integer", position: 1, nullable: true } }, ctx())
    ).result.id;
    const receipt = await bridge.batchRows(
      tableId,
      {
        ops: [
          { op: "create", row: { [t]: "a", [n]: 1 }, beforeRowId: null },
          { op: "create", row: { [t]: "b", [n]: 2 }, beforeRowId: null },
        ],
      },
      ctx()
    );
    const r1 = receipt.result.rows[0]!.id;
    const r2 = receipt.result.rows[1]!.id;
    const { result } = renderHook(() => useDatabaseTable(bridge, tableId));
    await until(() => result.current.phase === "ready", "the load");
    await act(async () => {
      await result.current.updateRows([
        { rowId: r1, cells: { [t]: null, [n]: null } },
        { rowId: r2, cells: { [t]: null, [n]: null } },
      ]);
    });
    let c1 = await cellsOf(bridge, tableId, r1);
    let c2 = await cellsOf(bridge, tableId, r2);
    expect(c1[t] ?? null).toBeNull();
    expect(c2[t] ?? null).toBeNull();
    expect(result.current.canUndo).toBe(true);
    // The single undo stands the WHOLE batch back (both rows).
    await act(async () => {
      await result.current.undo();
    });
    c1 = await cellsOf(bridge, tableId, r1);
    c2 = await cellsOf(bridge, tableId, r2);
    expect(c1[t]).toBe("a");
    expect(c1[n]).toBe(1);
    expect(c2[t]).toBe("b");
    expect(c2[n]).toBe(2);
    // The redo stands the batch again (the single press).
    await act(async () => {
      await result.current.redo();
    });
    c1 = await cellsOf(bridge, tableId, r1);
    c2 = await cellsOf(bridge, tableId, r2);
    expect(c1[t] ?? null).toBeNull();
    expect(c2[t] ?? null).toBeNull();
  });
  it("the undo's in-flight inverse stands the history's identity stand (the fresh write's entry stands no drop)", async () => {
    // The race stand: the user's forward write lands on the undo stack
    // while the first undo's inverse is in flight (the bridge's call
    // held over the gate). The removal stands by identity — the blind
    // position's pop would drop the FRESH entry (its inverse never runs)
    // and leave the inverted entry for a duplicate inverse.
    const base = createMemoryDatabaseBridge();
    const tableId = (await base.createTable({ name: "Race" }, ctx())).result.id;
    const t = (
      await base.createColumn(tableId, { column: { name: "T", type: "text", position: 0, nullable: true } }, ctx())
    ).result.id;
    const receipt = await base.batchRows(
      tableId,
      {
        ops: [
          { op: "create", row: { [t]: "a" }, beforeRowId: null },
          { op: "create", row: { [t]: "b" }, beforeRowId: null },
        ],
      },
      ctx()
    );
    const r1 = receipt.result.rows[0]!.id;
    const r2 = receipt.result.rows[1]!.id;
    // The gate over the bridge's batchRows: the FIRST call is the first
    // update's forward write (passes), the SECOND is the undo's inverse
    // (held until the test releases it — the fresh write's window).
    let releaseInverse: (() => void) | null = null;
    const inverseGate = new Promise<void>((resolve) => {
      releaseInverse = resolve;
    });
    let batchCalls = 0;
    const bridge: DatabaseBridge = {
      ...base,
      batchRows: (id: string, payload: Parameters<DatabaseBridge["batchRows"]>[1], mctx: MutationContext) => {
        batchCalls += 1;
        if (batchCalls === 2) return inverseGate.then(() => base.batchRows(id, payload, mctx));
        return base.batchRows(id, payload, mctx);
      },
    };
    const { result } = renderHook(() => useDatabaseTable(bridge, tableId));
    await until(() => result.current.phase === "ready", "the load");
    // Op1: the r1's clear (the forward write #1).
    await act(async () => {
      await result.current.updateRows([{ rowId: r1, cells: { [t]: null } }]);
    });
    expect(result.current.canUndo).toBe(true);
    // The undo's inverse reaches the gate (synchronously — the inverse's
    // bridge call stands the undo's first await).
    const undoPromise = result.current.undo();
    expect(batchCalls).toBe(2);
    // The forward write over the in-flight inverse (the r2's clear — the
    // fresh entry stands on the stack).
    await act(async () => {
      await result.current.updateRows([{ rowId: r2, cells: { [t]: null } }]);
    });
    // The release: the inverse lands (the r1's restore).
    await act(async () => {
      releaseInverse!();
      await undoPromise;
    });
    expect((await cellsOf(base, tableId, r1))[t]).toBe("a");
    // The FRESH entry stands on the undo stack (the identity stand): the
    // second undo restores the r2 — not a duplicate over the r1.
    expect(result.current.canUndo).toBe(true);
    await act(async () => {
      await result.current.undo();
    });
    expect((await cellsOf(base, tableId, r2))[t]).toBe("b");
    // The redo side's stand: the fresh write cleared it (the "a new
    // operation clears the redo side" invariant) — the first op stands
    // consumed (its inverse already applied), not redoable over the newer
    // entry (the redo's re-commit would clobber the fresh write). The redo
    // restores the fresh entry only.
    await act(async () => {
      await result.current.redo();
    });
    expect((await cellsOf(base, tableId, r2))[t] ?? null).toBeNull();
    expect(result.current.canRedo).toBe(false);
    expect((await cellsOf(base, tableId, r1))[t]).toBe("a");
  });
});
