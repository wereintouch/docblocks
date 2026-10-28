// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import type { DatabaseBridge } from "../src/database/bridge";
import { createMemoryDatabaseBridge } from "../src/database/memory-bridge";
import { useDatabaseTable } from "../src/database/use-database-table";

/**
 * The database undo/redo and relinking integrity over the bridge's undo
 * stack (the `useDatabaseTable` hook + the memory bridge). The former
 * review pins are fixed behaviors (plain `it()`): the column
 * delete's soft-delete restore, the update's key-scoped inverse patch,
 * the insert's identity cell over the redo's fresh ids, the move's
 * pre-move-successor anchor, and the per-(bridge, tableId) history (the
 * relink's reset + the in-flight op's drop).
 */

afterEach(cleanup);

async function setup(values: Record<string, unknown>[] = []) {
  const bridge = createMemoryDatabaseBridge({ channelName: crypto.randomUUID() });
  const id = await bridge.createTable("Review");
  await bridge.createColumn(id, { id: "value", name: "Value", type: "text" });
  await bridge.createColumn(id, { id: "other", name: "Other", type: "text" });
  await bridge.insertRows(id, values);
  const { result } = renderHook(() => useDatabaseTable(bridge, id));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  return { bridge, id, result };
}

/** The row ids in the stored (bridge) row order. */
const rowIds = async (bridge: DatabaseBridge, tableId: string): Promise<string[]> =>
  Object.keys((await bridge.queryRows(tableId, {})).rows);

