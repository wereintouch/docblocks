// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
