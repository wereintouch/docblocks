import { describe, expect, it } from "vitest";

import { isBridgeError, isDatabaseBridge } from "../src/database/bridge";
import type {
  BatchOp,
  BridgeErrorCode,
  FilterInput,
  MutationContext,
  TableEvent,
  TableSnapshot,
} from "../src/database/bridge";
import { createMemoryDatabaseBridge } from "../src/database/memory-bridge";

/** The test's write context (a fresh operation id per call). */
function ctx(operationId?: string): MutationContext {
  return {
    operationId: operationId ?? crypto.randomUUID(),
    issuedAt: new Date().toISOString(),
  };
}

/** The recording subscription observer (the stream stand). */
function recordingObserver() {
  const envelopes: TableEvent[] = [];
  const statuses: string[] = [];
  const resets: { code: string }[] = [];
  const observer = {
    envelopes,
    statuses,
    resets,
    ready: ({ afterSeq, headSeq }: { afterSeq: number; headSeq: number }) => {
      observer.readyValue = { afterSeq, headSeq };
    },
    event: (envelope: TableEvent) => {
      envelopes.push(envelope);
    },
    status: (value: string) => {
      statuses.push(value);
    },
    error: () => undefined,
    reset: (value: { code: string }) => {
      resets.push(value);
    },
    readyValue: null as null | { afterSeq: number; headSeq: number },
  };
  return observer;
}

/** Seeds a table over the bridge: the schema (the name / age columns) +
 *  the rows in the given order. Returns the table id + the row ids in the
 *  creation order. */
async function seedTable(bridge: ReturnType<typeof createMemoryDatabaseBridge>) {
  const tableReceipt = await bridge.createTable({ name: "People" }, ctx());
  const tableId = tableReceipt.result.id;
  const nameColumn = await bridge.createColumn(
    tableId,
    { column: { name: "Name", type: "text", position: 0, nullable: true } },
    ctx()
  );
  const ageColumn = await bridge.createColumn(
    tableId,
    { column: { name: "Age", type: "integer", position: 1, nullable: true } },
    ctx()
  );
  const rowIds: string[] = [];
  const people: Array<{ name: string; age: number | null }> = [
    { name: "Alice", age: 30 },
    { name: "Bob", age: null },
    { name: "Carol", age: 45 },
    { name: "Dan", age: 25 },
    { name: "Eve", age: 35 },
  ];
  for (const person of people) {
    const receipt = await bridge.batchRows(
      tableId,
      {
        ops: [
          {
            op: "create",
            row: { [nameColumn.result.id]: person.name, [ageColumn.result.id]: person.age },
            beforeRowId: null,
          },
        ],
      },
      ctx()
    );
    rowIds.push(receipt.result.rows[0]!.id);
  }
  return { tableId, nameColumnId: nameColumn.result.id, ageColumnId: ageColumn.result.id, rowIds };
}

/** The rejected error's code (null = not a bridge error). */
function codeOf(error: unknown): BridgeErrorCode | null {
  return isBridgeError(error) ? error.code : null;
}

describe("the in-memory reference bridge — the protocol's negotiation", () => {
  it("stands the version 2 descriptor with the baseline capabilities + the limits", async () => {
    const bridge = createMemoryDatabaseBridge();
    const descriptor = await bridge.describeProtocol();
    expect(descriptor.protocolVersion).toBe(2);
    for (const capability of [
      "orderedRows",
      "snapshotReplay",
      "idempotentWrites",
      "structuredErrors",
      "viewInvalidation",
    ]) {
      expect(descriptor.capabilities).toContain(capability);
    }
    expect(descriptor.limits.maxPageSize).toBeGreaterThan(0);
    expect(descriptor.limits.maxBatchOps).toBeGreaterThan(0);
    expect(descriptor.operationRetentionSeconds).toBeGreaterThan(0);
    expect(descriptor.retryHorizonSeconds).toBeGreaterThan(0);
  });

  it("the guard accepts the reference bridge and rejects the non-conformant stand", () => {
    expect(isDatabaseBridge(createMemoryDatabaseBridge())).toBe(true);
    // The discriminators (describeProtocol / snapshotTable / batchRows) are
    // absent — the guard stands the rejection.
    expect(isDatabaseBridge({ listTables: async () => [] })).toBe(false);
    expect(isDatabaseBridge(null)).toBe(false);
  });
});

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

