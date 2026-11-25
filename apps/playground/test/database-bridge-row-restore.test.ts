/** The in-memory reference bridge's conformance — the row restore — the undeleteRows' stand. */
import { describe, expect, it } from "vitest";

import { createMemoryDatabaseBridge } from "../src/memory-bridge";
import { codeOf, ctx, seedTable } from "./database-bridge-helpers";

describe("the row restore — the undeleteRows' stand", () => {
  it("the restore is atomic over the ids and stands the not_found over the GC'd row", async () => {
    const bridge = createMemoryDatabaseBridge({ tombstoneRetentionMs: 0 });
    const { tableId, rowIds, nameColumnId } = await seedTable(bridge);
    await bridge.batchRows(
      tableId,
      {
        ops: [
          { op: "delete", rowId: rowIds[0]! },
          { op: "delete", rowId: rowIds[2]! },
        ],
      },
      ctx()
    );
    const restored = await bridge.undeleteRows(tableId, { rowIds: [rowIds[2]!, rowIds[0]!] }, ctx());
    // The restore is independent of the input id order: both rows stand.
    expect(restored.result.rows.length).toBe(2);
    // The already-live id stands the no-op contribution.
    const noOp = await bridge.undeleteRows(tableId, { rowIds: [rowIds[0]!] }, ctx());
    expect(noOp.result.rows).toEqual([]);
    // The GC drops the tombstone: the restore stands the safe not_found.
    await bridge.batchRows(tableId, { ops: [{ op: "delete", rowId: rowIds[4]! }] }, ctx());
    bridge.gcTable(tableId);
    const gc = await bridge
      .undeleteRows(tableId, { rowIds: [rowIds[4]!] }, ctx())
      .catch((operationError: unknown) => operationError);
    expect(codeOf(gc)).toBe("not_found");
    // The GC is invisible: the page stands the live rows (the GC'd row is
    // gone, the head stood no envelope over it).
    const snapshot = await bridge.snapshotTable(tableId, {});
    expect(snapshot.page.rows.map((row) => row.cells[nameColumnId])).toEqual(["Alice", "Bob", "Carol", "Dan"]);
  });

  it("a failed mixed undeleteRows leaves no partial restore (the atomic stand)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, rowIds } = await seedTable(bridge);
    await bridge.batchRows(
      tableId,
      {
        ops: [
          { op: "delete", rowId: rowIds[0]! },
          { op: "delete", rowId: rowIds[1]! },
        ],
      },
      ctx()
    );
    const before = await bridge.snapshotTable(tableId, {});

    // The unknown id stands the whole restore: the valid tombstones stay
    // deleted, and the head stands no envelope over the failure.
    const mixed = await bridge
      .undeleteRows(tableId, { rowIds: [rowIds[0]!, "the-unknown-row"] }, ctx("restore-op"))
      .catch((error: unknown) => error);
    expect(codeOf(mixed)).toBe("not_found");
    const after = await bridge.snapshotTable(tableId, {});
    expect(after.page.rows.some((row) => row.id === rowIds[0] || row.id === rowIds[1])).toBe(false);
    expect(after.page.asOfSeq).toBe(before.page.asOfSeq);

    // The re-sent operation (the same id + the same body) stands the same
    // rejection — the failure is not cached as a success.
    const reSent = await bridge
      .undeleteRows(tableId, { rowIds: [rowIds[0]!, "the-unknown-row"] }, ctx("restore-op"))
      .catch((error: unknown) => error);
    expect(codeOf(reSent)).toBe("not_found");
  });

  it("a failed mixed updateColumn patch leaves no partial apply (the atomic stand)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, nameColumnId } = await seedTable(bridge);
    const before = await bridge.snapshotTable(tableId, {});

    // The invalid position stands the valid name: no field lands, the
    // schema revision stands no envelope over the failure.
    const patch = await bridge
      .updateColumn(tableId, nameColumnId, { name: "Full Name", position: -5 }, ctx())
      .catch((error: unknown) => error);
    expect(codeOf(patch)).toBe("validation");
    const after = await bridge.snapshotTable(tableId, {});
    expect(after.columns.find((column) => column.id === nameColumnId)?.name).toBe("Name");
    expect(after.page.asOfSeq).toBe(before.page.asOfSeq);
    expect(after.schemaRevision).toBe(before.schemaRevision);
  });

  it("the updateColumn stands the full spec validation (the createColumn's stand)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, nameColumnId, ageColumnId } = await seedTable(bridge);
    // The numberDisplay's decimals (the -2 stood the
    // pass over the per-key check; the merged spec stands the reject).
    const badDecimals = await bridge
      .updateColumn(tableId, ageColumnId, { numberDisplay: { decimals: -2 } }, ctx())
      .catch((operationError: unknown) => operationError);
    expect(codeOf(badDecimals)).toBe("validation");
    // The reference's contract over the patch (the kind's stand).
    const badKind = await bridge
      .updateColumn(tableId, nameColumnId, { reference: { kind: "bogus" as never, tableId, many: false } }, ctx())
      .catch((operationError: unknown) => operationError);
    expect(codeOf(badKind)).toBe("validation");
    // The valid patch stands the pass (the finite stand is not the
    // reject-everything stand).
    const ok = await bridge.updateColumn(tableId, ageColumnId, { numberDisplay: { decimals: 2 } }, ctx());
    expect(ok.result.numberDisplay?.decimals).toBe(2);
  });

  it("the updateColumn's position patch stands the move (the reindex's order)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, nameColumnId } = await seedTable(bridge);
    const added = await bridge.createColumn(
      tableId,
      { column: { name: "Note", type: "text", position: 2, nullable: true } },
      ctx()
    );
    // The order before the move: Name, Age, Note.
    let names = (await bridge.snapshotTable(tableId, {})).columns.map((column) => column.name);
    expect(names).toEqual(["Name", "Age", "Note"]);
    // The move of Note to the front (the position 0): the column stands
    // re-inserted at the target index (the reindex stands the order).
    await bridge.updateColumn(tableId, added.result.id, { position: 0 }, ctx());
    names = (await bridge.snapshotTable(tableId, {})).columns.map((column) => column.name);
    expect(names).toEqual(["Note", "Name", "Age"]);
    // The clamped stand: the position over the last index stands the last
    // index (not the out-of-range re-insert).
    await bridge.updateColumn(tableId, nameColumnId, { position: 99 }, ctx());
    names = (await bridge.snapshotTable(tableId, {})).columns.map((column) => column.name);
    expect(names).toEqual(["Note", "Age", "Name"]);
  });

  it("the resolveRowDisplay stands the displays and the null over the missing target", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, rowIds } = await seedTable(bridge);
    const displays = await bridge.resolveRowDisplay(tableId, { rowIds: [rowIds[0]!, rowIds[2]!, "the-missing-row"] });
    expect(displays[rowIds[0]!]).toBe("Alice");
    expect(displays[rowIds[2]!]).toBe("Carol");
    expect(displays["the-missing-row"]).toBeNull();
    // The displayColumn override (the empty column stands the null stand).
    const renamed = await bridge.createColumn(
      tableId,
      { column: { name: "Alias", type: "text", position: 2, nullable: true } },
      ctx()
    );
    const aliased = await bridge.resolveRowDisplay(tableId, { rowIds: [rowIds[0]!], displayColumn: renamed.result.id });
    expect(aliased[rowIds[0]!]).toBeNull();
  });
});
