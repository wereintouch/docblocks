// @vitest-environment jsdom
// The cell edit's undo over a remote's change (the key-scoped inverse
// patch, the same-cell's conflict's newest write, the batch's foreign
// edits' keep, the idempotent echo's stand).
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { cellsOf, ctx, setup } from "./database-integrity.helpers";

afterEach(cleanup);

describe("the forward-only undo/redo over the bridge", () => {
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
});
