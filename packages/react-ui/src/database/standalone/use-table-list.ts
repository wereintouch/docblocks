import { useCallback, useEffect, useRef, useState } from "react";

import { toBridgeError } from "../bridge";
import type { BridgeError, DatabaseBridge, TableRef } from "../bridge";
import { newMutationContext } from "../use-database-table";
import type { UseTableList } from "./models";

/**
 * The table catalog's hook (the standalone's stand): the consumer's
 * `DatabaseBridge`'s catalog read (`listTables` — the system tables stand
 * absent) + the `createTable` / `renameTable` mutations (the fresh's
 * `operationId` per op over `newMutationContext`). The catalog's truth
 * stands in the bridge — the hook's state is the read projection,
 * re-read over the own's successful mutations (the auto's stand) + the
 * manual's `refresh` (the contract's catalog stands no push — the
 * per-table's events stand over the `useDatabaseTable`'s subscription).
 * The create / rename's failures stand their promises' rejects (the
 * `BridgeError` stand) — the `error` state is the catalog read's own.
 */
function useTableList(bridge: DatabaseBridge): UseTableList {
  const [tables, setTables] = useState<TableRef[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<BridgeError | null>(null);
  // The bridge stand over a ref (the consumer's instance may re-render).
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  // The stale read's guard (the in-flight's supersede stands dropped).
  const readSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++readSeq.current;
    setLoading(true);
    try {
      const list = await bridgeRef.current.listTables();
      if (seq !== readSeq.current) return;
      setTables(list);
      setError(null);
    } catch (error) {
      if (seq !== readSeq.current) return;
      setTables(null);
      setError(toBridgeError(error));
    } finally {
      if (seq === readSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (name: string) => {
      const receipt = await bridgeRef.current.createTable({ name }, newMutationContext());
      await refresh();
      return receipt.result;
    },
    [refresh]
  );

  const rename = useCallback(
    async (tableId: string, name: string) => {
      await bridgeRef.current.renameTable(tableId, { name }, newMutationContext());
      await refresh();
    },
    [refresh]
  );

  return { tables, loading, error, refresh, create, rename };
}

export { useTableList };