describe("the idempotency — the operation id's stand", () => {
  it("the same operationId + the same body returns the stored receipt (no second effect)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, rowIds, nameColumnId } = await seedTable(bridge);
    const operationId = crypto.randomUUID();
    const body: { ops: BatchOp[] } = { ops: [{ op: "create", row: { [nameColumnId]: "Twin" }, beforeRowId: null }] };
    const first = await bridge.batchRows(tableId, body, ctx(operationId));
    const second = await bridge.batchRows(tableId, body, ctx(operationId));
    expect(second).toEqual(first);
    // No second effect: the row count stands.
    const snapshot = await bridge.snapshotTable(tableId, {});
    expect(snapshot.page.rows.length).toBe(rowIds.length + 1);
    // The reconciliation: the lost response stands the committed receipt.
    const status = await bridge.getOperationStatus(operationId);
    expect(status.state).toBe("committed");
    if (status.state === "committed") expect(status.receipt).toEqual(first);
  });

  it("the same operationId with a different body rejects with the idempotency_conflict", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, rowIds, nameColumnId } = await seedTable(bridge);
    const operationId = crypto.randomUUID();
    await bridge.batchRows(
      tableId,
      { ops: [{ op: "create", row: { [nameColumnId]: "A" }, beforeRowId: null }] },
      ctx(operationId)
    );
    const conflict = await bridge
      .batchRows(
        tableId,
        { ops: [{ op: "create", row: { [nameColumnId]: "B" }, beforeRowId: null }] },
        ctx(operationId)
      )
      .catch((error: unknown) => error);
    expect(codeOf(conflict)).toBe("idempotency_conflict");
    // The second body was never executed.
    const snapshot = await bridge.snapshotTable(tableId, {});
    expect(snapshot.page.rows.length).toBe(rowIds.length + 1);
  });

  it("the operation past the retention rejects with the idempotency_expired (never re-executed)", async () => {
    const bridge = createMemoryDatabaseBridge({ operationRetentionSeconds: 0 });
    const { tableId, rowIds, nameColumnId } = await seedTable(bridge);
    const operationId = crypto.randomUUID();
    const body: { ops: BatchOp[] } = { ops: [{ op: "create", row: { [nameColumnId]: "Late" }, beforeRowId: null }] };
    await bridge.batchRows(tableId, body, ctx(operationId));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const expired = await bridge.batchRows(tableId, body, ctx(operationId)).catch((error: unknown) => error);
    expect(codeOf(expired)).toBe("idempotency_expired");
    // The sticky tombstone: a LATER retry of the same id stands the same
    // stand (the deleted-entry stand would re-execute the operation — a
    // second effect).
    const again = await bridge.batchRows(tableId, body, ctx(operationId)).catch((error: unknown) => error);
    expect(codeOf(again)).toBe("idempotency_expired");
    const snapshot = await bridge.snapshotTable(tableId, {});
    expect(snapshot.page.rows.length).toBe(rowIds.length + 1);
    const unknown = await bridge.getOperationStatus(operationId).catch((error: unknown) => error);
    expect(codeOf(unknown)).toBe("operation_unknown");
  });

  it("the replay of a committed deleteColumn stands the stored receipt (not the not_found)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, ageColumnId } = await seedTable(bridge);
    const operationId = crypto.randomUUID();
    const first = await bridge.deleteColumn(tableId, ageColumnId, ctx(operationId));
    // The lost response stand: the replay (the same id, the same body)
    // returns the stored receipt — the column stands gone, the state
    // check must not reject the replay with the not_found.
    const replay = await bridge.deleteColumn(tableId, ageColumnId, ctx(operationId));
    expect(replay).toEqual(first);
  });

  it("the unknown operationId stands the operation_unknown (never a new mutation)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const unknown = await bridge.getOperationStatus(crypto.randomUUID()).catch((error: unknown) => error);
    expect(codeOf(unknown)).toBe("operation_unknown");
  });
});

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
    expect(lww.result.rows[0]!.cells[ageColumnId]).toBe(33);
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
});

