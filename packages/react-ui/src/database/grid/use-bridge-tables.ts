/** The database grid's bridge-tables hook: loads the table catalog (the ref
 *  form's pick list — the new-table creation stands the fresh catalog over
 *  the refresh bump). */
import { useEffect, useState } from "react";

import type { DatabaseBridge, TableRef } from "../bridge";

function useBridgeTables(bridge: DatabaseBridge, refreshKey: number): TableRef[] {
  const [tables, setTables] = useState<TableRef[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const list = await bridge.listTables();
        if (live) setTables([...list].sort((a, b) => a.name.localeCompare(b.name)));
      } catch (listError) {
        // The bridge's listTables rejection (the consumer's transient
        // failure): the pick list stays empty (the picker keeps the
        // "new table" entry), the failure stands the console — the
        // unhandled rejection is not a stand.
        if (live) console.error("docblocks: the bridge's table catalog failed to load", listError);
      }
    })();
    return () => {
      live = false;
    };
  }, [bridge, refreshKey]);
  return tables;
}

export { useBridgeTables };
