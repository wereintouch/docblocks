/** The in-memory reference bridge's conformance — the enum option — the live reference's guard. */
import { describe, expect, it } from "vitest";

import { createMemoryDatabaseBridge } from "../src/memory-bridge";
import { codeOf, ctx, recordingObserver } from "./database-bridge-helpers";

describe("the enum option — the live reference's guard", () => {
  /** The option catalog (the system table) + the parent table with the
   *  enum column over it; returns the ids + the option row ids. */
  async function seedEnum(bridge: ReturnType<typeof createMemoryDatabaseBridge>, many = false) {
    const dict = await bridge.createTable({ name: "Statuses", system: true }, ctx());
    const nameColumn = await bridge.createColumn(
      dict.result.id,
      { column: { name: "Name", type: "text", position: 0, nullable: true } },
      ctx()
    );
    const options = await bridge.batchRows(
      dict.result.id,
      {
        ops: [
          { op: "create", row: { [nameColumn.result.id]: "done" }, beforeRowId: null },
          { op: "create", row: { [nameColumn.result.id]: "later" }, beforeRowId: null },
        ],
      },
      ctx()
    );
    const optionIds = options.result.rows.map((row) => row.id);
    const used = optionIds[0]!;
    const free = optionIds[1]!;
    const main = await bridge.createTable({ name: "Tasks" }, ctx());
    const statusColumn = await bridge.createColumn(
      main.result.id,
      {
        column: {
          name: "Status",
          type: "text",
          position: 0,
          nullable: true,
          reference: { kind: "enum", tableId: dict.result.id, many },
        },
      },
      ctx()
    );
    await bridge.batchRows(
      main.result.id,
      { ops: [{ op: "create", row: { [statusColumn.result.id]: many ? [used] : used }, beforeRowId: null }] },
      ctx()
    );
    return { dictId: dict.result.id, mainId: main.result.id, used, free, nameColumnId: nameColumn.result.id };
  }

  it("the in-use option's delete rejects with the option_in_use (no tombstone, no envelope)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { dictId, used, free } = await seedEnum(bridge);
    const baseline = await bridge.snapshotTable(dictId, {});
    const observer = recordingObserver();
    const handle = bridge.subscribeTable(dictId, { afterSeq: baseline.page.asOfSeq }, observer);
    try {
      const rejected = await bridge
        .batchRows(dictId, { ops: [{ op: "delete", rowId: used }] }, ctx())
        .catch((operationError: unknown) => operationError);
      expect(codeOf(rejected)).toBe("enum.option_in_use");
      // The refusal stands the no-effect: the option is not tombstoned and
      // the stream has no envelope over the refused write.
      const after = await bridge.snapshotTable(dictId, { limit: 10 });
      expect(after.page.rows.map((row) => row.id)).toContain(used);
      expect(observer.envelopes.length).toBe(0);
      // The unreferenced option stands the plain delete.
      await bridge.batchRows(dictId, { ops: [{ op: "delete", rowId: free }] }, ctx());
      const afterFree = await bridge.snapshotTable(dictId, { limit: 10 });
      expect(afterFree.page.rows.map((row) => row.id)).not.toContain(free);
      expect(observer.envelopes.length).toBe(1);
    } finally {
      handle.unsubscribe();
    }
  });

  it("the many reference's membership stands the same guard (the array's cell)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { dictId, used, free } = await seedEnum(bridge, true);
    const rejected = await bridge
      .batchRows(dictId, { ops: [{ op: "delete", rowId: used }] }, ctx())
      .catch((operationError: unknown) => operationError);
    expect(codeOf(rejected)).toBe("enum.option_in_use");
    await bridge.batchRows(dictId, { ops: [{ op: "delete", rowId: free }] }, ctx());
    const after = await bridge.snapshotTable(dictId, { limit: 10 });
    expect(after.page.rows.map((row) => row.id)).not.toContain(free);
  });

  it("the in-use delete rolls the mixed batch back (the atomic stand)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { dictId, used, nameColumnId } = await seedEnum(bridge);
    const before = await bridge.snapshotTable(dictId, { limit: 10 });
    const beforeName = before.page.rows.find((row) => row.id === used)?.cells[nameColumnId];
    const rejected = await bridge
      .batchRows(
        dictId,
        {
          ops: [
            { op: "update", rowId: used, cells: { [nameColumnId]: "done!" } },
            { op: "delete", rowId: used },
          ],
        },
        ctx()
      )
      .catch((operationError: unknown) => operationError);
    expect(codeOf(rejected)).toBe("enum.option_in_use");
    // The whole batch is rolled back: the touched update stands no effect.
    const after = await bridge.snapshotTable(dictId, { limit: 10 });
    const afterName = after.page.rows.find((row) => row.id === used)?.cells[nameColumnId];
    expect(afterName).toBe(beforeName);
    expect(after.page.rows.map((row) => row.id)).toContain(used);
  });
});
