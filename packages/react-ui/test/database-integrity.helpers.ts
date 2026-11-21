// The shared fixtures over the database-integrity's split set (the fresh
// bridge's seed over the Value / Other columns, the hook's render over the
// ready phase, the bridge's row reads).
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { renderHook, waitFor } from "@testing-library/react";
import { expect } from "vitest";

import type { DatabaseBridge, MutationContext } from "../src/database/bridge";
import { newMutationContext, useDatabaseTable } from "../src/database/use-database-table";

/** The write context (a fresh operation id per call). */
function ctx(): MutationContext {
  return newMutationContext();
}

interface SeededTable {
  bridge: ReturnType<typeof createMemoryDatabaseBridge>;
  tableId: string;
  valueCol: string;
  otherCol: string;
  rowIds: string[];
}

/** Seeds the table (the Value / Other columns + the rows over the
 *  logical cell keys given) on a fresh bridge. */
async function seed(values: Array<{ value?: unknown; other?: unknown }>): Promise<SeededTable> {
  const bridge = createMemoryDatabaseBridge();
  const table = await bridge.createTable({ name: "Review" }, ctx());
  const tableId = table.result.id;
  const value = await bridge.createColumn(
    tableId,
    { column: { name: "Value", type: "text", position: 0, nullable: true } },
    ctx()
  );
  const other = await bridge.createColumn(
    tableId,
    { column: { name: "Other", type: "text", position: 1, nullable: true } },
    ctx()
  );
  const rowIds: string[] = [];
  for (const entry of values) {
    const cells: Record<string, unknown> = {};
    if (entry.value !== undefined) cells[value.result.id] = entry.value;
    if (entry.other !== undefined) cells[other.result.id] = entry.other;
    const receipt = await bridge.batchRows(tableId, { ops: [{ op: "create", row: cells, beforeRowId: null }] }, ctx());
    rowIds.push(receipt.result.rows[0]!.id);
  }
  return { bridge, tableId, valueCol: value.result.id, otherCol: other.result.id, rowIds };
}

/** Renders the hook over the seeded table over the ready phase. */
async function setup(values: Array<{ value?: unknown; other?: unknown }> = []) {
  const { bridge, tableId, valueCol, otherCol, rowIds } = await seed(values);
  const { result } = renderHook(() => useDatabaseTable(bridge, tableId));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  return { bridge, tableId, valueCol, otherCol, rowIds, result };
}

/** The row ids in the stored (bridge) row order. */
const bridgeRowIds = async (bridge: DatabaseBridge, tableId: string): Promise<string[]> =>
  (await bridge.snapshotTable(tableId, {})).page.rows.map((row) => row.id);

/** The row's cells over the bridge's page (undefined = the row is gone). */
const cellsOf = async (
  bridge: DatabaseBridge,
  tableId: string,
  rowId: string
): Promise<Record<string, unknown> | undefined> =>
  (await bridge.snapshotTable(tableId, {})).page.rows.find((row) => row.id === rowId)?.cells;

export { bridgeRowIds, cellsOf, ctx, setup };
