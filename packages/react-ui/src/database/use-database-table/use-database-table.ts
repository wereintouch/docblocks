/**
 * The external-form database data provider over the versioned contract:
 * the `useDatabaseTable` hook. The bootstrap stands the normative order
 * (the protocol negotiation, the `snapshotTable` over the `R`, the
 * `subscribeTable` over `afterSeq: R`) — the stream's chain is the loss
 * detector, the envelope stands the page refetch (the modules: the
 * snapshot + stream state over `use-table-stream`, the row writes over
 * `row-write-ops` / `row-batch-ops` / `row-structure-ops`, the schema
 * writes over `column-ops` + the wire spec's stand over `column-spec`,
 * the forward-only undo over `history`). Every row / column write goes
 * over the contract's surface with a FRESH `operationId` (the id is never
 * reused across logical operations). The lost response's reconciliation
 * (the write's fate query) is the consumer's stand over the bridge's
 * `getOperationStatus`; the UI's surface stands no status poll — its
 * convergence is the rebaseline (the next snapshot / the envelope stream).
 * The optimistic layer stands the local apply before the bridge call, the
 * rollback to the pre-operation snapshot + the refetch on a reject. The
 * stacks stand per (bridge, tableId); the doc-undo does not cover the
 * table rows.
 *
 * The cell's draft session's commit pins the open-time row revision over
 * `updateRow`'s `expectedRevision`: the mid-session's refetch re-baselines
 * the live revision map (the peer's commit), so the stale pin's CAS stands
 * the bridge's `conflict` rejection (the peer's value stands), not a
 * silent overwrite.
 */
import { useCallback, useRef, useState } from "react";

import type { DatabaseFilterPayload } from "docblocks-core";

import type {
  BridgeErrorCode,
  BridgeTableDescription,
  DatabaseBridge,
  ProtocolCapability,
  TableDescription,
  TableSnapshot,
} from "../bridge";
import { toBridgeError } from "../bridge";
import { createColumnOps } from "./column-ops";
import { PAGE_SIZE } from "./constants";
import { useTableHistory } from "./history";
import type { ColumnOpsContext, DatabaseTablePhase, DatabaseTableRow, RowOpsContext, UseDatabaseTable } from "./models";
import { createRowBatchOps } from "./row-batch-ops";
import { createRowStructureOps } from "./row-structure-ops";
import { createRowWriteOps } from "./row-write-ops";
import { applySnapshotState, createLoadMore, useTableStream } from "./use-table-stream";
import { errorCodeOf } from "./utils";

/**
 * The external-form data provider for one `tableId` (per block
 * instance: each block has its own row store and its own undo stack, even
 * when several blocks reference the same table). The `filter` stands the
 * block's view state (the block's `filter` attr's payload — the contract
 * filter's input shape).
 */
