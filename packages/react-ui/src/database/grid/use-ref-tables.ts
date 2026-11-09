/**
 * The ref-table data provider for the grid: one page of the ref table's
 * rows + the row displays (`resolveRowDisplay` — the join stands in the
 * consumer backend) + the option colors (the ref table's `color` column —
 * the enum's option's chip color; the absent column / value stands none).
 * The enum columns read the option labels from it (the option's row id
 * stands the value, the display stands the label), the row-link columns
 * read the display text over the row ids (the column's declared
 * `refDisplayColumn`, else the bridge's default resolution). The data
 * refreshes on the ref table's live events (the subscription opens over
 * the snapshot's R — an envelope stands the refresh; a reset signal stands
 * the re-snapshot + the re-subscription). A broken ref table (the unknown
 * id) stands the empty data (the lenient read).
 */
import { useEffect, useState } from "react";

import { ENUM_OPTION_COLOR_COLUMN, isBridgeError } from "../bridge";
import type { Column, DatabaseBridge, RowWire, SubscriptionHandle } from "../bridge";

/** The page size the ref table loads (the dict options / the picker's
 *  rows): the cursor's continuation runs over every page (the catalog
 *  stands complete — the truncated option list / the picker's rows are
 *  not a stand). */
const REF_PAGE_SIZE = 200;

/** The cursor's continuation's retry bound (the `cursor_expired` over
 *  the concurrent commit stands the fresh snapshot; the bound stands the
 *  churn's livelock — over it the partial page set stands the lenient
 *  read). */
const REF_LOAD_ATTEMPTS = 3;

/** Loads one page set over the cursor's continuation (the full page set
 *  — the loop runs to the tail; the `cursor_expired` over the concurrent
 *  commit stands the fresh snapshot's retry). The schema stands the first
 *  snapshot's (the page set's stand — the color column's id lookup). */
async function loadFullPages(
  bridge: DatabaseBridge,
  tableId: string
): Promise<{ rows: RowWire[]; asOfSeq: number; columns: Column[] } | null> {
  for (let attempt = 0; attempt < REF_LOAD_ATTEMPTS; attempt += 1) {
    const snapshot = await bridge.snapshotTable(tableId, { limit: REF_PAGE_SIZE });
    const rows = [...snapshot.page.rows];
    const columns = snapshot.columns;
    let cursor = snapshot.page.nextCursor;
    let asOfSeq = snapshot.page.asOfSeq;
    let queryFingerprint = snapshot.page.queryFingerprint;
    while (cursor !== null) {
      try {
        const page = await bridge.queryNextPage(tableId, {
          cursor,
          asOfSeq,
          queryFingerprint,
        });
        for (const row of page.rows) rows.push(row);
        cursor = page.nextCursor;
        asOfSeq = page.asOfSeq;
        queryFingerprint = page.queryFingerprint;
      } catch (pageError) {
        // The cursor's snapshot boundary advanced (the concurrent commit):
        // the fresh snapshot's retry (the loop's stand).
        if (isBridgeError(pageError) && pageError.code === "cursor_expired" && attempt < REF_LOAD_ATTEMPTS - 1) {
          break;
        }
        throw pageError;
      }
    }
    if (cursor === null) return { rows, asOfSeq, columns };
    // The cursor expired over the last attempt: the partial page set
    // stands the lenient read (the refresh's next event stands the next
    // load).
    if (attempt === REF_LOAD_ATTEMPTS - 1) return { rows, asOfSeq, columns };
  }
  return null;
}

/** The loaded ref-table data: the row ids in the row order + the row
 *  displays (rowId → the display text) + the option colors (rowId → the
 *  `color` column's hex — the absent value stands none). */
interface RefTableData {
  rowIds: string[];
  displays: Record<string, string>;
  colors: Record<string, string>;
}
/** The ref entry (the table + the column's declared display column —
 *  the row-link's `refDisplayColumn`; the absent stand is the bridge's
 *  default resolution). */
interface RefTableEntry {
  tableId: string;
  displayColumn?: string;
}
/** The ref-table data keyed by the entry's key (`refEntryKey`). */
type RefTableDataMap = Record<string, RefTableData>;

/** The entry's map key (the table + the declared display column — two
 *  columns over one table with different displays stand distinct
 *  entries). */
function refEntryKey(entry: RefTableEntry): string {
  return `${entry.tableId}\u0000${entry.displayColumn ?? ""}`;
}

