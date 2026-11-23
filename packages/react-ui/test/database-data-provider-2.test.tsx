// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import type { DatabaseBridge, MutationContext } from "../src/database/bridge";
import { newMutationContext, useDatabaseTable } from "../src/database/use-database-table";

// the data provider spec — part 2 of 3.

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
  it("the undo's in-flight inverse over the fresh write stands no stale redo (the history's redo stand)", async () => {
    // The window: the undo's inverse is in flight (the bridge's call held
    // over the gate) and the user's forward write commits — the pushUndo
    // replaces the redo stack (the "a new operation clears the redo side"
    // invariant). The undo must not then push the undone op onto the NEW
    // stack: it would stand redoable over the newer write, and the redo's
    // re-commit would clobber the fresh entry (the inverse ops stand no
    // CAS). The op stands consumed (popped from the undo stack, not moved
    // to redo) — the Yjs model: the newer operation invalidates the redo
    // side, the undone op cannot be re-undone (its inverse already ran).
    const base = createMemoryDatabaseBridge();
    const tableId = (await base.createTable({ name: "StaleRedo" }, ctx())).result.id;
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
    // The undo's inverse reaches the gate.
    const undoPromise = result.current.undo();
    expect(batchCalls).toBe(2);
    // The forward write over the in-flight inverse (the r2's clear — its
    // pushUndo replaces the redo stack).
    await act(async () => {
      await result.current.updateRows([{ rowId: r2, cells: { [t]: null } }]);
    });
    // The release: the inverse lands (the r1's restore).
    await act(async () => {
      releaseInverse!();
      await undoPromise;
    });
    expect((await cellsOf(base, tableId, r1))[t]).toBe("a");
    // The window's stand: the undone op is NOT redoable (the fresh write
    // cleared the redo side — the re-commit over the newer entry stands no
    // duplicate). The undo stack holds only the fresh entry.
    expect(result.current.canRedo).toBe(false);
    expect(result.current.canUndo).toBe(true);
    // The undo walks the fresh entry (the r2's restore).
    await act(async () => {
      await result.current.undo();
    });
    expect((await cellsOf(base, tableId, r2))[t]).toBe("b");
    expect(result.current.canUndo).toBe(false);
    // The redo restores the fresh entry only — the stale op never stands
    // back on the stack.
    await act(async () => {
      await result.current.redo();
    });
    expect((await cellsOf(base, tableId, r2))[t] ?? null).toBeNull();
    expect(result.current.canRedo).toBe(false);
  });
  it("the redo's in-flight forward over the fresh write stands no inverted undo order", async () => {
    // The symmetric window: the redo's forward is in flight and the user's
    // forward write commits — the pushUndo PUSHES onto the same undo
    // array (the pushUndo does not replace it). Pushing the redone op on
    // top of the newer entry would invert the undo order (the first undo
    // reverts the stale op, not the newest). The op stands fixed outside
    // the history: consumed from the redo stack, not re-pushed on top of
    // the newer entry.
    const base = createMemoryDatabaseBridge();
    const tableId = (await base.createTable({ name: "Invert" }, ctx())).result.id;
    const t = (
      await base.createColumn(tableId, { column: { name: "T", type: "text", position: 0, nullable: true } }, ctx())
    ).result.id;
    const receipt = await base.batchRows(
      tableId,
      {
        ops: [
          { op: "create", row: { [t]: "a" }, beforeRowId: null },
          { op: "create", row: { [t]: "b" }, beforeRowId: null },
          { op: "create", row: { [t]: "c" }, beforeRowId: null },
        ],
      },
      ctx()
    );
    const [r1, r2, r3] = receipt.result.rows.map((row) => row.id);
    // The gate over the bridge's batchRows: the REDO's forward call is the
    // 5th (op1's forward, op2's forward, undo1's inverse, undo2's inverse,
    // then the redo's forward) — held until the test releases it.
    let releaseForward: (() => void) | null = null;
    const forwardGate = new Promise<void>((resolve) => {
      releaseForward = resolve;
    });
    let batchCalls = 0;
    const bridge: DatabaseBridge = {
      ...base,
      batchRows: (id: string, payload: Parameters<DatabaseBridge["batchRows"]>[1], mctx: MutationContext) => {
        batchCalls += 1;
        if (batchCalls === 5) return forwardGate.then(() => base.batchRows(id, payload, mctx));
        return base.batchRows(id, payload, mctx);
      },
    };
    const { result } = renderHook(() => useDatabaseTable(bridge, tableId));
    await until(() => result.current.phase === "ready", "the load");
    // Op1: the r1's clear; op2: the r2's change to "x".
    await act(async () => {
      await result.current.updateRows([{ rowId: r1!, cells: { [t]: null } }]);
    });
    await act(async () => {
      await result.current.updateRows([{ rowId: r2!, cells: { [t]: "x" } }]);
    });
    // Undo both: the state stands the originals (r1 "a", r2 "b"), the redo
    // stack holds [op1, op2].
    await act(async () => {
      await result.current.undo();
    });
    await act(async () => {
      await result.current.undo();
    });
    expect(result.current.canRedo).toBe(true);
    // The redo's forward (op1: the r1's re-clear) reaches the gate.
    const redoPromise = result.current.redo();
    expect(batchCalls).toBe(5);
    // The forward write over the in-flight forward (the r3's change to "z"
    // — its pushUndo stands on the undo stack).
    await act(async () => {
      await result.current.updateRows([{ rowId: r3!, cells: { [t]: "z" } }]);
    });
    // The release: the forward lands (the r1's re-clear).
    await act(async () => {
      releaseForward!();
      await redoPromise;
    });
    expect((await cellsOf(base, tableId, r1!))[t] ?? null).toBeNull();
    // The order's stand: the NEXT undo reverts the FRESH write (the r3's
    // restore to "c"), not the stale redone op (whose inverse would
    // re-restore the r1).
    await act(async () => {
      await result.current.undo();
    });
    expect((await cellsOf(base, tableId, r3!))[t]).toBe("c");
    // The undo stack walks back over the stale op then.
    await act(async () => {
      await result.current.undo();
    });
    expect((await cellsOf(base, tableId, r1!))[t]).toBe("a");
  });
});
