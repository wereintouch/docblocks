// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import type { DatabaseBridge } from "../src/database/bridge";
import { createMemoryDatabaseBridge } from "../src/database/memory-bridge";
import { useDatabaseTable } from "../src/database/use-database-table";

/**
 * Pins for known database undo/redo and relinking defects. Each test asserts
 * the expected (correct) behavior and is marked `.fails()`: while the defect
 * is present the assertion fails, so the `.fails()` expectation is met and the
 * suite stays green. Once a defect is corrected the assertion passes and this
 * test turns red — convert it to a plain `it()` in the same change.
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
  it.fails("a second undo after a redo of an insert removes the redo-created row", async () => {
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

  it.fails("undo of a row move restores the original order", async () => {
    const { bridge, id, result } = await setup([
      { id: "a", value: "A" },
      { id: "b", value: "B" },
      { id: "c", value: "C" },
    ]);
    await act(async () => {
      await result.current.moveRow("b", null);
    });
    await act(async () => {
      await result.current.undo();
    });
    expect(await rowIds(bridge, id)).toEqual(["a", "b", "c"]);
  });

  it.fails("undo of a column delete restores the values and the column position", async () => {
    const { bridge, id, result } = await setup([{ id: "a", value: "keep" }]);
    await act(async () => {
      await result.current.deleteColumn("value");
    });
    await act(async () => {
      await result.current.undo();
    });
    const row = (await bridge.queryRows(id, {})).rows.a;
    expect(row?.value).toBe("keep");
  });

  it.fails("undo of an update changes only the edited field after a remote change", async () => {
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
  });

  it.fails("the undo stack does not target a previous table after relinking", async () => {
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
    // Relink the hook to a different table, then undo.
    rerender({ table: second });
    await waitFor(() => expect(result.current.table?.name).toBe("Second"));
    await act(async () => {
      await result.current.undo();
    });
    const row = (await bridge.queryRows(first, {})).rows.a;
    expect(row?.value).toBe("B");
  });
});
