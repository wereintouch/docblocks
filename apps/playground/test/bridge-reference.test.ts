import { isBridgeError, isDatabaseBridge, newMutationContext } from "docblocks-react-ui";
import type { BridgeErrorCode } from "docblocks-react-ui";
import { describe, expect, it } from "vitest";

import { createMemoryDatabaseBridge } from "../src/memory-bridge";

/** The rejected error's code (null = not a bridge error). */
function codeOf(error: unknown): BridgeErrorCode | null {
  return isBridgeError(error) ? error.code : null;
}

describe("the reference bridge — the table's identity + the unknown-id codes", () => {
  it("the bridge stands the isDatabaseBridge shape check", () => {
    expect(isDatabaseBridge(createMemoryDatabaseBridge())).toBe(true);
    expect(isDatabaseBridge({ listTables: async () => [] })).toBe(false);
    expect(isDatabaseBridge(null)).toBe(false);
  });

  it("createTable's name stands the deterministic slug; the repeat name stands the suffixed id", async () => {
    const bridge = createMemoryDatabaseBridge();
    const first = await bridge.createTable({ name: "Demo" }, newMutationContext());
    expect(first.result.id).toBe("table-demo");
    // The repeat name stands the distinct table (the suffixed id), not the
    // adoption of the first one.
    const second = await bridge.createTable({ name: "Demo" }, newMutationContext());
    expect(second.result.id).toBe("table-demo-2");
    expect((await bridge.listTables()).map((table) => table.name)).toEqual(["Demo", "Demo"]);
  });

  it("the unknown table / column stand the structured not_found / invalid_column codes", async () => {
    const bridge = createMemoryDatabaseBridge();
    const unknownTable = await bridge.snapshotTable("the-unknown-table", {}).catch((error: unknown) => error);
    expect(codeOf(unknownTable)).toBe("not_found");
    const unknownRename = await bridge
      .renameTable("the-unknown-table", { name: "X" }, newMutationContext())
      .catch((error: unknown) => error);
    expect(codeOf(unknownRename)).toBe("not_found");
    const unknownColumn = await bridge
      .updateColumn("the-unknown-table", "the-unknown-column", { name: "X" }, newMutationContext())
      .catch((error: unknown) => error);
    expect(codeOf(unknownColumn)).toBe("not_found");
    const bridge2 = createMemoryDatabaseBridge();
    const table = await bridge2.createTable({ name: "Cols" }, newMutationContext());
    const column = await bridge2.createColumn(
      table.result.id,
      { column: { name: "C", type: "text", position: 0, nullable: true } },
      newMutationContext()
    );
    const missingDelete = await bridge2
      .deleteColumn(table.result.id, "the-unknown-column", newMutationContext())
      .catch((error: unknown) => error);
    expect(codeOf(missingDelete)).toBe("not_found");
    const missingUpdate = await bridge2
      .updateColumn(table.result.id, "the-unknown-column", { name: "X" }, newMutationContext())
      .catch((error: unknown) => error);
    expect(codeOf(missingUpdate)).toBe("invalid_column");
    // The known column stands (the delete's commit).
    const deleted = await bridge2.deleteColumn(table.result.id, column.result.id, newMutationContext());
    expect(deleted.result.columnId).toBe(column.result.id);
  });
});
