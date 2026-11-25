/** The in-memory reference bridge's conformance — the order key's collapse — the in-transaction rebalance. */
import { describe, expect, it } from "vitest";

import { createMemoryDatabaseBridge } from "../src/memory-bridge";
import { ctx, recordingObserver } from "./database-bridge-helpers";

describe("the order key's collapse — the in-transaction rebalance", () => {
  it("the midpoint collapse stands the single invalidate envelope (the dense keys after, the stream continues)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const table = await bridge.createTable({ name: "Order" }, ctx());
    const tableId = table.result.id;
    const column = await bridge.createColumn(
      tableId,
      { column: { name: "Name", type: "text", position: 0, nullable: true } },
      ctx()
    );
    const columnId = column.result.id;
    await bridge.batchRows(tableId, { ops: [{ op: "create", row: { [columnId]: "A" }, beforeRowId: null }] }, ctx());
    const second = await bridge.batchRows(
      tableId,
      { ops: [{ op: "create", row: { [columnId]: "B" }, beforeRowId: null }] },
      ctx()
    );
    const anchorId = second.result.rows[0]!.id;
    const baseline = await bridge.snapshotTable(tableId, {});
    const observer = recordingObserver();
    const handle = bridge.subscribeTable(tableId, { afterSeq: baseline.page.asOfSeq }, observer);
    try {
      // The 60 consecutive middle inserts before the anchor: the IEEE-754
      // midpoints converge and the gap collapses below the double's ulp —
      // the in-transaction baseline rebalance kicks in exactly once.
      for (let i = 0; i < 60; i++) {
        await bridge.batchRows(
          tableId,
          { ops: [{ op: "create", row: { [columnId]: `x${i}` }, beforeRowId: anchorId }] },
          ctx()
        );
      }
    } finally {
      handle.unsubscribe();
    }
    expect(observer.envelopes.length).toBe(60);
    const invalidates = observer.envelopes.filter((envelope) => envelope.kind === "invalidate");
    expect(invalidates.length).toBe(1);
    // The collapsed op is written exactly once: its commit rides on the
    // invalidate envelope (the canonical receipt, no nested events).
    expect(invalidates[0]?.events).toEqual([]);
    expect(invalidates[0]?.receipt).not.toBeNull();
    // After the rebalance: the finite distinct keys over the total order
    // A < x0..x59 < B (the retained rows stand the dense rewrite; the
    // collapsing op's row takes the fresh midpoint).
    const snapshot = await bridge.snapshotTable(tableId, { limit: 100 });
    expect(snapshot.page.rows.length).toBe(62);
    const keys = snapshot.page.rows.map((row) => row.orderKey);
    expect(new Set(keys).size).toBe(62);
    expect(keys.every((key) => Number.isFinite(key))).toBe(true);
    const names = snapshot.page.rows.map((row) => row.cells[columnId]);
    expect(names[0]).toBe("A");
    expect(names.at(-1)).toBe("B");
    // The stream continues normally: the next insert stands a plain commit.
    const late = await bridge.snapshotTable(tableId, {});
    const lateObserver = recordingObserver();
    const lateHandle = bridge.subscribeTable(tableId, { afterSeq: late.page.asOfSeq }, lateObserver);
    await bridge.batchRows(tableId, { ops: [{ op: "create", row: { [columnId]: "C" }, beforeRowId: null }] }, ctx());
    expect(lateObserver.envelopes.length).toBe(1);
    expect(lateObserver.envelopes[0]?.kind).toBe("commit");
    lateHandle.unsubscribe();
  });
});
