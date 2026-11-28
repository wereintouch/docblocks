/**
 * The table's snapshot + stream state: the bootstrap stands the normative
 * order (the protocol negotiation, the `snapshotTable` over the `R`, the
 * `subscribeTable` over `afterSeq: R`), the envelope's page REFETCH (the
 * fresh snapshot over the fresh `R` — the in-place refill is not a stand;
 * the live subscription stays alive over the refetch), the stream's chain
 * as the loss detector (the gapped `seq` stands the full rebaseline), the
 * fatal codes' death, and the next page's continuation (the cursor + the
 * query's snapshot boundary).
 */
import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { DatabaseFilterPayload } from "docblocks-core";

import type {
  BridgeErrorCode,
  BridgeTableDescription,
  DatabaseBridge,
  ProtocolCapability,
  SubscriptionHandle,
  TableDescription,
  TableSnapshot,
} from "../bridge";
import { validateProtocolDescriptor } from "../bridge";
import { PAGE_SIZE, SEQ_DEDUP_WINDOW } from "./constants";
import type { DatabaseTablePhase, DatabaseTableRow, RefCell } from "./models";
import { descriptionToGrid, isFatalTableError } from "./utils";

interface TableStreamState {
  pageRef: RefCell<{ asOfSeq: number; fingerprint: string }>;
  descriptionRef: RefCell<TableDescription | null>;
  revisionsRef: RefCell<Map<string, string>>;
  pendingRowRef: RefCell<DatabaseTableRow | null>;
  loadTokenRef: RefCell<number>;
  subGenRef: RefCell<number>;
  setTable: (table: BridgeTableDescription | null) => void;
  setRows: Dispatch<SetStateAction<DatabaseTableRow[]>>;
  setPendingRow: Dispatch<SetStateAction<DatabaseTableRow | null>>;
  setNextCursor: (cursor: string | null) => void;
  setCapabilities: (capabilities: readonly ProtocolCapability[]) => void;
  setError: (error: string | null) => void;
  setErrorCode: (code: BridgeErrorCode | null) => void;
  setPhase: (phase: DatabaseTablePhase) => void;
}

/** The snapshot state's apply (`clearError` = the full-load stand). */
function applySnapshotState(state: TableStreamState, snapshot: TableSnapshot, clearError = false): void {
  const { pageRef, descriptionRef, revisionsRef, pendingRowRef } = state;
  const { setTable, setRows, setPendingRow, setNextCursor, setError, setErrorCode, setPhase } = state;
  pageRef.current = { asOfSeq: snapshot.page.asOfSeq, fingerprint: snapshot.page.queryFingerprint };
  descriptionRef.current = {
    table: { ...snapshot.table },
    columns: snapshot.columns.map((column) => ({ ...column })),
    schemaRevision: snapshot.schemaRevision,
  };
  const visibleIds = new Set(snapshot.page.rows.map((row) => row.id));
  const pendingBefore = pendingRowRef.current;
  const pendingRevision = pendingBefore === null ? undefined : revisionsRef.current.get(pendingBefore.rowId);
  revisionsRef.current = new Map(snapshot.page.rows.map((row) => [row.id, row.revision]));
  if (pendingBefore !== null && !visibleIds.has(pendingBefore.rowId) && pendingRevision !== undefined) {
    revisionsRef.current.set(pendingBefore.rowId, pendingRevision);
  }
  setTable(descriptionToGrid(snapshot));
  setRows(snapshot.page.rows.map((row) => ({ rowId: row.id, cells: { ...row.cells } })));
  setPendingRow((current) => (current !== null && visibleIds.has(current.rowId) ? null : current));
  setNextCursor(snapshot.page.nextCursor);
  if (clearError) {
    setError(null);
    setErrorCode(null);
  }
  setPhase("ready");
}

interface TableStreamContext {
  bridge: DatabaseBridge;
  tableId: string;
  filter?: DatabaseFilterPayload;
  filterKey: string;
  loadVersion: number;
  state: TableStreamState;
  noteError: (operationError: unknown) => void;
}

/** The bootstrap + the live subscription over the stream's chain. */
function useTableStream(ctx: TableStreamContext): void {
  const { bridge, tableId, filter, filterKey, loadVersion, state, noteError } = ctx;
  const { loadTokenRef, subGenRef } = state;
  // Only an identity change replaces the ready surface with the loading
  // card. A filter/rebaseline keeps the current rows until its snapshot arrives.
  const loadedIdentityRef = useRef<{ bridge: DatabaseBridge; tableId: string } | null>(null);
  const applySnapshot = (snapshot: TableSnapshot, clearError = false) =>
    applySnapshotState(state, snapshot, clearError);

  // The bootstrap: the protocol negotiation, the snapshot (the `R`), then
  // the live subscription over `afterSeq: R`.
  useEffect(() => {
    const loadedIdentity = loadedIdentityRef.current;
    const sameIdentity = loadedIdentity?.bridge === bridge && loadedIdentity.tableId === tableId;
    state.setPendingRow(null);
    state.setNextCursor(null);
    if (!sameIdentity) {
      loadedIdentityRef.current = null;
      state.setTable(null);
      state.setRows([]);
      state.revisionsRef.current = new Map();
    }
    let disposed = false;
    let handle: SubscriptionHandle | null = null;
    let lastSeenSeq: number | null = null;
    const seenSeqs = new Set<number>();

    // The table's death stand (the fatal code over the read / the
    // stream): the sensitive cache stands cleared, the delivery stands
    // stopped, the phase stands broken (the grid's error surface).
    const die = (operationError: unknown): void => {
      state.setRows([]);
      state.setPendingRow(null);
      state.setNextCursor(null);
      state.revisionsRef.current = new Map();
      if (handle !== null) handle.unsubscribe();
      loadedIdentityRef.current = null;
      state.setPhase("broken");
      noteError(operationError);
    };

    const refetch = async (): Promise<void> => {
      // The event's page refetch: the fresh snapshot over the fresh `R` —
      // the live subscription is NOT re-opened over it.
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
      if (!disposed && !sameIdentity) state.setPhase("loading");
      try {
        const descriptor = await bridge.describeProtocol();
        if (disposed || token !== loadTokenRef.current) return;
        // The version / the baseline-capability mismatch stands the
        // `protocol_mismatch` — the silent downgrade is not a stand.
        validateProtocolDescriptor(descriptor);
        state.setCapabilities(descriptor.capabilities);
        const snapshot = await bridge.snapshotTable(tableId, { filter, limit: PAGE_SIZE });
        if (disposed || token !== loadTokenRef.current) return;
        // The chain's first link: the snapshot's `R` (the first replayed
        // envelope must chain to it; the null prevSeq stands the table's
        // first envelope over the empty head).
        lastSeenSeq = snapshot.page.asOfSeq;
        seenSeqs.clear();
        applySnapshot(snapshot, true);
        loadedIdentityRef.current = { bridge, tableId };
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
              // The window's bound (the long session's growth stands
              // bounded): the stale check — the seq at or below the
              // head's drop — protects the pruned seqs over the clear.
              if (seenSeqs.size >= SEQ_DEDUP_WINDOW) seenSeqs.clear();
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
        // cleared (the stale rows of the previous table over the relink)
        // — not just the broken phase.
        if (isFatalTableError(bootstrapError)) {
          die(bootstrapError);
          return;
        }
        state.setPhase("broken");
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
}

export { applySnapshotState, useTableStream };
export type { TableStreamContext, TableStreamState };
