/** The in-memory bridge's internal shapes: the table (the schema + the rows +
 *  the soft-deleted row / column trash) and the bridge's options. */
import type { BridgeColumn } from "../bridge";

interface MemoryTable {
  name: string;
  /** The system (hidden) table — absent from `listTables` (the enum's
   *  options' stand). */
  system?: boolean;
  columns: BridgeColumn[];
  /** row id (the pk value) → the cells. */
  rows: Map<string, Record<string, unknown>>;
  /** row id → the fractional order value. */
  orderValues: Map<string, number>;
  /** The removed rows (the soft-delete trash): row id → the saved state.
   *  The trash keeps every cell the row had — the detached column's
   *  values stand, so a column's restore covers the removed rows too. */
  trash: Map<string, { cells: Record<string, unknown>; orderValue: number }>;
  /** The soft-deleted columns (the `deleteColumn`'s preserved state):
   *  column id → the definition + the anchor position (the id of the
   *  column that stood BEFORE it, null = the first). The cell values are
   *  NOT cleared (they stay in the rows' / trash's objects, invisible
   *  without the schema), so the restore re-inserts the schema and the
   *  values are already in place. `createColumn` of the same id DROPS
   *  the entry (the fresh column stands empty — the old data is gone). */
  detachedColumns: Map<string, { column: BridgeColumn; prevColumnId: string | null }>;
}

interface MemoryBridgeOptions {
  /** The BroadcastChannel name (the default `"docblocks-database-bridge"`); pass a
   *  distinct name per test to isolate the event echo. */
  channelName?: string;
}

export type { MemoryBridgeOptions, MemoryTable };
