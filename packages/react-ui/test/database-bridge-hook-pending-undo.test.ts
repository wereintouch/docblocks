// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MutationContext } from "../src/database/bridge";
import { useDatabaseTable } from "../src/database/use-database-table";

// The data provider hook's pending-row undo stand (the write-tails over the
// filtered-out row: the undo entries' pre-operation state seeds from the
// pending state, so the pending row's writes stand undoable — and a
// pending removal stands the rowRestore's inverse, so the insert's entry
// never strands over the deleted row).
//
// `canUndo` / `canRedo` derive from the history's refs (the `setStackVersion`
// re-render refreshes them), so the assertions wait the re-render.

function ctx(): MutationContext {
  return { operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() };
}

/** Seeds the table (the Name column + the given rows). */
async function seed(bridge: ReturnType<typeof createMemoryDatabaseBridge>) {
  const table = await bridge.createTable({ name: "People" }, ctx());
  const column = await bridge.createColumn(
    table.result.id,
    { column: { name: "Name", type: "text", position: 0, nullable: true } },
    ctx()
  );
  for (const name of ["Alice", "Bob"]) {
    await bridge.batchRows(
      table.result.id,
      { ops: [{ op: "create", row: { [column.result.id]: name }, beforeRowId: null }] },
      ctx()
    );
  }
  return { tableId: table.result.id, nameColumnId: column.result.id };
}

/** The bridge's truth: the row's cell value (the row is filtered out of
 *  the hook's view — the snapshot reads the table without the filter). */
async function cellOf(
  bridge: ReturnType<typeof createMemoryDatabaseBridge>,
  tableId: string,
  rowId: string,
  columnId: string
): Promise<unknown> {
  const snapshot = await bridge.snapshotTable(tableId, {});
  return snapshot.page.rows.find((entry) => entry.id === rowId)?.cells[columnId];
}

describe("the data provider hook — the pending row's undo stand", () => {
  it("stands the undoable edit over the pending row (the pre-operation cells from the pending state)", async () => {
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

    // The edit over the pending row commits and stands the undo entry over
    // the pre-operation cells seeded from the pending state (the rowsRef
    // holds no entry for the filtered-out row).
    await result.current.updateRow(rowId, { [seeded.nameColumnId]: "Carl" });
    await waitFor(async () => expect(await cellOf(bridge, seeded.tableId, rowId, seeded.nameColumnId)).toBe("Carl"));
    await waitFor(() => expect(result.current.canUndo).toBe(true));

    // The undo restores the pre-edit value in the bridge's truth (the row
    // stands filtered out — the UI's pending stand was consumed by the
    // undo's clear).
    await result.current.undo();
    await waitFor(async () => expect(await cellOf(bridge, seeded.tableId, rowId, seeded.nameColumnId)).toBe("Bob"));
    expect(result.current.error).toBeNull();
  });

  it("restores a pending row after its removal (the insert's entry never strands over the deleted row)", async () => {
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
    const removed = await bridge.snapshotTable(seeded.tableId, {});
    expect(removed.page.rows.some((entry) => entry.id === rowId)).toBe(false);

    // The removal stands the rowRestore's inverse over the top of the
    // stack: the first undo restores the row (the undelete), the second
    // undo runs the insert's entry's inverse (the delete) over the
    // restored row — no not_found, no stuck entry.
    await result.current.undo();
    const restored = await bridge.snapshotTable(seeded.tableId, {});
    expect(restored.page.rows.some((entry) => entry.id === rowId)).toBe(true);

    await result.current.undo();
    const gone = await bridge.snapshotTable(seeded.tableId, {});
    expect(gone.page.rows.some((entry) => entry.id === rowId)).toBe(false);
    // Both entries consumed: the undo side empties, the redo side holds
    // the two restored operations (the forward-only stand).
    await waitFor(() => expect(result.current.canUndo).toBe(false));
    await waitFor(() => expect(result.current.canRedo).toBe(true));
    expect(result.current.error).toBeNull();
  });
});
