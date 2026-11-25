/** The in-memory reference bridge's conformance — the batch — the atomicity + the CAS. */
import { describe, expect, it } from "vitest";

import { createMemoryDatabaseBridge } from "../src/memory-bridge";
import { codeOf, ctx, seedTable } from "./database-bridge-helpers";

describe("the batch — the atomicity + the CAS", () => {
  it("a failed op rolls the whole batch back (no partial envelope, the ops[i] path)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, rowIds, nameColumnId } = await seedTable(bridge);
    const before = await bridge.snapshotTable(tableId, {});
    const error = await bridge
      .batchRows(
        tableId,
        {
          ops: [
            { op: "create", row: { [nameColumnId]: "Ghost" }, beforeRowId: null },
            { op: "update", rowId: "the-unknown-row", cells: { [nameColumnId]: "X" } },
          ],
        },
        ctx()
      )
      .catch((operationError: unknown) => operationError);
    expect(codeOf(error)).toBe("not_found");
    expect((error as { path?: string }).path).toBe("ops[1]");
    const after = await bridge.snapshotTable(tableId, {});
    // The first op's create rolled back: the page stands the pre-batch rows.
    expect(after.page.rows.map((row) => row.id)).toEqual(before.page.rows.map((row) => row.id));
    // The head stood no envelope (the failure published nothing).
    expect(after.page.asOfSeq).toBe(before.page.asOfSeq);
    expect(rowIds.length).toBe(before.page.rows.length);
  });

  it("the CAS: the stale expectedRevision rejects with the conflict (the fresh one commits)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, rowIds, ageColumnId } = await seedTable(bridge);
    const snapshot = await bridge.snapshotTable(tableId, {});
    const revision = snapshot.page.rows[0]!.revision;
    // The first write commits over the current revision.
    await bridge.batchRows(
      tableId,
      { ops: [{ op: "update", rowId: rowIds[0]!, cells: { [ageColumnId]: 31 }, expectedRevision: revision }] },
      ctx()
    );
    // The stale revision (the pre-write one) rejects.
    const conflict = await bridge
      .batchRows(
        tableId,
        { ops: [{ op: "update", rowId: rowIds[0]!, cells: { [ageColumnId]: 32 }, expectedRevision: revision }] },
        ctx()
      )
      .catch((operationError: unknown) => operationError);
    expect(codeOf(conflict)).toBe("conflict");
    expect((conflict as { path?: string }).path).toBe("ops[0]");
    // The absent revision stands the LWW default (the commit stands).
    const lww = await bridge.batchRows(
      tableId,
      { ops: [{ op: "update", rowId: rowIds[0]!, cells: { [ageColumnId]: 33 } }] },
      ctx()
    );
    // The update's contribution stands the envelope's event + the revision
    // (the receipt's rows stand the created's stand only — the update's
    // row is not in the receipt).
    expect(lww.revisions[rowIds[0]!]).toBeDefined();
    expect(lww.result.rows).toEqual([]);
    const after = await bridge.snapshotTable(tableId, {});
    expect(after.page.rows[0]!.cells[ageColumnId]).toBe(33);
  });

  it("the all-no-op batch stands the receipt over the head (no event, no key change)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, rowIds, ageColumnId } = await seedTable(bridge);
    const before = await bridge.snapshotTable(tableId, {});
    const receipt = await bridge.batchRows(
      tableId,
      { ops: [{ op: "update", rowId: rowIds[0]!, cells: { [ageColumnId]: before.page.rows[0]!.cells[ageColumnId] } }] },
      ctx()
    );
    expect(receipt.result.rows).toEqual([]);
    expect(receipt.committedSeq).toBe(before.page.asOfSeq);
  });

  it("the mixed batch's receipt stands the created's rows over the create op's order (the update / the move stand no row)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, rowIds, nameColumnId } = await seedTable(bridge);
    // The diff's stand: the update (the first row's rename), the create
    // (the new option), the delete's absence (the row stays), and the
    // move's chain (the draft's order over the created's row).
    const receipt = await bridge.batchRows(
      tableId,
      {
        ops: [
          { op: "update", rowId: rowIds[0]!, cells: { [nameColumnId]: "renamed" } },
          { op: "create", row: { [nameColumnId]: "fresh" }, beforeRowId: null },
          { op: "move", rowId: rowIds[2]!, beforeRowId: rowIds[0]! },
        ],
      },
      ctx()
    );
    // The receipt's rows: the created's row only (the update / the move's
    // contributions stand the envelope's events + the revisions).
    expect(receipt.result.rows.map((row) => row.cells[nameColumnId])).toEqual(["fresh"]);
    const after = await bridge.snapshotTable(tableId, {});
    expect(after.page.rows.map((row) => row.cells[nameColumnId])).toEqual([
      "Carol",
      "renamed",
      "Bob",
      "Dan",
      "Eve",
      "fresh",
    ]);
  });
});
