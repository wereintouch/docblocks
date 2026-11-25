/** The in-memory reference bridge's conformance — the bootstrap — the snapshot → subscribe(afterSeq = R) → replay → live. */
import { describe, expect, it } from "vitest";

import { createMemoryDatabaseBridge } from "../src/memory-bridge";
import { ctx, recordingObserver, seedTable } from "./database-bridge-helpers";

describe("the bootstrap — the snapshot → subscribe(afterSeq = R) → replay → live", () => {
  it("the snapshot stands the schema + the ordered rows + the R + the fingerprint + the semantics", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, nameColumnId, ageColumnId, rowIds } = await seedTable(bridge);
    const snapshot = await bridge.snapshotTable(tableId, {});
    expect(snapshot.table.id).toBe(tableId);
    expect(snapshot.table.name).toBe("People");
    expect(snapshot.columns.map((column) => column.name)).toEqual(["Name", "Age"]);
    expect(snapshot.page.rows.map((row) => row.id)).toEqual(rowIds);
    // The wire row is the ordered stand: the cells over the column ids.
    expect(snapshot.page.rows[0]!.cells).toEqual({ [nameColumnId]: "Alice", [ageColumnId]: 30 });
    // The `R` stands the head at the snapshot's time.
    const R = snapshot.page.asOfSeq;
    expect(R).toBeGreaterThan(0);
    expect(snapshot.page.schemaRevision).toBe(snapshot.schemaRevision);
    expect(typeof snapshot.page.queryFingerprint).toBe("string");
    // The semantics' catalog: the number type stands the comparison operators.
    expect(snapshot.page.semantics.operatorsByColumnType["integer"]?.map((op) => op.id)).toContain(">");
    expect(snapshot.page.semantics.nullOrdering).toBe("last");
  });

  it("the subscription opens after the snapshot and replays the events after R, then stands live", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, rowIds, ageColumnId } = await seedTable(bridge);
    const snapshot = await bridge.snapshotTable(tableId, {});
    const R = snapshot.page.asOfSeq;
    const observer = recordingObserver();
    const handle = bridge.subscribeTable(tableId, { afterSeq: R }, observer);
    // The replay covers the commits after R — none here (the write race
    // stands empty); the status reaches the live stand.
    expect(observer.readyValue).toEqual({ afterSeq: R, headSeq: R });
    expect(observer.envelopes).toEqual([]);
    expect(observer.statuses).toEqual(["connecting", "live"]);
    // A commit lands: the live delivery stands the envelope (the receipt's
    // committedSeq stands the envelope's seq — the same receipt).
    const receipt = await bridge.batchRows(
      tableId,
      { ops: [{ op: "update", rowId: rowIds[0]!, cells: { [ageColumnId]: 31 } }] },
      ctx()
    );
    expect(observer.envelopes.length).toBe(1);
    const envelope = observer.envelopes[0]!;
    expect(envelope.kind).toBe("commit");
    expect(envelope.seq).toBe(R + 1);
    expect(envelope.prevSeq).toBe(R);
    expect(envelope.receipt?.committedSeq).toBe(receipt.committedSeq);
    expect(envelope.receipt?.operationId).toBe(receipt.operationId);
    expect(envelope.events.map((event) => event.type)).toEqual(["row.updated"]);
    expect(observer.statuses).toEqual(["connecting", "live"]);
    // The replay coverage of a delivered event stands: a fresh subscriber
    // over the same afterSeq receives the same envelope.
    const late = recordingObserver();
    const lateHandle = bridge.subscribeTable(tableId, { afterSeq: R }, late);
    expect(late.envelopes.length).toBe(1);
    expect(late.envelopes[0]?.seq).toBe(R + 1);
    handle.unsubscribe();
    lateHandle.unsubscribe();
  });

  it("the unsubscribe stops the deliveries (the idempotent unsubscribe stands)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, rowIds, ageColumnId } = await seedTable(bridge);
    const snapshot = await bridge.snapshotTable(tableId, {});
    const observer = recordingObserver();
    const handle = bridge.subscribeTable(tableId, { afterSeq: snapshot.page.asOfSeq }, observer);
    handle.unsubscribe();
    handle.unsubscribe(); // the repeat stands
    await bridge.batchRows(
      tableId,
      { ops: [{ op: "update", rowId: rowIds[0]!, cells: { [ageColumnId]: 99 } }] },
      ctx()
    );
    expect(observer.envelopes).toEqual([]);
    expect(observer.statuses.at(-1)).toBe("closed");
  });

  it("the replay window: an afterSeq older than the window stands the replay_expired reset", async () => {
    const bridge = createMemoryDatabaseBridge({ replayWindow: 2 });
    const { tableId } = await seedTable(bridge);
    const snapshot = await bridge.snapshotTable(tableId, {});
    // The head stands the schema's + the rows' commits; an afterSeq at 0
    // is older than the window (2 envelopes behind the head).
    expect(snapshot.page.asOfSeq).toBeGreaterThan(2);
    const observer = recordingObserver();
    const handle = bridge.subscribeTable(tableId, { afterSeq: 0 }, observer);
    expect(observer.resets).toEqual([{ code: "replay_expired" }]);
    expect(observer.statuses.at(-1)).toBe("closed");
    // An afterSeq within the window stands the replay over the fresh
    // stream.
    const near = recordingObserver();
    const nearHandle = bridge.subscribeTable(tableId, { afterSeq: snapshot.page.asOfSeq - 1 }, near);
    expect(near.envelopes.length).toBe(1);
    expect(near.envelopes[0]?.seq).toBe(snapshot.page.asOfSeq);
    expect(near.statuses.at(-1)).toBe("live");
    nearHandle.unsubscribe();
    handle.unsubscribe();
  });
});