/**
 * Loads the ref tables' data (the rows + the displays) and keeps it live
 * over the tables' own events. `entries` — the distinct ref entries (the
 * caller dedups — the serialized key stands the fetch + the
 * subscription set); the displays resolve over each entry's declared
 * display column (the row-link's `refDisplayColumn`).
 */
function useRefTables(bridge: DatabaseBridge, entries: RefTableEntry[]): RefTableDataMap {
  // The outer join stands a delimiter distinct from the entry key's own
  // (`refEntryKey` uses `\u0000`), so the split recovers each entry key
  // intact.
  const key = entries.map(refEntryKey).sort().join("\u0001");
  const [data, setData] = useState<RefTableDataMap>({});

  useEffect(() => {
    if (key === "") {
      setData({});
      return;
    }
    let live = true;
    const entryKeys = key.split("\u0001");
    const loaded = new Map<string, RefTableData>();
    const refreshEntry = async (entryKey: string): Promise<void> => {
      const [tableId, displayColumn] = entryKey.split("\u0000");
      try {
        // The full page set (the cursor's continuation to the tail — the
        // catalog stands complete) + the schema stand the entry's data;
        // the color stands the named `color` column's id.
        const pageSet = await loadFullPages(bridge, tableId!);
        if (pageSet === null) return;
        const rows = pageSet.rows;
        const rowIds = rows.map((row) => row.id);
        const rawDisplays = await bridge.resolveRowDisplay(tableId!, {
          rowIds,
          ...(displayColumn === "" || displayColumn === undefined ? {} : { displayColumn }),
        });
        const displays: Record<string, string> = {};
        for (const [rowId, display] of Object.entries(rawDisplays)) {
          if (display !== null) displays[rowId] = display;
        }
        const colorColumnId = pageSet.columns.find((column) => column.name === ENUM_OPTION_COLOR_COLUMN)?.id;
        const colors: Record<string, string> = {};
        for (const row of rows) {
          const color = colorColumnId !== undefined ? row.cells[colorColumnId] : undefined;
          if (typeof color === "string" && color !== "") colors[row.id] = color;
        }
        const value: RefTableData = { rowIds, displays, colors };
        loaded.set(entryKey, value);
        if (live) setData(Object.fromEntries(loaded));
      } catch {
        // The broken ref table (the unknown id / the transport error):
        // the empty stand (the lenient read — the cell keeps its raw
        // value display).
        loaded.set(entryKey, { rowIds: [], displays: {}, colors: {} });
        if (live) setData(Object.fromEntries(loaded));
      }
    };
    const refreshAll = async (): Promise<void> => {
      for (const entryKey of entryKeys) await refreshEntry(entryKey);
    };
    void refreshAll();
    // The live channel per entry: the snapshot's R stands the replay
    // cursor, any envelope stands the refresh, and a reset signal stands
    // the re-snapshot + the re-subscription.
    const handles: SubscriptionHandle[] = [];
    const open = async (entryKey: string): Promise<void> => {
      const tableId = entryKey.split("\u0000")[0]!;
      try {
        // The snapshot's `R` stands the replay cursor (the snapshot's
        // first page — the full page set's continuation stands no
        // subscription's cursor).
        const snapshot = await bridge.snapshotTable(tableId, { limit: REF_PAGE_SIZE });
        if (!live) return;
        let handle: SubscriptionHandle | null = null;
        handle = bridge.subscribeTable(
          tableId,
          { afterSeq: snapshot.page.asOfSeq },
          {
            ready: () => undefined,
            event: () => void refreshEntry(entryKey),
            status: () => undefined,
            error: () => undefined,
            reset: () => {
              if (!live) return;
              if (handle !== null) {
                handles.splice(handles.indexOf(handle), 1);
                handle.unsubscribe();
              }
              void open(entryKey);
            },
          }
        );
        handles.push(handle);
      } catch {
        // The broken table stands the empty data (the lenient read) —
        // the subscription stands none.
      }
    };
    for (const entryKey of entryKeys) void open(entryKey);
    return () => {
      live = false;
      for (const handle of handles) handle.unsubscribe();
    };
    // The key (the serialized entry set) stands the effect's identity.
  }, [bridge, key]);

  return data;
}

export { REF_PAGE_SIZE, loadFullPages, refEntryKey, useRefTables };
export type { RefTableData, RefTableDataMap, RefTableEntry };
