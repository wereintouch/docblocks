// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import type { BatchOp, DatabaseBridge, MutationContext } from "../src/database/bridge";
import { newMutationContext, useDatabaseTable } from "../src/database/use-database-table";

/**
 * The database undo/redo and relinking integrity over the bridge's undo
 * stack (the `useDatabaseTable` hook + the memory bridge). The former
 * review pins are fixed behaviors (plain `it()`): the column
 * delete's soft-delete restore, the update's key-scoped inverse patch,
 * the insert's identity cell over the redo's fresh ids, the move's
 * pre-move-successor anchor, the per-(bridge, tableId) history (the
 * relink's reset + the in-flight op's drop), and the failed undo
 * entry's retryable stand.
 */

afterEach(cleanup);

/** The write context (a fresh operation id per call). */
function ctx(): MutationContext {
  return newMutationContext();
}

interface SeededTable {
  bridge: ReturnType<typeof createMemoryDatabaseBridge>;
  tableId: string;
  valueCol: string;
  otherCol: string;
  rowIds: string[];
}

/** Seeds the table (the Value / Other columns + the rows over the
 *  logical cell keys given) on a fresh bridge. */
async function seed(values: Array<{ value?: unknown; other?: unknown }>): Promise<SeededTable> {
  const bridge = createMemoryDatabaseBridge();
  const table = await bridge.createTable({ name: "Review" }, ctx());
  const tableId = table.result.id;
  const value = await bridge.createColumn(
    tableId,
    { column: { name: "Value", type: "text", position: 0, nullable: true } },
    ctx()
  );
  const other = await bridge.createColumn(
    tableId,
    { column: { name: "Other", type: "text", position: 1, nullable: true } },
    ctx()
  );
  const rowIds: string[] = [];
  for (const entry of values) {
    const cells: Record<string, unknown> = {};
    if (entry.value !== undefined) cells[value.result.id] = entry.value;
    if (entry.other !== undefined) cells[other.result.id] = entry.other;
    const receipt = await bridge.batchRows(tableId, { ops: [{ op: "create", row: cells, beforeRowId: null }] }, ctx());
    rowIds.push(receipt.result.rows[0]!.id);
  }
  return { bridge, tableId, valueCol: value.result.id, otherCol: other.result.id, rowIds };
}

/** Renders the hook over the seeded table over the ready phase. */
async function setup(values: Array<{ value?: unknown; other?: unknown }> = []) {
  const { bridge, tableId, valueCol, otherCol, rowIds } = await seed(values);
  const { result } = renderHook(() => useDatabaseTable(bridge, tableId));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  return { bridge, tableId, valueCol, otherCol, rowIds, result };
}

/** The row ids in the stored (bridge) row order. */
const bridgeRowIds = async (bridge: DatabaseBridge, tableId: string): Promise<string[]> =>
  (await bridge.snapshotTable(tableId, {})).page.rows.map((row) => row.id);

/** The row's cells over the bridge's page (undefined = the row is gone). */
const cellsOf = async (
  bridge: DatabaseBridge,
  tableId: string,
  rowId: string
): Promise<Record<string, unknown> | undefined> =>
  (await bridge.snapshotTable(tableId, {})).page.rows.find((row) => row.id === rowId)?.cells;