describe("the page — the keyset cursor + the query's validation", () => {
  it("the cursor paginates over the ordered rows and expires on a commit after R", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, rowIds, nameColumnId } = await seedTable(bridge);
    const snapshot = await bridge.snapshotTable(tableId, { limit: 2 });
    expect(snapshot.page.rows.length).toBe(2);
    expect(snapshot.page.rows.map((row) => row.id)).toEqual(rowIds.slice(0, 2));
    expect(snapshot.page.nextCursor).not.toBeNull();
    const page2 = await bridge.queryNextPage(tableId, {
      cursor: snapshot.page.nextCursor!,
      asOfSeq: snapshot.page.asOfSeq,
      queryFingerprint: snapshot.page.queryFingerprint,
    });
    expect(page2.rows.map((row) => row.id)).toEqual(rowIds.slice(2, 4));
    expect(page2.asOfSeq).toBe(snapshot.page.asOfSeq);
    // A commit that advanced the head after R expires the cursor.
    await bridge.batchRows(
      tableId,
      { ops: [{ op: "create", row: { [nameColumnId]: "F" }, beforeRowId: null }] },
      ctx()
    );
    const expired = await bridge
      .queryNextPage(tableId, {
        cursor: snapshot.page.nextCursor!,
        asOfSeq: snapshot.page.asOfSeq,
        queryFingerprint: snapshot.page.queryFingerprint,
      })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(expired)).toBe("cursor_expired");
  });

  it("the foreign fingerprint / the foreign asOfSeq reject with the cursor_expired", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId } = await seedTable(bridge);
    const snapshot = await bridge.snapshotTable(tableId, { limit: 2 });
    const wrongFingerprint = await bridge
      .queryNextPage(tableId, {
        cursor: snapshot.page.nextCursor!,
        asOfSeq: snapshot.page.asOfSeq,
        queryFingerprint: "fp-other",
      })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(wrongFingerprint)).toBe("cursor_expired");
    const wrongR = await bridge
      .queryNextPage(tableId, {
        cursor: snapshot.page.nextCursor!,
        asOfSeq: snapshot.page.asOfSeq + 1,
        queryFingerprint: snapshot.page.queryFingerprint,
      })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(wrongR)).toBe("cursor_expired");
  });

  it("the sort stands the server-side ordering (the nulls over the declared stand)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, ageColumnId } = await seedTable(bridge);
    const snapshot = await bridge.snapshotTable(tableId, { sort: [{ fieldId: ageColumnId, direction: "desc" }] });
    // The ages stand the descending order; the null (Bob) stands the last
    // stand (the declared nullOrdering).
    expect(snapshot.page.rows.map((row) => row.cells[ageColumnId])).toEqual([45, 35, 30, 25, null]);
  });

  it("the filter: the validation rejects the unknown operator / the depth / the valueless value", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, ageColumnId, nameColumnId } = await seedTable(bridge);
    // The unknown operator for the number type.
    const badOperator = await bridge
      .snapshotTable(tableId, {
        filter: { logic: "and", conditions: [{ columnId: ageColumnId, op: "contains", value: "x" }] },
      })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(badOperator)).toBe("invalid_operator");
    // The valueless operator with the value (the text column's "empty").
    const badValue = await bridge
      .snapshotTable(tableId, {
        filter: { logic: "and", conditions: [{ columnId: nameColumnId, op: "empty", value: null }] },
      })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(badValue)).toBe("invalid_filter");
    // The depth over the limit.
    let deep: FilterInput = { logic: "and", conditions: [] };
    for (let i = 0; i < 12; i++) deep = { logic: "and", conditions: [], groups: [deep] };
    const badDepth = await bridge
      .snapshotTable(tableId, { filter: deep })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(badDepth)).toBe("limit_exceeded");
    // The unknown column.
    const badColumn = await bridge
      .snapshotTable(tableId, { filter: { logic: "and", conditions: [{ columnId: "nope", op: "is", value: 1 }] } })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(badColumn)).toBe("invalid_column");
    // The page limit over the negotiated one.
    const badLimit = await bridge
      .snapshotTable(tableId, { limit: 1_000_000 })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(badLimit)).toBe("limit_exceeded");
  });

  it("the filter: the and / or pool stands the evaluation (the pool's semantics)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, ageColumnId, nameColumnId } = await seedTable(bridge);
    // The logic stands the POOL of the conditions + the groups: the or pool
    // passes the row over any branch.
    const snapshot = await bridge.snapshotTable(tableId, {
      filter: {
        logic: "or",
        conditions: [{ columnId: ageColumnId, op: ">", value: 28 }],
        groups: [{ logic: "and", conditions: [{ columnId: nameColumnId, op: "is", value: "Bob" }], groups: null }],
      },
    });
    // Alice (30), Carol (45), Eve (35) pass the age branch; Bob (the null
    // age) stands the group's pass; Dan fails both.
    const names = snapshot.page.rows.map((row) => row.cells[nameColumnId]);
    expect(names).toContain("Alice");
    expect(names).toContain("Carol");
    expect(names).toContain("Eve");
    expect(names).toContain("Bob");
    expect(names).not.toContain("Dan");
    // The and pool stands the conjunctive stand (no row passes both
    // branches: Bob's age is null, the named rows fail the age).
    const none = await bridge.snapshotTable(tableId, {
      filter: {
        logic: "and",
        conditions: [{ columnId: ageColumnId, op: ">", value: 28 }],
        groups: [{ logic: "and", conditions: [{ columnId: nameColumnId, op: "is", value: "Bob" }], groups: null }],
      },
    });
    expect(none.page.rows).toEqual([]);
  });
});

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

