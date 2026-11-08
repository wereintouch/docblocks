/**
 * The external-form database data provider over the versioned contract: the
 * `useDatabaseTable` hook. The bootstrap stands the normative order —
 * the protocol negotiation (the version / baseline-capability mismatch
 * stands the `protocol_mismatch`), the `snapshotTable` (the sole initial
 * read; its `page.asOfSeq` is the `R`), then `subscribeTable` with
 * `afterSeq: R` (the replay stands the events after `R`, the live stands
 * the new ones). A `commit` and an `invalidate` envelope both stand the
 * page REFETCH — the fresh snapshot over the fresh `R` (the in-place cache
 * refill is not a stand); the live subscription stays alive over the
 * refetch. The stream's chain is the loss detector: a duplicate /
 * out-of-order / gapped `seq` (the `prevSeq`'s mismatch) stands the full
 * rebaseline — the fresh snapshot + the re-subscription over the fresh
 * `R`.
 *
 * Every row / column write goes over the contract's surface (the `batchRows`'s
 * atomic ops for the rows, the direct calls for the schema), each with a
 * FRESH `operationId` (the write's context) — the id is never reused across
 * logical operations. The lost response's reconciliation (the write's fate
 * query) is the consumer's stand over the bridge's `getOperationStatus`;
 * the UI's surface stands no status poll — its convergence is the
 * rebaseline (the next snapshot / the envelope stream). The per-block undo
 * stack stands the
 * forward-only inverse operations (the update's inverse
 * covers the edited keys only; the remove's inverse is the `undeleteRows`
 * when the `rowRestore` capability stands, else the removal is not
 * undoable and never enters the stack; the column delete's inverse is the
 * `restoreDeletedColumn` when the `columnRestore` capability stands) —
 * and a FAILED inverse / forward leaves its entry on the stack (the retry
 * stand). The optimistic layer stands the local apply before the bridge
 * call, the rollback to the pre-operation snapshot + the refetch on a
 * reject. The stacks stand per (bridge,
 * tableId); the doc-undo does not cover the table rows.
 *
 * The cell's draft session's commit pins the open-time row revision over
 * `updateRow`'s `expectedRevision`: the mid-session's refetch re-baselines
 * the live revision map (the peer's commit), so the stale pin's CAS stands
 * the bridge's `conflict` rejection (the peer's value stands), not a
 * silent overwrite.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { DatabaseFilterPayload } from "docblocks-core";

import type { BridgeColumn, BridgeTableDescription } from "../bridge";
import { BridgeError, isBridgeError } from "../bridge";
import type {
  BatchOp,
  BridgeErrorCode,
  Column,
  DatabaseBridge,
  ProtocolCapability,
  SubscriptionHandle,
  TableDescription,
  TableSnapshot,
} from "../bridge";
import { validateProtocolDescriptor } from "../bridge";
import { PAGE_SIZE } from "./constants";
import type { DatabaseTablePhase, DatabaseTableRow, InverseOp, UseDatabaseTable } from "./models";
import { cellValueEqual, descriptionToGrid, errorCodeOf, isFatalTableError, newMutationContext } from "./utils";

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
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<BridgeErrorCode | null>(null);
  const [capabilities, setCapabilities] = useState<readonly ProtocolCapability[]>([]);
  const [loadVersion, setLoadVersion] = useState(0);
  const [, setStackVersion] = useState(0); // a re-render trigger for canUndo / canRedo

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
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
  const undoStackRef = useRef<InverseOp[]>([]);
  const redoStackRef = useRef<InverseOp[]>([]);
  // The history's mutation channel: a single in-flight guard (an undo / a
  // redo over the same entry in flight stands no second inverse / forward —
  // the re-entrant call is dropped, not queued).
  const historyInFlightRef = useRef(false);
  // The history's identity: the undo/redo stacks stand PER (bridge,
  // tableId) — a relink of the block to another table / bridge drops the
  // previous one's history in the render (the per-(bridge, tableId) stack stand).
  const historyRef = useRef<{ bridge: DatabaseBridge; tableId: string }>({ bridge, tableId });
  if (historyRef.current.bridge !== bridge || historyRef.current.tableId !== tableId) {
    historyRef.current = { bridge, tableId };
    undoStackRef.current = [];
    redoStackRef.current = [];
  }
  const filterKey = filter === undefined ? "" : JSON.stringify(filter);

  const messageOf = (operationError: unknown): string =>
    operationError instanceof Error ? operationError.message : String(operationError);

  const noteError = (operationError: unknown) => {
    setError(messageOf(operationError));
    setErrorCode(errorCodeOf(operationError));
  };

  /** The snapshot state's apply. `clearError` = the full-load stand (the
   *  bootstrap / the retry): the operation's error stands the last-op
   *  stand and survives the event's refetch + the post-op refresh (the
   *  structured code is the UI's gate — the flash-then-clear is not a
   *  stand). */
  const applySnapshot = (snapshot: TableSnapshot, clearError = false) => {
    pageRef.current = { asOfSeq: snapshot.page.asOfSeq, fingerprint: snapshot.page.queryFingerprint };
    descriptionRef.current = {
      table: { ...snapshot.table },
      columns: snapshot.columns.map((column) => ({ ...column })),
      schemaRevision: snapshot.schemaRevision,
    };
    revisionsRef.current = new Map(snapshot.page.rows.map((row) => [row.id, row.revision]));
    setTable(descriptionToGrid(snapshot));
    setRows(snapshot.page.rows.map((row) => ({ rowId: row.id, cells: { ...row.cells } })));
    setNextCursor(snapshot.page.nextCursor);
    if (clearError) {
      setError(null);
      setErrorCode(null);
    }
    setPhase("ready");
  };

  // The bootstrap: the protocol negotiation, the snapshot (the `R`), then
  // the live subscription over `afterSeq: R`. A gapped / out-of-order
  // chain stands the full rebaseline (the fresh snapshot + the
  // re-subscription over the fresh `R`).
  useEffect(() => {
    let disposed = false;
    let handle: SubscriptionHandle | null = null;
    let lastSeenSeq: number | null = null;
    const seenSeqs = new Set<number>();

    // The table's death stand (the fatal code over the read / the
    // stream): the sensitive cache stands cleared (the stale rows / the
    // cursor / the revisions of the dead table are not a stand), the
    // delivery stands stopped (the subscription's unsubscribe), the
    // phase stands broken (the grid's error surface over the dead table).
    const die = (operationError: unknown): void => {
      setRows([]);
      setNextCursor(null);
      revisionsRef.current = new Map();
      if (handle !== null) handle.unsubscribe();
      setPhase("broken");
      noteError(operationError);
    };

    const refetch = async (): Promise<void> => {
      // The event's page refetch: the fresh snapshot (the schema + the
      // page over the fresh `R`) — the live subscription is NOT
      // re-opened over it.
      const token = ++loadTokenRef.current;
      try {
        const snapshot = await bridge.snapshotTable(tableId, { filter, limit: PAGE_SIZE });
        if (disposed || token !== loadTokenRef.current) return;
        applySnapshot(snapshot);
      } catch (refetchError) {
        // The fatal code stands the death (the table gone over the
        // refetch — the token's stand: a superseded load's failure does
        // not kill the fresh one). The rest keeps the current state (the
        // subscription stands; the next event stands the next refetch).
        if (!disposed && token === loadTokenRef.current && isFatalTableError(refetchError)) {
          die(refetchError);
        }
      }
    };

    const bootstrap = async (): Promise<void> => {
      const myGen = ++subGenRef.current; // the previous subscription's deliveries stand stale
      const token = ++loadTokenRef.current;
      handle?.unsubscribe();
      if (!disposed) setPhase("loading");
      try {
        const descriptor = await bridge.describeProtocol();
        if (disposed || token !== loadTokenRef.current) return;
        // The version / the baseline-capability mismatch stands the
        // `protocol_mismatch` — the silent downgrade is not a stand.
        validateProtocolDescriptor(descriptor);
        setCapabilities(descriptor.capabilities);
        const snapshot = await bridge.snapshotTable(tableId, { filter, limit: PAGE_SIZE });
        if (disposed || token !== loadTokenRef.current) return;
        // The chain's first link: the snapshot's `R` — the first replayed
        // envelope must chain to it (the loss's detection by the chain,
        // not by the seq arithmetic; the null prevSeq stands the table's
        // first envelope over the empty head).
        lastSeenSeq = snapshot.page.asOfSeq;
        seenSeqs.clear();
        applySnapshot(snapshot, true);
        // The subscription opens only AFTER the snapshot resolves (the
        // bootstrap's stand).
        handle = bridge.subscribeTable(
          tableId,
          { afterSeq: snapshot.page.asOfSeq },
          {
            ready: () => undefined,
            event: (envelope) => {
              if (disposed || myGen !== subGenRef.current) return;
              if (seenSeqs.has(envelope.seq)) return; // the at-least-once dedup
              const last = lastSeenSeq; // the snapshot's `R` over the first frame
              if (last === null) return; // the subscription stands before the snapshot (unreachable)
              // The stale duplicate (the seq at or below the head, absent
              // from the dedup set — the set is cleared over the
              // rebaseline, the at-least-once redelivery stands over the
              // resubscribe): the drop (the snapshot's `R` stands the state
              // up to the head) — the rebaseline stand is reserved for the
              // gap (the envelope chaining past the head with a prevSeq
              // before it), and the stale redelivery must not loop the
              // bootstrap.
              if (envelope.seq <= last) return;
              const chains = envelope.prevSeq === last || (last === 0 && envelope.prevSeq === null);
              if (!chains) {
                // The chain broke (a loss, an out-of-order frame): the full
                // rebaseline over the fresh `R`.
                seenSeqs.clear();
                void bootstrap();
                return;
              }
              lastSeenSeq = envelope.seq;
              seenSeqs.add(envelope.seq);
              // The `commit` and the `invalidate` both stand the page
              // refetch (the rebaseline is NOT an in-place refill); the
              // subscription stays alive over it.
              void refetch();
            },
            status: () => undefined,
            error: (operationError) => {
              if (disposed || myGen !== subGenRef.current) return;
              // The fatal code over the stream stands the death (the
              // table gone / the permission lost — the delivery stops);
              // the rest stands the transient display.
              if (isFatalTableError(operationError)) {
                die(operationError);
                return;
              }
              noteError(operationError);
            },
            reset: () => {
              // The forced rebaseline signal (the replay expired, the
              // permission lost, the gap detected): the fresh snapshot +
              // the re-subscription over the fresh `R`.
              if (disposed || myGen !== subGenRef.current) return;
              void bootstrap();
            },
          }
        );
      } catch (bootstrapError) {
        if (disposed || token !== loadTokenRef.current) return;
        // The fatal code stands the death: the sensitive cache stands
        // cleared over it (the stale rows of the previous table over the
        // relink, the lost-permission rebaseline) — not just the broken
        // phase.
        if (isFatalTableError(bootstrapError)) {
          die(bootstrapError);
          return;
        }
        setPhase("broken");
        noteError(bootstrapError);
      }
    };

    void bootstrap();
    return () => {
      disposed = true;
      loadTokenRef.current++;
      if (handle !== null) handle.unsubscribe();
    };
    // The filter by its serialized key (the store re-renders with a fresh
    // object reference only when the block's JSON changed).
  }, [bridge, tableId, filterKey, loadVersion]);

  const bump = useCallback(() => setStackVersion((version) => version + 1), []);
  const pushUndo = useCallback(
    (op: InverseOp, opBridge: DatabaseBridge, opTableId: string) => {
      if (historyRef.current.bridge !== opBridge || historyRef.current.tableId !== opTableId) return;
      undoStackRef.current.push(op);
      redoStackRef.current = []; // a new operation clears the redo side (forward-only)
      bump();
    },
    [bump]
  );

  const refresh = useCallback(() => {
    void (async () => {
      const token = ++loadTokenRef.current;
      try {
        const snapshot = await bridge.snapshotTable(tableId, { filter, limit: PAGE_SIZE });
        if (token !== loadTokenRef.current) return;
        applySnapshot(snapshot);
      } catch {
        // A refetch failure keeps the current state (the same stand as the
        // subscription's refetch).
      }
    })();
  }, [bridge, tableId, filterKey]);

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

  const insertRow = useCallback(
    async (cells: Record<string, unknown> = {}) => {
      // The row id is bridge-assigned (the `c-` / `r-` allocation), so the
      // insert waits for the receipt (no optimistic row id to reconcile).
      // The identity cell (the `let` the inverse reads) stands the row the
      // inverse addresses: the redo re-creates with a FRESH id (a fresh
      // logical operation), so every inverse stands the row the last
      // forward actually created.
      let liveRowId: string;
      try {
        const receipt = await bridge.batchRows(
          tableId,
          { ops: [{ op: "create", row: cells, beforeRowId: null }] },
          newMutationContext()
        );
        const created = receipt.result.rows[0];
        if (created === undefined) {
          throw new BridgeError("unavailable", "The insert's receipt carries no created row.");
        }
        liveRowId = created.id;
        for (const [id, revision] of Object.entries(receipt.revisions)) revisionsRef.current.set(id, revision);
      } catch (operationError) {
        noteError(operationError);
        throw new Error(messageOf(operationError), { cause: operationError });
      }
      pushUndo(
        {
          label: `insert row ${liveRowId}`,
          forward: async () => {
            const receipt = await bridge.batchRows(
              tableId,
              { ops: [{ op: "create", row: cells, beforeRowId: null }] },
              newMutationContext()
            );
            const created = receipt.result.rows[0];
            if (created !== undefined) liveRowId = created.id;
          },
          inverse: async () => {
            await bridge.batchRows(tableId, { ops: [{ op: "delete", rowId: liveRowId }] }, newMutationContext());
          },
        },
        bridge,
        tableId
      );
      refresh();
      return liveRowId;
    },
    [bridge, tableId, pushUndo, refresh]
  );

  const updateRow = useCallback(
    async (rowId: string, cells: Record<string, unknown>, expectedRevision?: string) => {
      const snapshot = rowsRef.current.map((row) => ({ rowId: row.rowId, cells: { ...row.cells } }));
      const current = rowsRef.current.find((row) => row.rowId === rowId);
      const cleaned: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(cells)) if (value !== undefined) cleaned[key] = value;
      // The unchanged patch stands no write (no bridge call, no refetch,
      // no no-op undo entry): the guard stands before the optimistic apply
      // (an unknown row — filtered out — commits as usual).
      if (
        current !== undefined &&
        Object.entries(cleaned).every(([key, value]) => cellValueEqual(current.cells[key], value))
      ) {
        return;
      }
      setRows((rows) =>
        rows.map((row) => (row.rowId === rowId ? { ...row, cells: { ...row.cells, ...cleaned } } : row))
      );
      try {
        const receipt = await bridge.batchRows(
          tableId,
          // The pinned revision (the draft session's open stand) stands
          // the CAS over it; the absent pin stands the live revision.
          {
            ops: [
              {
                op: "update",
                rowId,
                cells: cleaned,
                ...(expectedRevision !== undefined ? { expectedRevision } : casOf(rowId)),
              },
            ],
          },
          newMutationContext()
        );
        for (const [id, revision] of Object.entries(receipt.revisions)) revisionsRef.current.set(id, revision);
        if (current !== undefined) {
          const oldCells = { ...current.cells };
          pushUndo(
            {
              label: `update row ${rowId}`,
              forward: async () => {
                await bridge.batchRows(
                  tableId,
                  { ops: [{ op: "update", rowId, cells: cleaned }] },
                  newMutationContext()
                );
              },
              inverse: async () => {
                // The inverse patch covers the EDITED KEYS ONLY (the full
                // old row would clobber a remote edit of another cell
                // landed after the operation): the pre-operation value of
                // each edited key, the absent-before key over the explicit
                // null (the merge's removal stand). The same-cell conflict
                // policy: the undo stands the newest write.
                const restore: Record<string, unknown> = {};
                for (const key of Object.keys(cleaned)) {
                  restore[key] = oldCells[key] === undefined ? null : oldCells[key];
                }
                await bridge.batchRows(
                  tableId,
                  { ops: [{ op: "update", rowId, cells: restore }] },
                  newMutationContext()
                );
              },
            },
            bridge,
            tableId
          );
        }
        refresh();
      } catch (operationError) {
        setRows(snapshot);
        noteError(operationError);
        refresh();
        throw new Error(messageOf(operationError), { cause: operationError });
      }
    },
    [bridge, tableId, pushUndo, refresh]
  );

  const updateRows = useCallback(
    async (updates: Array<{ rowId: string; cells: Record<string, unknown> }>) => {
      if (updates.length === 0) return;
      const snapshot = rowsRef.current.map((row) => ({ rowId: row.rowId, cells: { ...row.cells } }));
      // The pre-operation cells of the touched rows (the inverse's
      // restore).
      const before = new Map(rowsRef.current.map((row) => [row.rowId, row.cells]));
      const cleaned = updates.map(({ rowId, cells }) => {
        const patch: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(cells)) if (value !== undefined) patch[key] = value;
        return { rowId, cells: patch };
      });
      // The all-unchanged batch stands no write (the clear over an
      // already-empty region): the same equality guard as the single-row
      // path, over every touched cell.
      if (
        cleaned.every(({ rowId, cells }) => {
          const row = rowsRef.current.find((entry) => entry.rowId === rowId);
          return (
            row !== undefined && Object.entries(cells).every(([key, value]) => cellValueEqual(row.cells[key], value))
          );
        })
      ) {
        return;
      }
      const byId = new Map(cleaned.map((entry) => [entry.rowId, entry.cells]));
      setRows((rows) =>
        rows.map((row) => {
          const patch = byId.get(row.rowId);
          return patch === undefined ? row : { ...row, cells: { ...row.cells, ...patch } };
        })
      );
      try {
        const receipt = await bridge.batchRows(
          tableId,
          {
            ops: cleaned.map(({ rowId, cells }) => ({ op: "update", rowId, cells, ...casOf(rowId) })),
          },
          newMutationContext()
        );
        for (const [id, revision] of Object.entries(receipt.revisions)) revisionsRef.current.set(id, revision);
        const restore = cleaned.flatMap(({ rowId, cells }) => {
          const oldCells = before.get(rowId);
          if (oldCells === undefined) return [];
          const patch: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(cells)) {
            // The absent-before key stands the explicit null (the merge's
            // removal stand — the `undefined` would be skipped by the
            // bridge's cells' write).
            patch[key] = oldCells[key] === undefined && value !== undefined ? null : oldCells[key];
          }
          if (Object.keys(patch).length === 0) return [];
          return [{ rowId, cells: patch }];
        });
        pushUndo(
          {
            label: `update rows ${updates.map((entry) => entry.rowId).join(", ")}`,
            // The one entry for the whole batch: the inverse restores every
            // touched row over the single undo, the forward stands the
            // batch again over the single redo.
            forward: async () => {
              await bridge.batchRows(
                tableId,
                { ops: cleaned.map(({ rowId, cells }) => ({ op: "update", rowId, cells })) },
                newMutationContext()
              );
            },
            inverse: async () => {
              if (restore.length === 0) return;
              await bridge.batchRows(
                tableId,
                { ops: restore.map(({ rowId, cells }) => ({ op: "update", rowId, cells })) },
                newMutationContext()
              );
            },
          },
          bridge,
          tableId
        );
        refresh();
      } catch (operationError) {
        setRows(snapshot);
        noteError(operationError);
        refresh();
        throw new Error(messageOf(operationError), { cause: operationError });
      }
    },
    [bridge, tableId, pushUndo, refresh]
  );

  const removeRow = useCallback(
    async (rowId: string) => {
      const snapshot = rowsRef.current;
      const row = snapshot.find((entry) => entry.rowId === rowId);
      setRows((rows) => rows.filter((entry) => entry.rowId !== rowId));
      try {
        await bridge.batchRows(tableId, { ops: [{ op: "delete", rowId, ...casOf(rowId) }] }, newMutationContext());
        // Without the `rowRestore` capability the removal is NOT undoable:
        // it never enters the stack (a destructing removal stands no data to restore).
        if (row !== undefined && capabilitiesRef.current.includes("rowRestore")) {
          pushUndo(
            {
              label: `remove row ${rowId}`,
              forward: async () => {
                await bridge.batchRows(tableId, { ops: [{ op: "delete", rowId }] }, newMutationContext());
              },
              inverse: async () => {
                await bridge.undeleteRows(tableId, { rowIds: [rowId] }, newMutationContext());
              },
            },
            bridge,
            tableId
          );
        }
        refresh();
      } catch (operationError) {
        setRows(snapshot);
        noteError(operationError);
        refresh();
        throw new Error(messageOf(operationError), { cause: operationError });
      }
    },
    [bridge, tableId, pushUndo, refresh]
  );

  const moveRow = useCallback(
    async (rowId: string, beforeRowId: string | null) => {
      const snapshot = rowsRef.current.map((row) => ({ rowId: row.rowId, cells: { ...row.cells } }));
      const original = rowsRef.current;
      const from = original.findIndex((row) => row.rowId === rowId);
      if (from === -1) return;
      // The original seat's successors: the rows that stood AFTER the
      // moved row in the pre-move order (the inverse's anchor stand).
      const successors = original.slice(from + 1).map((row) => row.rowId);
      const ordered = [...original];
      const moved = ordered.splice(from, 1)[0]!;
      const at = beforeRowId === null ? -1 : ordered.findIndex((row) => row.rowId === beforeRowId);
      ordered.splice(beforeRowId === null || at === -1 ? ordered.length : at, 0, moved);
      setRows(ordered);
      try {
        await bridge.batchRows(
          tableId,
          { ops: [{ op: "move", rowId, beforeRowId, ...casOf(rowId) }] },
          newMutationContext()
        );
        pushUndo(
          {
            label: `move row ${rowId}`,
            forward: async () => {
              await bridge.batchRows(tableId, { ops: [{ op: "move", rowId, beforeRowId }] }, newMutationContext());
            },
            inverse: async () => {
              // The inverse stands the ORIGINAL SEAT: the move's anchor
              // inserts the row BEFORE the given row (null = the tail), so
              // the anchor is the row's pre-move SUCCESSOR, not its
              // predecessor. The anchor stands resolved at the undo's time
              // over the refetched state: a successor a peer removed in the
              // meantime slides to the next survivor (null = the tail when
              // none survive).
              const current = rowsRef.current;
              const seat = successors.find((id) => current.some((row) => row.rowId === id)) ?? null;
              await bridge.batchRows(
                tableId,
                { ops: [{ op: "move", rowId, beforeRowId: seat }] },
                newMutationContext()
              );
            },
          },
          bridge,
          tableId
        );
        refresh();
      } catch (operationError) {
        setRows(snapshot);
        noteError(operationError);
        refresh();
        throw new Error(messageOf(operationError), { cause: operationError });
      }
    },
    [bridge, tableId, pushUndo, refresh]
  );

  /** The mixed paste: the visible rows' updates (from the active row down)
   *  + the overflow's creates — ONE `batchRows` (one transaction, one undo
   *  entry). The updates stand the optimistic apply (the instant cells);
   *  the creates stand no optimistic pre-apply (the id is bridge-assigned
   *  — the rows stand over the post-commit refresh). Returns the created
   *  rows' ids. */
  const pasteRows = useCallback(
    async (input: {
      updates: Array<{ rowId: string; cells: Record<string, unknown> }>;
      creates: Array<Record<string, unknown>>;
      /** The created rows' seat: the visible successor of the last
       *  updated row (null = the table's tail). */
      beforeRowId: string | null;
    }): Promise<string[]> => {
      const { updates, creates, beforeRowId } = input;
      if (updates.length === 0 && creates.length === 0) return [];
      const snapshot = rowsRef.current.map((row) => ({ rowId: row.rowId, cells: { ...row.cells } }));
      // The pre-operation cells of the updated rows (the inverse's
      // restore).
      const before = new Map(rowsRef.current.map((row) => [row.rowId, row.cells]));
      const cleaned = updates.map(({ rowId, cells }) => {
        const patch: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(cells)) if (value !== undefined) patch[key] = value;
        return { rowId, cells: patch };
      });
      // The all-unchanged updates + no creates stands no write (the empty
      // clipboard's no-op — the same equality guard as the batch update's).
      const updatesChanged = cleaned.some(({ rowId, cells }) => {
        const row = rowsRef.current.find((entry) => entry.rowId === rowId);
        return (
          row === undefined || !Object.entries(cells).every(([key, value]) => cellValueEqual(row.cells[key], value))
        );
      });
      if (!updatesChanged && creates.length === 0) return [];
      if (updatesChanged) {
        const byId = new Map(cleaned.map((entry) => [entry.rowId, entry.cells]));
        setRows((rows) =>
          rows.map((row) => {
            const patch = byId.get(row.rowId);
            return patch === undefined ? row : { ...row, cells: { ...row.cells, ...patch } };
          })
        );
      }
      // The created rows' identity (the inverse's delete + the redo's
      // fresh-id re-create stand the rows the last commit actually
      // created).
      let liveRowIds: string[] = [];
      try {
        const ops: BatchOp[] = [
          ...cleaned.map(({ rowId, cells }) => ({ op: "update" as const, rowId, cells, ...casOf(rowId) })),
          ...creates.map((row) => ({ op: "create" as const, row, beforeRowId })),
        ];
        const receipt = await bridge.batchRows(tableId, { ops }, newMutationContext());
        // The receipt's `rows` stand the created rows over the create
        // op's order (the contract's stand) — the created rows are the
        // ones NOT in the update set (the create's id is fresh; the
        // updated rows keep theirs — the filter stands the guard over
        // a bridge that would stand the wider set).
        const updatedIds = new Set(cleaned.map((entry) => entry.rowId));
        liveRowIds = receipt.result.rows.filter((row) => !updatedIds.has(row.id)).map((row) => row.id);
        for (const [id, revision] of Object.entries(receipt.revisions)) revisionsRef.current.set(id, revision);
        const restore = cleaned.flatMap(({ rowId, cells }) => {
          const oldCells = before.get(rowId);
          if (oldCells === undefined) return [];
          const patch: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(cells)) {
            // The absent-before key stands the explicit null (the merge's
            // removal stand — the `undefined` would be skipped by the
            // bridge's cells' write).
            patch[key] = oldCells[key] === undefined && value !== undefined ? null : oldCells[key];
          }
          if (Object.keys(patch).length === 0) return [];
          return [{ rowId, cells: patch }];
        });
        pushUndo(
          {
            label: `paste (${cleaned.length} updates + ${creates.length} creates)`,
            forward: async () => {
              const redoReceipt = await bridge.batchRows(
                tableId,
                {
                  ops: [
                    ...cleaned.map(({ rowId, cells }) => ({ op: "update" as const, rowId, cells })),
                    ...creates.map((row) => ({ op: "create" as const, row, beforeRowId })),
                  ],
                },
                newMutationContext()
              );
              liveRowIds = redoReceipt.result.rows.filter((row) => !updatedIds.has(row.id)).map((row) => row.id);
            },
            inverse: async () => {
              // The inverse: the created rows' deletion + the updates'
              // restore (the edited keys' pre-operation values) — one
              // batch (the paste's one-op undo stand).
              const ops: BatchOp[] = [];
              if (creates.length > 0) ops.push(...liveRowIds.map((rowId) => ({ op: "delete", rowId }) as const));
              if (restore.length > 0) {
                ops.push(...restore.map(({ rowId, cells }) => ({ op: "update", rowId, cells }) as const));
              }
              if (ops.length === 0) return;
              await bridge.batchRows(tableId, { ops }, newMutationContext());
            },
          },
          bridge,
          tableId
        );
        refresh();
        return liveRowIds;
      } catch (operationError) {
        if (updatesChanged) setRows(snapshot);
        noteError(operationError);
        refresh();
        throw new Error(messageOf(operationError), { cause: operationError });
      }
    },
    [bridge, tableId, pushUndo, refresh]
  );

  // The grid column's wire spec stand: the fresh id is bridge-assigned (the grid's draft id stands the form's
  // local stand, never the wire's identity), the
  // flat reference / number fields map to the wire's nested shapes, a new
  // column stands nullable (the empty cells stand the nulls).
  const columnSpecOf = (column: BridgeColumn, position: number): Omit<Column, "id" | "revision"> => {
    const spec: Omit<Column, "id" | "revision"> = {
      name: column.name,
      type: column.type,
      position,
      nullable: true,
      ...(column.operators !== undefined ? { operators: [...column.operators] } : {}),
    };
    if (column.refKind !== undefined) {
      spec.reference = {
        kind: column.refKind,
        tableId: column.refTableId ?? "",
        many: column.refMany === true,
        ...(column.refDisplayColumn !== undefined ? { displayColumnId: column.refDisplayColumn } : {}),
      };
    }
    const numberDisplay: NonNullable<Column["numberDisplay"]> = {};
    let hasNumberDisplay = false;
    if (column.decimals !== undefined) {
      numberDisplay.decimals = column.decimals;
      hasNumberDisplay = true;
    }
    if (column.thousands !== undefined) {
      numberDisplay.thousands = column.thousands;
      hasNumberDisplay = true;
    }
    if (column.prefix !== undefined) {
      numberDisplay.prefix = column.prefix;
      hasNumberDisplay = true;
    }
    if (column.suffix !== undefined) {
      numberDisplay.suffix = column.suffix;
      hasNumberDisplay = true;
    }
    if (column.allowNegative !== undefined) {
      numberDisplay.allowNegative = column.allowNegative;
      hasNumberDisplay = true;
    }
    if (hasNumberDisplay) spec.numberDisplay = numberDisplay;
    return spec;
  };

  const addColumn = useCallback(
    async (column: BridgeColumn, afterColumnId?: string) => {
      const spec = columnSpecOf(column, descriptionRef.current?.columns.length ?? 0);
      // The identity cell stands the column the inverse addresses: the
      // redo re-creates with a FRESH bridge-assigned id (a fresh logical
      // operation).
      let liveColumnId: string;
      try {
        const receipt = await bridge.createColumn(
          tableId,
          {
            column: spec,
            ...(afterColumnId !== undefined ? { afterColumnId } : {}),
          },
          newMutationContext()
        );
        liveColumnId = receipt.result.id;
      } catch (operationError) {
        noteError(operationError);
        throw new Error(messageOf(operationError), { cause: operationError });
      }
      // Without the `columnRestore` capability the consumer's
      // `deleteColumn` destroys the column's data — the removal is NOT
      // undoable and never enters the stack.
      if (capabilitiesRef.current.includes("columnRestore")) {
        pushUndo(
          {
            label: `create column ${liveColumnId}`,
            forward: async () => {
              const redoReceipt = await bridge.createColumn(
                tableId,
                { column: spec, ...(afterColumnId !== undefined ? { afterColumnId } : {}) },
                newMutationContext()
              );
              liveColumnId = redoReceipt.result.id;
            },
            inverse: async () => {
              await bridge.deleteColumn(tableId, liveColumnId, newMutationContext());
            },
          },
          bridge,
          tableId
        );
      }
      // The bridge-assigned id stands the caller's view-state stand (the
      // block's `columnOrder` attr appends the real id, never the draft's
      // placeholder).
      return liveColumnId;
    },
    [bridge, tableId, pushUndo]
  );

  // The grid patch's wire stand: the operators stand the override, the
  // reference fields merge over the current column's reference (the patch
  // never removes an attribute), the flat number fields merge over the
  // current `numberDisplay`.
  const columnPatchOf = (
    columnId: string,
    patch: Partial<Omit<BridgeColumn, "id" | "name">>
  ): Partial<Omit<Column, "id" | "revision">> | null => {
    const current = descriptionRef.current?.columns.find((entry) => entry.id === columnId);
    if (current === undefined) return null;
    const wirePatch: Partial<Omit<Column, "id" | "revision">> = {};
    if (patch.operators !== undefined) wirePatch.operators = [...patch.operators];
    if (
      patch.refKind !== undefined ||
      patch.refTableId !== undefined ||
      patch.refMany !== undefined ||
      patch.refDisplayColumn !== undefined
    ) {
      wirePatch.reference = {
        kind: patch.refKind ?? current.reference?.kind ?? "row",
        tableId: patch.refTableId ?? current.reference?.tableId ?? "",
        many: patch.refMany ?? current.reference?.many ?? false,
        ...(patch.refDisplayColumn !== undefined || current.reference?.displayColumnId !== undefined
          ? { displayColumnId: patch.refDisplayColumn ?? current.reference?.displayColumnId }
          : {}),
      };
    }
    const numberDisplay: NonNullable<Column["numberDisplay"]> = { ...current.numberDisplay };
    let hasNumberPatch = false;
    if (patch.decimals !== undefined) {
      numberDisplay.decimals = patch.decimals;
      hasNumberPatch = true;
    }
    if (patch.thousands !== undefined) {
      numberDisplay.thousands = patch.thousands;
      hasNumberPatch = true;
    }
    if (patch.prefix !== undefined) {
      numberDisplay.prefix = patch.prefix;
      hasNumberPatch = true;
    }
    if (patch.suffix !== undefined) {
      numberDisplay.suffix = patch.suffix;
      hasNumberPatch = true;
    }
    if (patch.allowNegative !== undefined) {
      numberDisplay.allowNegative = patch.allowNegative;
      hasNumberPatch = true;
    }
    if (hasNumberPatch) wirePatch.numberDisplay = numberDisplay;
    return Object.keys(wirePatch).length > 0 ? wirePatch : null;
  };

  const updateColumn = useCallback(
    async (columnId: string, patch: Partial<Omit<BridgeColumn, "id" | "name">>) => {
      const current = descriptionRef.current?.columns.find((entry) => entry.id === columnId);
      const wirePatch = columnPatchOf(columnId, patch);
      if (current === undefined || wirePatch === null) return;
      // The pre-patch attributes (the inverse's restore — the patched keys
      // only).
      const previous: Record<string, unknown> = {
        ...(current.operators !== undefined ? { operators: [...current.operators] } : {}),
        ...(current.reference !== undefined ? { reference: { ...current.reference } } : {}),
        ...(current.numberDisplay !== undefined ? { numberDisplay: { ...current.numberDisplay } } : {}),
      };
      try {
        await bridge.updateColumn(tableId, columnId, wirePatch, newMutationContext());
        pushUndo(
          {
            label: `update column ${columnId}`,
            forward: async () => {
              await bridge.updateColumn(tableId, columnId, wirePatch, newMutationContext());
            },
            inverse: async () => {
              const restore: Partial<Omit<Column, "id" | "revision">> = {};
              for (const key of Object.keys(wirePatch)) {
                const value = previous[key];
                if (value !== undefined) (restore as Record<string, unknown>)[key] = value;
              }
              await bridge.updateColumn(tableId, columnId, restore, newMutationContext());
            },
          },
          bridge,
          tableId
        );
      } catch (operationError) {
        noteError(operationError);
        throw new Error(messageOf(operationError), { cause: operationError });
      }
    },
    [bridge, tableId, pushUndo]
  );

  const deleteColumn = useCallback(
    async (columnId: string) => {
      if (descriptionRef.current?.columns.some((entry) => entry.id === columnId) !== true) return;
      try {
        await bridge.deleteColumn(tableId, columnId, newMutationContext());
        // Without the `columnRestore` capability the removal is NOT
        // undoable (the same stand as the row removal without the
        // `rowRestore`).
        if (capabilitiesRef.current.includes("columnRestore")) {
          pushUndo(
            {
              label: `delete column ${columnId}`,
              forward: async () => {
                await bridge.deleteColumn(tableId, columnId, newMutationContext());
              },
              inverse: async () => {
                await bridge.restoreDeletedColumn(tableId, columnId, newMutationContext());
              },
            },
            bridge,
            tableId
          );
        }
      } catch (operationError) {
        noteError(operationError);
        throw new Error(messageOf(operationError), { cause: operationError });
      }
    },
    [bridge, tableId, pushUndo]
  );

  const renameColumn = useCallback(
    async (columnId: string, name: string) => {
      const current = descriptionRef.current?.columns.find((entry) => entry.id === columnId);
      if (current === undefined || current.name === name) return;
      try {
        await bridge.updateColumn(tableId, columnId, { name }, newMutationContext());
        pushUndo(
          {
            label: `rename column ${columnId}`,
            forward: async () => {
              await bridge.updateColumn(tableId, columnId, { name }, newMutationContext());
            },
            inverse: async () => {
              await bridge.updateColumn(tableId, columnId, { name: current.name }, newMutationContext());
            },
          },
          bridge,
          tableId
        );
      } catch (operationError) {
        noteError(operationError);
        throw new Error(messageOf(operationError), { cause: operationError });
      }
    },
    [bridge, tableId, pushUndo]
  );

  const renameTable = useCallback(
    async (name: string) => {
      const previous = descriptionRef.current?.table.name;
      if (previous === undefined || previous === name) return;
      try {
        await bridge.renameTable(tableId, { name }, newMutationContext());
        pushUndo(
          {
            label: `rename table to ${name}`,
            forward: async () => {
              await bridge.renameTable(tableId, { name }, newMutationContext());
            },
            inverse: async () => {
              await bridge.renameTable(tableId, { name: previous }, newMutationContext());
            },
          },
          bridge,
          tableId
        );
      } catch (operationError) {
        noteError(operationError);
        throw new Error(messageOf(operationError), { cause: operationError });
      }
    },
    [bridge, tableId, pushUndo]
  );

  const loadMore = useCallback(async () => {
    if (nextCursor === null) return;
    // The token at the call's time: a fresh snapshot (the event refetch,
    // the retry, the rebaseline) bumps it, so the stale page stands no
    // state over the fresh one's rows + cursor.
    const token = loadTokenRef.current;
    const { asOfSeq, fingerprint } = pageRef.current;
    try {
      const page = await bridge.queryNextPage(tableId, {
        cursor: nextCursor,
        asOfSeq,
        queryFingerprint: fingerprint,
      });
      if (token !== loadTokenRef.current) return; // a newer snapshot stands the rows + cursor
      pageRef.current = { asOfSeq: page.asOfSeq, fingerprint: page.queryFingerprint };
      // The appended rows' revisions stand the CAS (the same stand as the
      // snapshot's page).
      for (const row of page.rows) revisionsRef.current.set(row.id, row.revision);
      setRows((rows) => {
        const known = new Set(rows.map((row) => row.rowId));
        const appended = page.rows
          .filter((row) => !known.has(row.id))
          .map((row) => ({ rowId: row.id, cells: { ...row.cells } }));
        return [...rows, ...appended];
      });
      setNextCursor(page.nextCursor);
    } catch (operationError) {
      if (token !== loadTokenRef.current) return; // a stale failure stands no error
      // The cursor's snapshot boundary advanced: the stand is the fresh
      // page (the re-snapshot), not the error.
      if (isBridgeError(operationError) && operationError.code === "cursor_expired") {
        refresh();
        return;
      }
      noteError(operationError);
    }
  }, [bridge, tableId, nextCursor, refresh]);

  const retry = useCallback(() => setLoadVersion((version) => version + 1), []);

  const undo = useCallback(async () => {
    // The in-flight stand: a re-entrant undo (the second press over the
    // first's in-flight inverse) stands no second inverse over the same
    // entry.
    if (historyInFlightRef.current) return;
    const ops = undoStackRef.current;
    const op = ops[ops.length - 1];
    if (op === undefined) return;
    // The identity at the call's time: a relink (the bridge / the tableId
    // change) over the in-flight inverse re-stands the history (the stacks
    // stand cleared, historyRef stands the new one) — the post-await
    // commit (the pop / the redo-push) must not carry the old entry into
    // the new table's history.
    const identity = { bridge: historyRef.current.bridge, tableId: historyRef.current.tableId };
    const sameIdentity = () =>
      historyRef.current.bridge === identity.bridge && historyRef.current.tableId === identity.tableId;
    historyInFlightRef.current = true;
    try {
      await op.inverse();
      if (!sameIdentity()) return;
      // The identity stand over the in-flight window: the user's forward
      // write may have grown the stack since the call (the push over the
      // same array) — the removal stands by identity (the top's pop, the
      // grown stand's splice out of position), never by blind position
      // (a foreign top's pop would drop the fresh entry from the history
      // and the redo's re-commit would stand a duplicate over the bridge).
      const index = ops.lastIndexOf(op);
      if (index !== -1) {
        if (index === ops.length - 1) ops.pop();
        else ops.splice(index, 1);
        redoStackRef.current.push(op);
      }
      setError(null);
      setErrorCode(null);
    } catch (operationError) {
      if (!sameIdentity()) return;
      // The failed entry STAYS on the stack (the retry stand): a failed
      // inverse never drops the operation.
      noteError(operationError);
    } finally {
      historyInFlightRef.current = false;
    }
    if (!sameIdentity()) return;
    bump();
    refresh();
  }, [bump, refresh]);

  const redo = useCallback(async () => {
    if (historyInFlightRef.current) return;
    const ops = redoStackRef.current;
    const op = ops[ops.length - 1];
    if (op === undefined) return;
    const identity = { bridge: historyRef.current.bridge, tableId: historyRef.current.tableId };
    const sameIdentity = () =>
      historyRef.current.bridge === identity.bridge && historyRef.current.tableId === identity.tableId;
    historyInFlightRef.current = true;
    try {
      await op.forward();
      if (!sameIdentity()) return;
      // The symmetric identity stand (the redo's stack stands stable over
      // the in-flight window — the history's in-flight guard — the identity
      // check stands the stand anyway).
      const index = ops.lastIndexOf(op);
      if (index !== -1) {
        if (index === ops.length - 1) ops.pop();
        else ops.splice(index, 1);
        undoStackRef.current.push(op);
      }
      setError(null);
      setErrorCode(null);
    } catch (operationError) {
      if (!sameIdentity()) return;
      // The failed entry STAYS on the stack (the retry stand).
      noteError(operationError);
    } finally {
      historyInFlightRef.current = false;
    }
    if (!sameIdentity()) return;
    bump();
    refresh();
  }, [bump, refresh]);

  return {
    phase,
    table,
    rows,
    revisionOf,
    nextCursor,
    error,
    insertRow,
    updateRow,
    updateRows,
    pasteRows,
    removeRow,
    moveRow,
    addColumn,
    updateColumn,
    deleteColumn,
    renameColumn,
    renameTable,
    loadMore,
    retry,
    undo,
    redo,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0,
    errorCode,
    capabilities,
  };
}

export { useDatabaseTable };
