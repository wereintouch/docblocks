// @vitest-environment jsdom
// The column delete's soft-delete restore (the anchor's position, the
// values over the un-loaded pages, the trash's kept value, the foreign
// edits' keep, the re-created column's distinct id).
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { useDatabaseTable } from "../src/database/use-database-table";
import { cellsOf, ctx, setup } from "./database-integrity.helpers";

afterEach(cleanup);

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