function useDatabaseTable(bridge: DatabaseBridge, tableId: string, filter?: DatabaseFilterPayload): UseDatabaseTable {
  const [phase, setPhase] = useState<DatabaseTablePhase>("loading");
  const [table, setTable] = useState<BridgeTableDescription | null>(null);
  const [rows, setRows] = useState<DatabaseTableRow[]>([]);
  const [pendingRow, setPendingRow] = useState<DatabaseTableRow | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<BridgeErrorCode | null>(null);
  const [capabilities, setCapabilities] = useState<readonly ProtocolCapability[]>([]);
  const [loadVersion, setLoadVersion] = useState(0);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const pendingRowRef = useRef(pendingRow);
  pendingRowRef.current = pendingRow;
  // The wire schema (the reference / number display the column ops'
  // patches and inverses read the current values from).
  const descriptionRef = useRef<TableDescription | null>(null);
  // The row revisions (the CAS's `expectedRevision` stand; the absent
  // revision stands the LWW default).
  const revisionsRef = useRef<Map<string, string>>(new Map());
  // The page's snapshot boundary (the `queryNextPage`'s `asOfSeq` + the
  // query fingerprint the continuation is bound to).
  const pageRef = useRef<{ asOfSeq: number; fingerprint: string }>({ asOfSeq: 0, fingerprint: "" });
  const capabilitiesRef = useRef<readonly ProtocolCapability[]>([]);
  capabilitiesRef.current = capabilities;
  // The load token: a snapshot read superseded by a newer one (the event
  // refetch, the retry, the identity change) drops its stale result
  // instead of standing it over the fresh state.
  const loadTokenRef = useRef(0);
  // The subscription's generation: a re-subscription (the rebaseline, the
  // identity change) invalidates the previous subscription's deliveries.
  const subGenRef = useRef(0);
  // The live identity: a write's late tail (the rollback / the post-commit
  // refetch) compares it against the identity its closure captured — a
  // relink makes the tail's state writes stale.
  const identityRef = useRef({ bridge, tableId });
  identityRef.current = { bridge, tableId };
  const sameIdentity = (): boolean => identityRef.current.bridge === bridge && identityRef.current.tableId === tableId;

  const filterKey = filter === undefined ? "" : JSON.stringify(filter);

  /** The operation's error message: the unknown rejection stands the
   *  transport-level stand (the safe recovery is the same-operationId's
   *  reconciliation, not the blind new operation) — the plain serialized
   *  `{ code, message }` shape (the wire-rehydrated error) stands the
   *  message, not the object's `String()` stand. */
  const messageOf = (operationError: unknown): string => toBridgeError(operationError).message;

  const noteError = (operationError: unknown) => {
    setError(messageOf(operationError));
    setErrorCode(errorCodeOf(operationError));
  };

  const clearError = () => {
    setError(null);
    setErrorCode(null);
  };

  const streamState = {
    pageRef,
    descriptionRef,
    revisionsRef,
    pendingRowRef,
    loadTokenRef,
    subGenRef,
    setTable,
    setRows,
    setPendingRow,
    setNextCursor,
    setCapabilities,
    setError,
    setErrorCode,
    setPhase,
  };

  useTableStream({ bridge, tableId, filter, filterKey, loadVersion, state: streamState, noteError });

  const refresh = useCallback(
    (onApplied?: (snapshot: TableSnapshot) => void) => {
      // A stale closure's refetch (the write tail of a table the block
      // no longer shows) stands no load: its token bump would supersede
      // the fresh identity's bootstrap and leave the phase loading.
      if (!sameIdentity()) return;
      void (async () => {
        const token = ++loadTokenRef.current;
        try {
          const snapshot = await bridge.snapshotTable(tableId, { filter, limit: PAGE_SIZE });
          if (token !== loadTokenRef.current || !sameIdentity()) return;
          applySnapshotState(streamState, snapshot);
          onApplied?.(snapshot);
        } catch {
          // A refetch failure keeps the current state (the same stand as the
          // subscription's refetch).
        }
      })();
    },
    // The filter by its serialized key (the store re-renders with a fresh
    // object reference only when the block's JSON changed).
    [bridge, tableId, filterKey]
  );

  // The row's live revision (the CAS's stand — the draft session's open
  // pin reads it at the session's open; the mid-session's refetch
  // re-baselines the map over the peer's commit).
  const revisionOf = (rowId: string) => revisionsRef.current.get(rowId);
  // The CAS stand: the `cas` capability (negotiated over the bootstrap's
  // describeProtocol) selects the compare-and-swap, the absent one (a
  // bridge that does not stand the capability) stands the LWW default —
  // an expectedRevision over a non-CAS bridge is not a stand (the
  // contract's optional-capability negotiation). The known revision
  // selects the swap, the absent one stands the LWW default (the spread
  // keeps the op's literal shape intact).
  const casOf = (rowId: string): { expectedRevision?: string } => {
    if (!capabilitiesRef.current.includes("cas")) return {};
    const revision = revisionOf(rowId);
    return revision === undefined ? {} : { expectedRevision: revision };
  };

  const history = useTableHistory({
    bridge,
    tableId,
    noteError,
    clearError,
    refresh: () => refresh(),
    clearPendingRow: () => setPendingRow(null),
  });

  const rowCtx: RowOpsContext = {
    bridge,
    tableId,
    rowsRef,
    pendingRowRef,
    revisionsRef,
    capabilitiesRef,
    setRows,
    setPendingRow,
    pushUndo: history.pushUndo,
    refresh,
    noteError,
    casOf,
    sameIdentity,
  };
  const rowWrite = createRowWriteOps(rowCtx);
  const rowBatch = createRowBatchOps(rowCtx);
  const rowStructure = createRowStructureOps(rowCtx);

  const columnCtx: ColumnOpsContext = {
    bridge,
    tableId,
    descriptionRef,
    capabilitiesRef,
    pushUndo: history.pushUndo,
    noteError,
    sameIdentity,
  };
  const column = createColumnOps(columnCtx);

  const loadMore = createLoadMore({
    bridge,
    tableId,
    nextCursor,
    loadTokenRef,
    pageRef,
    revisionsRef,
    setRows,
    setNextCursor,
    noteError,
    refresh: () => refresh(),
  });

  const retry = useCallback(() => setLoadVersion((version) => version + 1), []);
  const dismissPendingRow = useCallback((rowId?: string) => {
    setPendingRow((current) => {
      if (current === null || (rowId !== undefined && current.rowId !== rowId)) return current;
      return null;
    });
  }, []);

  return {
    phase,
    table,
    rows,
    pendingRow,
    dismissPendingRow,
    revisionOf,
    nextCursor,
    error,
    insertRow: rowWrite.insertRow,
    updateRow: rowWrite.updateRow,
    updateRows: rowBatch.updateRows,
    pasteRows: rowBatch.pasteRows,
    removeRow: rowStructure.removeRow,
    moveRow: rowStructure.moveRow,
    addColumn: column.addColumn,
    updateColumn: column.updateColumn,
    deleteColumn: column.deleteColumn,
    renameColumn: column.renameColumn,
    renameTable: column.renameTable,
    loadMore,
    retry,
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    errorCode,
    capabilities,
  };
}

export { useDatabaseTable };
