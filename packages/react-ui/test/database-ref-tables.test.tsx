// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DatabaseBridge, Id } from "../src/database/bridge";
import { refEntryKey, useRefTables } from "../src/database/grid/use-ref-tables";
import { newMutationContext } from "../src/database/use-database-table";

function ctx() {
  return newMutationContext();
}

describe("the ref tables' data — the cursor's continuation (the catalog stands complete)", () => {
  it("the dict over the page size stands the full option list (the first page's truncation is not a stand)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const dict = await bridge.createTable({ name: "Statuses", system: true }, ctx());
    const nameColumn = await bridge.createColumn(
      dict.result.id,
      { column: { name: "Name", type: "text", position: 0, nullable: true } },
      ctx()
    );
    // The 210 options stand over the page size (the 200's page set is NOT
    // the catalog's stand — the continuation runs to the tail).
    const ops = Array.from({ length: 210 }, (_, i) => ({
      op: "create" as const,
      row: { [nameColumn.result.id]: `option-${i}` },
      beforeRowId: null,
    }));
    await bridge.batchRows(dict.result.id, { ops }, ctx());
    const { result } = renderHook(() => useRefTables(bridge, [{ tableId: dict.result.id }]));
    const key = refEntryKey({ tableId: dict.result.id });
    await waitFor(() => expect(result.current[key]?.rowIds.length).toBe(210));
    // The displays stand the labels over the FULL list (the row past the
    // first page's bound stands its label, not the raw id's fallback).
    const rowIds = result.current[key]!.rowIds;
    expect(result.current[key]!.displays[rowIds[205]!]).toBe("option-205");
    expect(result.current[key]!.displays[rowIds[209]!]).toBe("option-209");
  });
});

describe("the ref tables' live refresh (the per-entry coalescing)", () => {
  it("a burst of envelopes stands the running load + the trailing load (no parallel loads)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const dict = await bridge.createTable({ name: "Options", system: true }, ctx());
    const tableId = dict.result.id;
    const nameColumn = await bridge.createColumn(
      tableId,
      { column: { name: "Name", type: "text", position: 0, nullable: true } },
      ctx()
    );
    const colId = nameColumn.result.id;
    await bridge.batchRows(tableId, { ops: [{ op: "create", row: { [colId]: "seed" }, beforeRowId: null }] }, ctx());

    // The wrapper counts the refresh's resolve path and blocks the second
    // call (the event's refresh load) over the burst's window; the
    // trailing load (the third call) runs unblocked.
    let displayCalls = 0;
    let release: (() => void) | null = null;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const wrapped: DatabaseBridge = {
      ...bridge,
      async resolveRowDisplay(id: Id, input: { rowIds: Id[]; displayColumn?: Id }) {
        displayCalls += 1;
        if (displayCalls === 2) await blocked;
        return bridge.resolveRowDisplay(id, input);
      },
    };
    const { result } = renderHook(() => useRefTables(wrapped, [{ tableId }]));
    const key = refEntryKey({ tableId });
    await waitFor(() => expect(result.current[key]?.rowIds.length).toBe(1));
    expect(displayCalls).toBe(1);

    // The burst: five commits over the subscription (the first envelope
    // stands the blocked refresh's load, the rest stand the pending's
    // mark — not a parallel load).
    for (let i = 1; i <= 5; i += 1) {
      await bridge.batchRows(
        tableId,
        { ops: [{ op: "create", row: { [colId]: `burst-${i}` }, beforeRowId: null }] },
        ctx()
      );
    }
    await waitFor(() => expect(displayCalls).toBeGreaterThanOrEqual(2));
    release!();

    // The trailing load stands over the full burst: the data catches the
    // last commit, and the burst's window ran exactly one load (the
    // initial + the running + the trailing — the five envelopes coalesced).
    await waitFor(() => expect(result.current[key]?.rowIds.length).toBe(6));
    expect(displayCalls).toBe(3);
    const displays = Object.values(result.current[key]!.displays);
    for (let i = 1; i <= 5; i += 1) expect(displays).toContain(`burst-${i}`);
  });
});