describe("the forward-only undo/redo over the bridge", () => {
  it("a second undo after a redo of an insert removes the redo-created row", async () => {
    const { bridge, tableId, valueCol, result } = await setup();
    await act(async () => {
      await result.current.insertRow({ [valueCol]: "new" });
    });
    await act(async () => {
      await result.current.undo();
    });
    await act(async () => {
      await result.current.redo();
    });
    await act(async () => {
      await result.current.undo();
    });
    expect(await bridgeRowIds(bridge, tableId)).toEqual([]);
  });

  it("three undo/redo cycles of an insert stand the expected data (the fresh ids)", async () => {
    const { bridge, tableId, valueCol, result } = await setup();
    const insertedId = await act(async () => result.current.insertRow({ [valueCol]: "new" }));
    expect(insertedId).toBeDefined();
    // The memory bridge always assigns a fresh id on the re-insert (the
    // backend-that-always-assigns-new-ids stand): every redo stands a NEW
    // row id, and every undo stands that very row.
    const seen = new Set<string>([insertedId!]);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await act(async () => {
        await result.current.undo();
      });
      expect(await bridgeRowIds(bridge, tableId)).toEqual([]);
      await act(async () => {
        await result.current.redo();
      });
      const page = await bridge.snapshotTable(tableId, {});
      expect(page.page.rows).toHaveLength(1);
      expect(page.page.rows[0]!.cells[valueCol]).toBe("new");
      seen.add(page.page.rows[0]!.id);
    }
    // The redo's re-inserts stood fresh ids (the identity cell followed
    // them — the cycles never left an orphaned row).
    expect(seen.size).toBe(4);
    await act(async () => {
      await result.current.undo();
    });
    expect(await bridgeRowIds(bridge, tableId)).toEqual([]);
  });

  it("a row-link over the inserted row stands the dead stand after the redo's fresh id", async () => {
    const bridge = createMemoryDatabaseBridge();
    const linked = await bridge.createTable({ name: "linked" }, ctx());
    const tableId = linked.result.id;
    const links = await bridge.createTable({ name: "links" }, ctx());
    const valueCol = (
      await bridge.createColumn(
        tableId,
        { column: { name: "Value", type: "text", position: 0, nullable: true } },
        ctx()
      )
    ).result.id;
    const linkCol = (
      await bridge.createColumn(
        links.result.id,
        {
          column: {
            name: "Link",
            type: "text",
            position: 0,
            nullable: true,
            reference: { kind: "row", tableId, many: false },
          },
        },
        ctx()
      )
    ).result.id;
    const { result } = renderHook(() => useDatabaseTable(bridge, tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    const insertedId = await act(async () => result.current.insertRow({ [valueCol]: "new" }));
    await bridge.batchRows(
      links.result.id,
      { ops: [{ op: "create", row: { [linkCol]: insertedId }, beforeRowId: null }] },
      ctx()
    );
    await act(async () => {
      await result.current.undo();
    });
    await act(async () => {
      await result.current.redo(); // the fresh id
    });
    const rows = (await bridge.snapshotTable(tableId, {})).page.rows;
    const freshId = rows[0]!.id;
    expect(freshId).not.toBe(insertedId);
    // The link still references the ORIGINAL id (the other table's data):
    // the dead row stands the null display, the fresh row resolves.
    // (The join is the grid's stand: the cell's value is the linked row
    // id, resolved over the linked table.)
    const dead = await bridge.resolveRowDisplay(tableId, { rowIds: [insertedId], displayColumn: valueCol });
    expect(dead[insertedId]).toBeNull();
    const fresh = await bridge.resolveRowDisplay(tableId, { rowIds: [freshId], displayColumn: valueCol });
    expect(fresh[freshId]).toBe("new");
  });

  it("undo of a row move restores the original order", async () => {
    const { bridge, tableId, rowIds, result } = await setup([{ value: "A" }, { value: "B" }, { value: "C" }]);
    await act(async () => {
      await result.current.moveRow(rowIds[1]!, null);
    });
    expect(await bridgeRowIds(bridge, tableId)).toEqual([rowIds[0]!, rowIds[2]!, rowIds[1]!]);
    await act(async () => {
      await result.current.undo();
    });
    expect(await bridgeRowIds(bridge, tableId)).toEqual([rowIds[0]!, rowIds[1]!, rowIds[2]!]);
  });

  it("undo of a move restores the first position (the anchor's null stands the end, not the head)", async () => {
    const { bridge, tableId, rowIds, result } = await setup([{ value: "A" }, { value: "B" }, { value: "C" }]);
    // Move the first row to the end: the original seat's successor is
    // the second row — the undo stands the row BEFORE it (the head).
    await act(async () => {
      await result.current.moveRow(rowIds[0]!, null);
    });
    expect(await bridgeRowIds(bridge, tableId)).toEqual([rowIds[1]!, rowIds[2]!, rowIds[0]!]);
    await act(async () => {
      await result.current.undo();
    });
    expect(await bridgeRowIds(bridge, tableId)).toEqual([rowIds[0]!, rowIds[1]!, rowIds[2]!]);
  });

  it("undo of a move restores the last position (the null anchor)", async () => {
    const { bridge, tableId, rowIds, result } = await setup([{ value: "A" }, { value: "B" }, { value: "C" }]);
    // Move the last row to the head: its successor list is empty — the
    // undo's anchor stands null (the end).
    await act(async () => {
      await result.current.moveRow(rowIds[2]!, rowIds[0]!);
    });
    expect(await bridgeRowIds(bridge, tableId)).toEqual([rowIds[2]!, rowIds[0]!, rowIds[1]!]);
    await act(async () => {
      await result.current.undo();
    });
    expect(await bridgeRowIds(bridge, tableId)).toEqual([rowIds[0]!, rowIds[1]!, rowIds[2]!]);
  });

  it("undo of a move over a removed neighbor slides to the next survivor (or the end)", async () => {
    const { bridge, tableId, rowIds, result } = await setup([
      { value: "A" },
      { value: "B" },
      { value: "C" },
      { value: "D" },
    ]);
    // Move the second row to the end; a peer removes the third (the
    // second's original first successor) in the meantime: the anchor
    // slides to the next survivor (the fourth), so the undo stands the
    // second BEFORE the fourth (not at the end).
    await act(async () => {
      await result.current.moveRow(rowIds[1]!, null);
    });
    expect(await bridgeRowIds(bridge, tableId)).toEqual([rowIds[0]!, rowIds[2]!, rowIds[3]!, rowIds[1]!]);
    await act(async () => {
      await bridge.batchRows(tableId, { ops: [{ op: "delete", rowId: rowIds[2]! }] }, ctx());
    });
    await waitFor(() =>
      expect(result.current.rows.map((row) => row.rowId)).toEqual([rowIds[0]!, rowIds[3]!, rowIds[1]!])
    );
    await act(async () => {
      await result.current.undo();
    });
    expect(await bridgeRowIds(bridge, tableId)).toEqual([rowIds[0]!, rowIds[1]!, rowIds[3]!]);
  });

  it("undo of a column delete restores the values and the column position", async () => {
    const { bridge, tableId, valueCol, otherCol, rowIds, result } = await setup([{ value: "keep" }]);
    await act(async () => {
      await result.current.deleteColumn(valueCol);
    });
    await act(async () => {
      await result.current.undo();
    });
    const cells = await cellsOf(bridge, tableId, rowIds[0]!);
    expect(cells?.[valueCol]).toBe("keep");
    // The column stands back at its original position (the restore re-inserts
    // at the anchor, not appended at the end).
    const columns = (await bridge.describeTable(tableId)).columns.map((column) => column.id);
    expect(columns).toEqual([valueCol, otherCol]);
  });

  it("undo of an update changes only the edited field after a remote change", async () => {
    const { bridge, tableId, valueCol, otherCol, rowIds, result } = await setup([{ value: "A", other: "original" }]);
    await act(async () => {
      await result.current.updateRow(rowIds[0]!, { [valueCol]: "B" });
    });
    // A remote peer edits a different cell of the same row.
    await act(async () => {
      await bridge.batchRows(
        tableId,
        { ops: [{ op: "update", rowId: rowIds[0]!, cells: { [otherCol]: "remote" } }] },
        ctx()
      );
    });
    await act(async () => {
      await result.current.undo();
    });
    const cells = await cellsOf(bridge, tableId, rowIds[0]!);
    expect(cells?.[otherCol]).toBe("remote");
    expect(cells?.[valueCol]).toBe("A");
  });

  it("undo of the same cell edit stands the local pre-operation value (the newest write)", async () => {
    const { bridge, tableId, valueCol, rowIds, result } = await setup([{ value: "A" }]);
    await act(async () => {
      await result.current.updateRow(rowIds[0]!, { [valueCol]: "B" });
    });
    // A remote peer edits the SAME cell after the local operation.
    await act(async () => {
      await bridge.batchRows(
        tableId,
        { ops: [{ op: "update", rowId: rowIds[0]!, cells: { [valueCol]: "C" } }] },
        ctx()
      );
    });
    await act(async () => {
      await result.current.undo();
    });
    // The same-cell conflict stands the undo as the newest write (the
    // pre-operation value over the remote edit landed since).
    const cells = await cellsOf(bridge, tableId, rowIds[0]!);
    expect(cells?.[valueCol]).toBe("A");
  });

  it("undo of a batch update keeps the foreign edits of the other cells", async () => {
    const { bridge, tableId, valueCol, otherCol, rowIds, result } = await setup([
      { value: "A1", other: "o1" },
      { value: "B1", other: "o2" },
    ]);
    await act(async () => {
      await result.current.updateRows([
        { rowId: rowIds[0]!, cells: { [valueCol]: "A2" } },
        { rowId: rowIds[1]!, cells: { [valueCol]: "B2" } },
      ]);
    });
    // A remote peer edits a different cell of one of the touched rows.
    await act(async () => {
      await bridge.batchRows(
        tableId,
        { ops: [{ op: "update", rowId: rowIds[0]!, cells: { [otherCol]: "remote" } }] },
        ctx()
      );
    });
    await act(async () => {
      await result.current.undo();
    });
    expect(await cellsOf(bridge, tableId, rowIds[0]!)).toEqual({ [valueCol]: "A1", [otherCol]: "remote" });
    expect(await cellsOf(bridge, tableId, rowIds[1]!)).toEqual({ [valueCol]: "B1", [otherCol]: "o2" });
  });

  it("the re-delivered remote update stands the undo intact (the idempotent echo)", async () => {
    const { bridge, tableId, valueCol, otherCol, rowIds, result } = await setup([{ value: "A", other: "original" }]);
    await act(async () => {
      await result.current.updateRow(rowIds[0]!, { [valueCol]: "B" });
    });
    // The remote edit is delivered twice (the re-delivery; the bridge
    // applies it idempotently — the second delivery stands a no-op).
    await act(async () => {
      await bridge.batchRows(
        tableId,
        { ops: [{ op: "update", rowId: rowIds[0]!, cells: { [otherCol]: "remote" } }] },
        ctx()
      );
      await bridge.batchRows(
        tableId,
        { ops: [{ op: "update", rowId: rowIds[0]!, cells: { [otherCol]: "remote" } }] },
        ctx()
      );
    });
    await act(async () => {
      await result.current.undo();
    });
    const cells = await cellsOf(bridge, tableId, rowIds[0]!);
    expect(cells?.[otherCol]).toBe("remote");
    expect(cells?.[valueCol]).toBe("A");
  });

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

describe("the column delete's soft-delete restore", () => {
  it("undo restores a middle column at its anchor position", async () => {
    const bridge = createMemoryDatabaseBridge();
    const table = await bridge.createTable({ name: "mid" }, ctx());
    const tableId = table.result.id;
    const firstCol = (
      await bridge.createColumn(
        tableId,
        { column: { name: "First", type: "text", position: 0, nullable: true } },
        ctx()
      )
    ).result.id;
    const valueCol = (
      await bridge.createColumn(
        tableId,
        { column: { name: "Value", type: "text", position: 1, nullable: true } },
        ctx()
      )
    ).result.id;
    const otherCol = (
      await bridge.createColumn(
        tableId,
        { column: { name: "Other", type: "text", position: 2, nullable: true } },
        ctx()
      )
    ).result.id;
    const rowId = (
      await bridge.batchRows(
        tableId,
        { ops: [{ op: "create", row: { [valueCol]: "keep" }, beforeRowId: null }] },
        ctx()
      )
    ).result.rows[0]!.id;
    const { result } = renderHook(() => useDatabaseTable(bridge, tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => {
      await result.current.deleteColumn(valueCol);
    });
    await act(async () => {
      await result.current.undo();
    });
    // The anchor position: the column stands back BEFORE the one that
    // followed it (a restore appended at the end would stand
    // [first, other, value]).
    const columns = (await bridge.describeTable(tableId)).columns.map((column) => column.id);
    expect(columns).toEqual([firstCol, valueCol, otherCol]);
    expect((await cellsOf(bridge, tableId, rowId))?.[valueCol]).toBe("keep");
  });

  it("undo restores the values of the rows outside the loaded page", async () => {
    // The hook loads the first page (200 rows); the restore covers the rest
    // of the table (the soft delete keeps the values in the bridge, the
    // loaded pages' and the unloading'd alike).
    const bridge = createMemoryDatabaseBridge();
    const table = await bridge.createTable({ name: "pages" }, ctx());
    const tableId = table.result.id;
    const valueCol = (
      await bridge.createColumn(
        tableId,
        { column: { name: "Value", type: "text", position: 0, nullable: true } },
        ctx()
      )
    ).result.id;
    const rows = Array.from({ length: 210 }, (_, index) => ({ [valueCol]: `v${index}` }));
    for (const cells of rows) {
      await bridge.batchRows(tableId, { ops: [{ op: "create", row: cells, beforeRowId: null }] }, ctx());
    }
    const { result } = renderHook(() => useDatabaseTable(bridge, tableId));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.rows).toHaveLength(200);
    await act(async () => {
      await result.current.deleteColumn(valueCol);
    });
    await act(async () => {
      await result.current.undo();
    });
    const page = await bridge.snapshotTable(tableId, { limit: 200 });
    const tail = await bridge.queryNextPage(tableId, {
      cursor: page.page.nextCursor!,
      asOfSeq: page.page.asOfSeq,
      queryFingerprint: page.page.queryFingerprint,
    });
    const last = tail.rows[tail.rows.length - 1]!;
    expect(last.cells[valueCol]).toBe("v209");
  });

  it("undo of a column delete covers the removed rows (the trash keeps the value)", async () => {
    const { bridge, tableId, valueCol, rowIds, result } = await setup([{ value: "keep" }]);
    await act(async () => {
      await result.current.removeRow(rowIds[0]!);
    });
    await act(async () => {
      await result.current.deleteColumn(valueCol);
    });
    await act(async () => {
      await result.current.undo(); // the column's restore (the stack's top)
    });
    await bridge.undeleteRows(tableId, { rowIds: [rowIds[0]!] }, ctx());
    expect((await cellsOf(bridge, tableId, rowIds[0]!))?.[valueCol]).toBe("keep");
  });

  it("undo of a column delete keeps the foreign edits of another column", async () => {
    const { bridge, tableId, valueCol, otherCol, rowIds, result } = await setup([{ value: "keep", other: "original" }]);
    await act(async () => {
      await result.current.deleteColumn(valueCol);
    });
    // A remote peer edits another column of the same row.
    await act(async () => {
      await bridge.batchRows(
        tableId,
        { ops: [{ op: "update", rowId: rowIds[0]!, cells: { [otherCol]: "remote" } }] },
        ctx()
      );
    });
    await act(async () => {
      await result.current.undo();
    });
    const cells = await cellsOf(bridge, tableId, rowIds[0]!);
    expect(cells?.[valueCol]).toBe("keep");
    expect(cells?.[otherCol]).toBe("remote");
  });

  it("a re-created column stands a distinct id; the undo restores the deleted one (the values intact)", async () => {
    const { bridge, tableId, valueCol, rowIds, result } = await setup([{ value: "keep" }]);
    await act(async () => {
      await result.current.deleteColumn(valueCol);
    });
    // The re-creation stands a fresh bridge-assigned id (the deleted
    // column's id is never adopted).
    await act(async () => {
      await bridge.createColumn(
        tableId,
        { column: { name: "Value (new)", type: "text", position: 1, nullable: true } },
        ctx()
      );
    });
    await act(async () => {
      await result.current.undo();
    });
    const description = await bridge.describeTable(tableId);
    const recreated = description.columns.find((column) => column.name === "Value (new)");
    expect(recreated?.id).toBeDefined();
    expect(recreated?.id).not.toBe(valueCol);
    // The deleted column stands restored (the restore's stand) — its values
    // kept, the re-created column's stand distinct.
    const restored = description.columns.find((column) => column.id === valueCol);
    expect(restored?.name).toBe("Value");
    expect((await cellsOf(bridge, tableId, rowIds[0]!))?.[valueCol]).toBe("keep");
  });
});