describe("the cell's validation", () => {
  it("the unknown column / the non-nullable null / the non-scalar reject the op", async () => {
    const bridge = createMemoryDatabaseBridge();
    const tableReceipt = await bridge.createTable({ name: "Strict" }, ctx());
    const tableId = tableReceipt.result.id;
    const column = await bridge.createColumn(
      tableId,
      { column: { name: "Value", type: "text", position: 0, nullable: false } },
      ctx()
    );
    const badColumn = await bridge
      .batchRows(tableId, { ops: [{ op: "create", row: { nope: "x" }, beforeRowId: null }] }, ctx())
      .catch((operationError: unknown) => operationError);
    expect(codeOf(badColumn)).toBe("invalid_column");
    const nonNullable = await bridge
      .batchRows(tableId, { ops: [{ op: "create", row: { [column.result.id]: null }, beforeRowId: null }] }, ctx())
      .catch((operationError: unknown) => operationError);
    expect(codeOf(nonNullable)).toBe("validation");
    const nonScalar = await bridge
      .batchRows(
        tableId,
        { ops: [{ op: "create", row: { [column.result.id]: { nested: true } }, beforeRowId: null }] },
        ctx()
      )
      .catch((operationError: unknown) => operationError);
    expect(codeOf(nonScalar)).toBe("validation");
    // The non-finite number stands the wire's JSON stand (the round-trip
    // stands the null — the silent corruption): the top-level value and
    // the array's element stand rejected.
    const infinity = await bridge
      .batchRows(tableId, { ops: [{ op: "create", row: { [column.result.id]: Infinity }, beforeRowId: null }] }, ctx())
      .catch((operationError: unknown) => operationError);
    expect(codeOf(infinity)).toBe("validation");
    const minusInfinity = await bridge
      .batchRows(tableId, { ops: [{ op: "create", row: { [column.result.id]: -Infinity }, beforeRowId: null }] }, ctx())
      .catch((operationError: unknown) => operationError);
    expect(codeOf(minusInfinity)).toBe("validation");
    const inArray = await bridge
      .batchRows(
        tableId,
        { ops: [{ op: "create", row: { [column.result.id]: ["ok", Infinity] }, beforeRowId: null }] },
        ctx()
      )
      .catch((operationError: unknown) => operationError);
    expect(codeOf(inArray)).toBe("validation");
    // The finite number stands the pass (the stand is the finiteness, not
    // the type — the contract's type-agnostic stand).
    await bridge.batchRows(
      tableId,
      { ops: [{ op: "create", row: { [column.result.id]: 42 }, beforeRowId: null }] },
      ctx()
    );
  });
});

describe("the snapshot's consistency — the schema + the page over one R", () => {
  it("the schema and the page stand the same snapshot boundary (the R's stand)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId } = await seedTable(bridge);
    const snapshot: TableSnapshot = await bridge.snapshotTable(tableId, {});
    // The schema and the page come from one consistent read: the page's
    // `schemaRevision` stands the snapshot's (the same `R`).
    expect(snapshot.page.schemaRevision).toBe(snapshot.schemaRevision);
    const R = snapshot.page.asOfSeq;
    const observer = recordingObserver();
    const handle = bridge.subscribeTable(tableId, { afterSeq: R }, observer);
    // A schema mutation + a row mutation race over the R: both stand the
    // envelopes after R (the replay's coverage).
    await bridge.createColumn(tableId, { column: { name: "Late", type: "text", position: 2, nullable: true } }, ctx());
    expect(observer.envelopes.length).toBe(1);
    expect(observer.envelopes[0]?.kind).toBe("commit");
    handle.unsubscribe();
  });
});

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
