/** The in-memory reference bridge's conformance — the stream's chain — the prevSeq's link + the order keys. */
import { describe, expect, it } from "vitest";

import { createMemoryDatabaseBridge } from "../src/memory-bridge";
import { ctx, recordingObserver, seedTable } from "./database-bridge-helpers";

describe("the stream's chain — the prevSeq's link + the order keys", () => {
  it("every envelope chains over its predecessor's seq (the prevSeq's stand)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId } = await seedTable(bridge);
    const snapshot = await bridge.snapshotTable(tableId, {});
    const observer = recordingObserver();
    const handle = bridge.subscribeTable(tableId, { afterSeq: 0 }, observer);
    // The full replay: the chain starts at the table's first envelope
    // (the prevSeq null) and links every successor.
    const envelopes = observer.envelopes;
    expect(envelopes.length).toBe(snapshot.page.asOfSeq);
    expect(envelopes[0]?.prevSeq).toBeNull();
    envelopes.forEach((envelope, index) => {
      if (index === 0) return;
      expect(envelope.prevSeq).toBe(envelopes[index - 1]?.seq);
    });
    expect(envelopes.map((envelope) => envelope.seq)).toEqual(envelopes.map((_, index) => index + 1));
    handle.unsubscribe();
  });

  it("the order keys stand the normative candidates (the head / middle / tail allocation)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, rowIds, nameColumnId } = await seedTable(bridge);
    // The rows stand 1..5 (the tail allocation: the left bound + 1).
    const snapshot = await bridge.snapshotTable(tableId, {});
    expect(snapshot.page.rows.map((row) => row.orderKey)).toEqual([1, 2, 3, 4, 5]);
    // The middle create (before the anchor): the mean of the neighbours.
    await bridge.batchRows(
      tableId,
      { ops: [{ op: "create", row: { [nameColumnId]: "Mid" }, beforeRowId: rowIds[1]! }] },
      ctx()
    );
    // The head create: the right bound − 1.
    await bridge.batchRows(
      tableId,
      { ops: [{ op: "create", row: { [nameColumnId]: "Head" }, beforeRowId: rowIds[0]! }] },
      ctx()
    );
    const after = await bridge.snapshotTable(tableId, {});
    const names = after.page.rows.map((row) => row.cells[nameColumnId]);
    expect(names).toEqual(["Head", "Alice", "Mid", "Bob", "Carol", "Dan", "Eve"]);
    const orderKeys = after.page.rows.map((row) => row.orderKey);
    // The canonical order: strictly increasing over the visible rows.
    orderKeys.forEach((key, index) => {
      if (index === 0) return;
      expect(key).toBeGreaterThan(orderKeys[index - 1]!);
      expect(Number.isFinite(key)).toBe(true);
    });
  });

  it("a tombstone between two live rows keeps its order key (the retained bounds' stand)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, rowIds, nameColumnId } = await seedTable(bridge);
    // Delete Bob (row 2): the tombstone keeps its key.
    await bridge.batchRows(tableId, { ops: [{ op: "delete", rowId: rowIds[1]! }] }, ctx());
    // The create before Carol stands after the tombstone's key.
    await bridge.batchRows(
      tableId,
      { ops: [{ op: "create", row: { [nameColumnId]: "X" }, beforeRowId: rowIds[2]! }] },
      ctx()
    );
    const after = await bridge.snapshotTable(tableId, {});
    const names = after.page.rows.map((row) => row.cells[nameColumnId]);
    expect(names).toEqual(["Alice", "X", "Carol", "Dan", "Eve"]);
    // The restore lands over the saved seat (the tombstone's key stands
    // under X's).
    const restore = await bridge.undeleteRows(tableId, { rowIds: [rowIds[1]!] }, ctx());
    expect(restore.result.rows.length).toBe(1);
    const restored = await bridge.snapshotTable(tableId, {});
    expect(restored.page.rows.map((row) => row.cells[nameColumnId])).toEqual([
      "Alice",
      "Bob",
      "X",
      "Carol",
      "Dan",
      "Eve",
    ]);
  });

  it("the move to the current seat stands the no-op (no event, no second key)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, rowIds } = await seedTable(bridge);
    const before = await bridge.snapshotTable(tableId, {});
    // Bob (row 2) stands after Alice: the move before Alice's successor
    // (Bob's own seat) is the no-op stand.
    const receipt = await bridge.batchRows(
      tableId,
      { ops: [{ op: "move", rowId: rowIds[1]!, beforeRowId: rowIds[1]! }] },
      ctx()
    );
    expect(receipt.result.rows).toEqual([]);
    const after = await bridge.snapshotTable(tableId, {});
    expect(after.page.rows.map((row) => row.id)).toEqual(before.page.rows.map((row) => row.id));
    expect(after.page.rows[1]!.orderKey).toBe(before.page.rows[1]!.orderKey);
  });
});