describe("the forward-only undo/redo over the bridge", () => {
  it("a second undo after a redo of an insert removes the redo-created row", async () => {
    const { bridge, id, result } = await setup();
    await act(async () => {
      await result.current.insertRow({ value: "new" });
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
    expect(await rowIds(bridge, id)).toEqual([]);
  });

  it("three undo/redo cycles of an insert stand the expected data (the fresh ids)", async () => {
    const { bridge, id, result } = await setup();
    const insertedId = await act(async () => result.current.insertRow({ value: "new" }));
    expect(insertedId).toBeDefined();
    // The memory bridge always assigns a fresh id on the re-insert (the
    // backend-that-always-assigns-new-ids stand): every redo stands a NEW
    // row id, and every undo stands that very row.
    const seen = new Set<string>([insertedId!]);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await act(async () => {
        await result.current.undo();
      });
      expect(await rowIds(bridge, id)).toEqual([]);
      await act(async () => {
        await result.current.redo();
      });
      const rows = (await bridge.queryRows(id, {})).rows;
      const ids = Object.keys(rows);
      expect(ids).toHaveLength(1);
      expect(rows[ids[0]!]?.value).toBe("new");
      seen.add(ids[0]!);
    }
    // The redo's re-inserts stood fresh ids (the identity cell followed
    // them — the cycles never left an orphaned row).
    expect(seen.size).toBe(4);
    await act(async () => {
      await result.current.undo();
    });
    expect(await rowIds(bridge, id)).toEqual([]);
  });

  it("a row-link over the inserted row stands the dead stand after the redo's fresh id", async () => {
    const bridge = createMemoryDatabaseBridge({ channelName: crypto.randomUUID() });
    const id = await bridge.createTable("linked");
    const links = await bridge.createTable("links");
    await bridge.createColumn(id, { id: "value", name: "Value", type: "text" });
    await bridge.createColumn(links, {
      id: "link",
      name: "Link",
      type: "text",
      refKind: "row",
      refTableId: id,
    });
    const { result } = renderHook(() => useDatabaseTable(bridge, id));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    const insertedId = await act(async () => result.current.insertRow({ value: "new" }));
    await bridge.insertRow(links, { id: "l1", link: insertedId! });
    await act(async () => {
      await result.current.undo();
    });
    await act(async () => {
      await result.current.redo(); // the fresh id
    });
    const rows = (await bridge.queryRows(id, {})).rows;
    const freshId = Object.keys(rows)[0]!;
    expect(freshId).not.toBe(insertedId);
    // The link still references the ORIGINAL id (the other table's data):
    // the dead row stands the empty display, the fresh row resolves.
    // (The join is the grid's stand: the cell's value is the linked row
    // id, resolved over the linked table.)
    const dead = await bridge.resolveRowDisplay(id, [insertedId!], "value");
    expect(dead[insertedId!]).toBe("");
    const fresh = await bridge.resolveRowDisplay(id, [freshId], "value");
    expect(fresh[freshId]).toBe("new");
  });

  it("undo of a row move restores the original order", async () => {
    const { bridge, id, result } = await setup([
      { id: "a", value: "A" },
      { id: "b", value: "B" },
      { id: "c", value: "C" },
    ]);
    await act(async () => {
      await result.current.moveRow("b", null);
    });
    expect(await rowIds(bridge, id)).toEqual(["a", "c", "b"]);
    await act(async () => {
      await result.current.undo();
    });
    expect(await rowIds(bridge, id)).toEqual(["a", "b", "c"]);
  });

  it("undo of a move restores the first position (the anchor's null stands the end, not the head)", async () => {
    const { bridge, id, result } = await setup([
      { id: "a", value: "A" },
      { id: "b", value: "B" },
      { id: "c", value: "C" },
    ]);
    // Move the first row to the end: the original seat's successor is
    // "b" — the undo stands the row BEFORE it (the head).
    await act(async () => {
      await result.current.moveRow("a", null);
    });
    expect(await rowIds(bridge, id)).toEqual(["b", "c", "a"]);
    await act(async () => {
      await result.current.undo();
    });
    expect(await rowIds(bridge, id)).toEqual(["a", "b", "c"]);
  });

  it("undo of a move restores the last position (the null anchor)", async () => {
    const { bridge, id, result } = await setup([
      { id: "a", value: "A" },
      { id: "b", value: "B" },
      { id: "c", value: "C" },
    ]);
    // Move the last row to the head: its successor list is empty — the
    // undo's anchor stands null (the end).
    await act(async () => {
      await result.current.moveRow("c", "a");
    });
    expect(await rowIds(bridge, id)).toEqual(["c", "a", "b"]);
    await act(async () => {
      await result.current.undo();
    });
    expect(await rowIds(bridge, id)).toEqual(["a", "b", "c"]);
  });

  it("undo of a move over a removed neighbor slides to the next survivor (or the end)", async () => {
    const { bridge, id, result } = await setup([
      { id: "a", value: "A" },
      { id: "b", value: "B" },
      { id: "c", value: "C" },
      { id: "d", value: "D" },
    ]);
    // Move b to the end; a peer removes c (b's original first successor)
    // in the meantime: the anchor slides to the next survivor (d), so the
    // undo stands b BEFORE d (not at the end).
    await act(async () => {
      await result.current.moveRow("b", null);
    });
    expect(await rowIds(bridge, id)).toEqual(["a", "c", "d", "b"]);
    await act(async () => {
      await bridge.removeRow(id, "c");
    });
    await waitFor(() => expect(result.current.rows.map((row) => row.rowId)).toEqual(["a", "d", "b"]));
    await act(async () => {
      await result.current.undo();
    });
    expect(await rowIds(bridge, id)).toEqual(["a", "b", "d"]);
  });

  it("undo of a column delete restores the values and the column position", async () => {
    const { bridge, id, result } = await setup([{ id: "a", value: "keep" }]);
    await act(async () => {
      await result.current.deleteColumn("value");
    });
    await act(async () => {
      await result.current.undo();
    });
    const row = (await bridge.queryRows(id, {})).rows.a;
    expect(row?.value).toBe("keep");
    // The column stands back at its original position (the restore re-inserts
    // at the anchor, not appended at the end).
    const columns = (await bridge.describeTable(id)).columns.map((column) => column.id);
    expect(columns).toEqual(["value", "other"]);
  });

  it("undo of an update changes only the edited field after a remote change", async () => {
    const { bridge, id, result } = await setup([{ id: "a", value: "A", other: "original" }]);
    await act(async () => {
      await result.current.updateRow("a", { value: "B" });
    });
    // A remote peer edits a different cell of the same row.
    await act(async () => {
      await bridge.updateRow(id, "a", { other: "remote" });
    });
    await act(async () => {
      await result.current.undo();
    });
    const row = (await bridge.queryRows(id, {})).rows.a;
    expect(row?.other).toBe("remote");
    expect(row?.value).toBe("A");
  });

  it("undo of the same cell edit stands the local pre-operation value (the newest write)", async () => {
    const { bridge, id, result } = await setup([{ id: "a", value: "A" }]);
    await act(async () => {
      await result.current.updateRow("a", { value: "B" });
    });
    // A remote peer edits the SAME cell after the local operation.
    await act(async () => {
      await bridge.updateRow(id, "a", { value: "C" });
    });
    await act(async () => {
      await result.current.undo();
    });
    // The same-cell conflict stands the undo as the newest write (the
    // pre-operation value over the remote edit landed since).
    const row = (await bridge.queryRows(id, {})).rows.a;
    expect(row?.value).toBe("A");
  });

  it("undo of a batch update keeps the foreign edits of the other cells", async () => {
    const { bridge, id, result } = await setup([
      { id: "a", value: "A1", other: "o1" },
      { id: "b", value: "B1", other: "o2" },
    ]);
    await act(async () => {
      await result.current.updateRows([
        { rowId: "a", cells: { value: "A2" } },
        { rowId: "b", cells: { value: "B2" } },
      ]);
    });
    // A remote peer edits a different cell of one of the touched rows.
    await act(async () => {
      await bridge.updateRow(id, "a", { other: "remote" });
    });
    await act(async () => {
      await result.current.undo();
    });
    const page = await bridge.queryRows(id, {});
    expect(page.rows.a).toEqual({ value: "A1", other: "remote" });
    expect(page.rows.b).toEqual({ value: "B1", other: "o2" });
  });

  it("the re-delivered remote update stands the undo intact (the idempotent echo)", async () => {
    const { bridge, id, result } = await setup([{ id: "a", value: "A", other: "original" }]);
    await act(async () => {
      await result.current.updateRow("a", { value: "B" });
    });
    // The remote edit is delivered twice (the re-delivery; the bridge
    // applies it idempotently — the second delivery stands a no-op).
    await act(async () => {
      await bridge.updateRow(id, "a", { other: "remote" });
      await bridge.updateRow(id, "a", { other: "remote" });
    });
    await act(async () => {
      await result.current.undo();
    });
    const row = (await bridge.queryRows(id, {})).rows.a;
    expect(row?.other).toBe("remote");
    expect(row?.value).toBe("A");
  });

  it("the undo stack does not target a previous table after relinking", async () => {
    const bridge = createMemoryDatabaseBridge({ channelName: crypto.randomUUID() });
    const first = await bridge.createTable("First");
    const second = await bridge.createTable("Second");
    await bridge.createColumn(first, { id: "value", name: "Value", type: "text" });
    await bridge.createColumn(second, { id: "value", name: "Value", type: "text" });
    await bridge.insertRows(first, [{ id: "a", value: "A" }]);

    const { result, rerender } = renderHook(({ table }: { table: string }) => useDatabaseTable(bridge, table), {
      initialProps: { table: first },
    });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => {
      await result.current.updateRow("a", { value: "B" });
    });
    expect(result.current.canUndo).toBe(true);
    // Relink the hook to a different table: the history stands dropped
    // (the stacks stand per table), the undo stands unavailable.
    rerender({ table: second });
    await waitFor(() => expect(result.current.table?.name).toBe("Second"));
    expect(result.current.canUndo).toBe(false);
    await act(async () => {
      await result.current.undo();
    });
    const row = (await bridge.queryRows(first, {})).rows.a;
    expect(row?.value).toBe("B");
  });

  it("the undo stack does not target a previous bridge after the bridge swap", async () => {
    const firstBridge = createMemoryDatabaseBridge({ channelName: crypto.randomUUID() });
    const secondBridge = createMemoryDatabaseBridge({ channelName: crypto.randomUUID() });
    const first = await firstBridge.createTable("bridge first");
    const second = await secondBridge.createTable("bridge second");
    await firstBridge.createColumn(first, { id: "value", name: "Value", type: "text" });
    await secondBridge.createColumn(second, { id: "value", name: "Value", type: "text" });
    await firstBridge.insertRows(first, [{ id: "a", value: "A" }]);

    const { result, rerender } = renderHook(
      ({ bridge, table }: { bridge: DatabaseBridge; table: string }) => useDatabaseTable(bridge, table),
      { initialProps: { bridge: firstBridge, table: first } }
    );
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => {
      await result.current.updateRow("a", { value: "B" });
    });
    rerender({ bridge: secondBridge, table: second });
    await waitFor(() => expect(result.current.table?.name).toBe("bridge second"));
    expect(result.current.canUndo).toBe(false);
    await act(async () => {
      await result.current.undo();
    });
    const row = (await firstBridge.queryRows(first, {})).rows.a;
    expect(row?.value).toBe("B");
  });

  it("an in-flight op of the previous table stands no undo entry after the relink", async () => {
    const bridge = createMemoryDatabaseBridge({ channelName: crypto.randomUUID() });
    const first = await bridge.createTable("inflight first");
    const second = await bridge.createTable("inflight second");
    await bridge.createColumn(first, { id: "value", name: "Value", type: "text" });
    await bridge.createColumn(second, { id: "value", name: "Value", type: "text" });
    await bridge.insertRows(first, [{ id: "a", value: "A" }]);

    // The gate bridge: the updateRow resolves AFTER the relink (the
    // in-flight stand — the op's late completion must stand no entry over
    // the new table's stack).
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gated = new Proxy(bridge, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (prop === "updateRow") {
          return async (tableId: string, rowId: string, cells: Record<string, unknown>) => {
            await gate;
            return target.updateRow(tableId, rowId, cells);
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as DatabaseBridge;

    const { result, rerender } = renderHook(({ table }: { table: string }) => useDatabaseTable(gated, table), {
      initialProps: { table: first },
    });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    let operation: Promise<void> | null = null;
    await act(async () => {
      operation = result.current.updateRow("a", { value: "B" });
    });
    // Relink while the op is in flight.
    rerender({ table: second });
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
    const row = (await bridge.queryRows(first, {})).rows.a;
    expect(row?.value).toBe("B");
  });
});

describe("the column delete's soft-delete restore", () => {
  it("undo restores a middle column at its anchor position", async () => {
    const bridge = createMemoryDatabaseBridge({ channelName: crypto.randomUUID() });
    const id = await bridge.createTable("mid");
    await bridge.createColumn(id, { id: "first", name: "First", type: "text" });
    await bridge.createColumn(id, { id: "value", name: "Value", type: "text" });
    await bridge.createColumn(id, { id: "other", name: "Other", type: "text" });
    await bridge.insertRows(id, [{ id: "a", value: "keep" }]);
    const { result } = renderHook(() => useDatabaseTable(bridge, id));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => {
      await result.current.deleteColumn("value");
    });
    await act(async () => {
      await result.current.undo();
    });
    // The anchor position: the column stands back BEFORE the one that
    // followed it (a restore appended at the end would stand [first, other,
    // value]).
    const columns = (await bridge.describeTable(id)).columns.map((column) => column.id);
    expect(columns).toEqual(["first", "value", "other"]);
    const row = (await bridge.queryRows(id, {})).rows.a;
    expect(row?.value).toBe("keep");
  });

  it("undo restores the values of the rows outside the loaded page", async () => {
    // The hook loads the first page (200 rows); the restore covers the rest
    // of the table (the soft delete keeps the values in the bridge, the
    // loaded pages' and the unloading'd alike).
    const bridge = createMemoryDatabaseBridge({ channelName: crypto.randomUUID() });
    const id = await bridge.createTable("pages");
    await bridge.createColumn(id, { id: "value", name: "Value", type: "text" });
    await bridge.insertRows(
      id,
      Array.from({ length: 210 }, (_, index) => ({ id: `r${index}`, value: `v${index}` }))
    );
    const { result } = renderHook(() => useDatabaseTable(bridge, id));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.rows).toHaveLength(200);
    await act(async () => {
      await result.current.deleteColumn("value");
    });
    await act(async () => {
      await result.current.undo();
    });
    const page = await bridge.queryRows(id, { limit: 200 });
    const tail = await bridge.queryRows(id, { cursor: page.nextCursor ?? undefined, limit: 200 });
    const tailIds = Object.keys(tail.rows);
    expect(tail.rows[tailIds[tailIds.length - 1]!]?.value).toBe("v209");
  });

  it("undo of a column delete covers the removed rows (the trash keeps the value)", async () => {
    const { bridge, id, result } = await setup([{ id: "a", value: "keep" }]);
    await act(async () => {
      await result.current.removeRow("a");
    });
    await act(async () => {
      await result.current.deleteColumn("value");
    });
    await act(async () => {
      await result.current.undo(); // the column's restore (the stack's top)
    });
    await bridge.undeleteRows!(id, ["a"]);
    const row = (await bridge.queryRows(id, {})).rows.a;
    expect(row?.value).toBe("keep");
  });

  it("undo of a column delete keeps the foreign edits of another column", async () => {
    const { bridge, id, result } = await setup([{ id: "a", value: "keep", other: "original" }]);
    await act(async () => {
      await result.current.deleteColumn("value");
    });
    // A remote peer edits another column of the same row.
    await act(async () => {
      await bridge.updateRow(id, "a", { other: "remote" });
    });
    await act(async () => {
      await result.current.undo();
    });
    const row = (await bridge.queryRows(id, {})).rows.a;
    expect(row?.value).toBe("keep");
    expect(row?.other).toBe("remote");
  });

  it("a re-creation over the deleted column drops the old data (the restore stands a no-op)", async () => {
    const { bridge, id, result } = await setup([{ id: "a", value: "keep" }]);
    await act(async () => {
      await result.current.deleteColumn("value");
    });
    await act(async () => {
      await bridge.createColumn(id, { id: "value", name: "Value (new)", type: "text" });
    });
    await act(async () => {
      await result.current.undo(); // nothing left to restore — a no-op
    });
    const description = await bridge.describeTable(id);
    expect(description.columns.some((column) => column.id === "value" && column.name === "Value (new)")).toBe(true);
    // The old value was dropped by the re-creation (the fresh column stands
    // empty).
    const row = (await bridge.queryRows(id, {})).rows.a;
    expect(row?.value).toBeUndefined();
  });
});
