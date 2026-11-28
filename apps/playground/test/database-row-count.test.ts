import { newMutationContext } from "docblocks-react-ui";
import { describe, expect, it } from "vitest";

import { createMemoryDatabaseBridge } from "../src/memory-bridge";

describe("the playground consumer's row count", () => {
  it("reads the live total independently of the grid's loaded page", async () => {
    const bridge = createMemoryDatabaseBridge();
    expect(bridge.getRowCount("missing")).toBeUndefined();
    const tableId = (await bridge.createTable({ name: "Tasks" }, newMutationContext())).result.id;
    expect(bridge.getRowCount(tableId)).toBe(0);

    const created = await bridge.batchRows(
      tableId,
      {
        ops: [
          { op: "create", row: {}, beforeRowId: null },
          { op: "create", row: {}, beforeRowId: null },
        ],
      },
      newMutationContext()
    );
    expect(bridge.getRowCount(tableId)).toBe(2);
    expect((await bridge.snapshotTable(tableId, { limit: 1 })).page.rows).toHaveLength(1);

    await bridge.batchRows(
      tableId,
      { ops: [{ op: "delete", rowId: created.result.rows[0]!.id }] },
      newMutationContext()
    );
    expect(bridge.getRowCount(tableId)).toBe(1);
  });
});
