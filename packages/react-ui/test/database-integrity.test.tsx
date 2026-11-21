// @vitest-environment jsdom
// The database's forward-only undo/redo over the bridge (the insert's
// identity cell over the redo's fresh ids, the move's pre-move-successor
// anchor, the column delete's position restore): the `useDatabaseTable`
// hook + the memory bridge.
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { useDatabaseTable } from "../src/database/use-database-table";
import { bridgeRowIds, cellsOf, ctx, setup } from "./database-integrity.helpers";

afterEach(cleanup);

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
});
