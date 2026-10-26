/**
 * The ref-table data provider for the grid: one page of the ref table's
 * rows + the row displays (`resolveRowDisplay` — the join stands in the
 * consumer backend) + the option colors (the ref table's `color` column —
 * the enum's option's chip color; the absent column / value stands none).
 * The enum columns read the option labels from it (the option's row id
 * stands the value, the display stands the label — the dict's legacy
 * PK-as-label stand stands the display too), the row-link columns read
 * the display text over the row ids (the column's declared
 * `refDisplayColumn`, else the bridge's default resolution). The data
 * refreshes on the ref table's live events (the dict's extension stands in
 * the cell's editor live, the linked row's rename stands the display
 * live). A broken ref table (the unknown id) stands the empty data (the
 * lenient read).
 */
import { useEffect, useState } from "react";

import { ENUM_OPTION_COLOR_COLUMN } from "../bridge";
import type { DatabaseBridge, TableRef } from "../bridge";

/** The page size the ref table loads (the dict options / the picker's
 *  rows — one page, no cursor continuation). */
const REF_PAGE_SIZE = 200;

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
    const refresh = async () => {
      const loaded = await Promise.all(
        entryKeys.map(async (entryKey) => {
          const [tableId, displayColumn] = entryKey.split("\u0000");
          try {
            const page = await bridge.queryRows(tableId!, { limit: REF_PAGE_SIZE });
            const rowIds = Object.keys(page.rows);
            const displays = await bridge.resolveRowDisplay(
              tableId!,
              rowIds,
              displayColumn === "" || displayColumn === undefined ? undefined : displayColumn
            );
            const colors: Record<string, string> = {};
            for (const rowId of rowIds) {
              const color = page.rows[rowId]?.[ENUM_OPTION_COLOR_COLUMN];
              if (typeof color === "string" && color !== "") colors[rowId] = color;
            }
            return [entryKey, { rowIds, displays, colors }] as const;
          } catch {
            // The broken ref table (the unknown id / the transport
            // error): the empty stand (the lenient read — the cell keeps
            // its raw value display).
            return [entryKey, { rowIds: [], displays: {}, colors: {} }] as const;
          }
        })
      );
      if (live) setData(Object.fromEntries(loaded));
    };
    void refresh();
    const unsubs = entryKeys.map((entryKey) =>
      bridge.subscribeTable(entryKey.split("\u0000")[0]!, () => void refresh())
    );
    return () => {
      live = false;
      for (const unsubscribe of unsubs) unsubscribe();
    };
    // The key (the serialized entry set) stands the effect's identity.
  }, [bridge, key]);

  return data;
}

/**
 * Loads the table catalog (the ref form's pick list — the form's
 * new-table creation stands the fresh catalog over the refresh bump).
 */
function useBridgeTables(bridge: DatabaseBridge, refreshKey: number): TableRef[] {
  const [tables, setTables] = useState<TableRef[]>([]);
  useEffect(() => {
    let live = true;
    void bridge.listTables().then((list) => {
      if (live) setTables([...list].sort((a, b) => a.name.localeCompare(b.name)));
    });
    return () => {
      live = false;
    };
  }, [bridge, refreshKey]);
  return tables;
}

export { REF_PAGE_SIZE, refEntryKey, useRefTables, useBridgeTables };
export type { RefTableData, RefTableDataMap, RefTableEntry };
