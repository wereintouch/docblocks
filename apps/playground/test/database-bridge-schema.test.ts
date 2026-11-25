/** The in-memory reference bridge's conformance — the schema — the column lifecycle. */
import { describe, expect, it } from "vitest";

import { createMemoryDatabaseBridge } from "../src/memory-bridge";
import { ctx, recordingObserver, seedTable } from "./database-bridge-helpers";

describe("the schema — the column lifecycle", () => {
  it("the create / update / delete / restore stand the events + the position's re-derivation", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId } = await seedTable(bridge);
    const observer = recordingObserver();
    const handle = bridge.subscribeTable(tableId, { afterSeq: 0 }, observer);
    const added = await bridge.createColumn(
      tableId,
      { column: { name: "Note", type: "text", position: 2, nullable: true }, afterColumnId: undefined },
      ctx()
    );
    expect(added.result.id).toBeDefined();
    // The update: the rename stands the name key (the name is an attribute).
    const updated = await bridge.updateColumn(tableId, added.result.id, { name: "Notes" }, ctx());
    expect(updated.result.name).toBe("Notes");
    // The delete: the soft-delete's stand (the restore's stand).
    const deleted = await bridge.deleteColumn(tableId, added.result.id, ctx());
    expect(deleted.result.columnId).toBe(added.result.id);
    const restored = await bridge.restoreDeletedColumn(tableId, added.result.id, ctx());
    expect(restored.result.id).toBe(added.result.id);
    // The no-op over the live column.
    const noOp = await bridge.restoreDeletedColumn(tableId, added.result.id, ctx());
    expect(noOp.result.id).toBe(added.result.id);
    const description = await bridge.describeTable(tableId);
    expect(description.columns.map((column) => column.name)).toEqual(["Name", "Age", "Notes"]);
    // The envelope's events stand the schema's mutations.
    const types = observer.envelopes.map((envelope) =>
      envelope.kind === "commit" ? envelope.events.map((event) => event.type) : []
    );
    expect(types.flat()).toContain("field.created");
    expect(types.flat()).toContain("field.updated");
    expect(types.flat()).toContain("field.deleted");
    expect(types.flat()).toContain("field.restored");
    handle.unsubscribe();
  });

  it("the table's rename + the no-op receipt stand the head's invariance", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId } = await seedTable(bridge);
    const before = await bridge.snapshotTable(tableId, {});
    const same = await bridge.renameTable(tableId, { name: "People" }, ctx());
    expect(same.result.name).toBe("People");
    expect(same.committedSeq).toBe(before.page.asOfSeq);
    const renamed = await bridge.renameTable(tableId, { name: "Folk" }, ctx());
    expect(renamed.committedSeq).toBe(before.page.asOfSeq + 1);
    const after = await bridge.snapshotTable(tableId, {});
    expect(after.table.name).toBe("Folk");
  });

  it("the system table stands hidden over the catalog and reachable by id", async () => {
    const bridge = createMemoryDatabaseBridge();
    const system = await bridge.createTable({ name: "Options", system: true }, ctx());
    const visible = await bridge.listTables();
    expect(visible.map((table) => table.id)).not.toContain(system.result.id);
    const description = await bridge.describeTable(system.result.id);
    expect(description.table.system).toBe(true);
  });
});
