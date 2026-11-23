/**
 * The multi-row's batch cell writes (the batch update / the mixed paste):
 * the fresh `operationId`'s write over the ONE `batchRows` (one
 * transaction, one undo entry — the inverse restores every touched row /
 * the created rows' deletion over the single undo), the no-op's equality
 * guard over every touched cell (the all-unchanged batch stands no
 * write), and the optimistic apply over the updated rows (the creates
 * stand no optimistic pre-apply — the id is bridge-assigned, the rows
 * stand over the post-commit refresh).
 */
import { toBridgeError } from "../bridge";
import type { BatchOp } from "../bridge";
import type { DatabaseTableRow, RowOpsContext, UseDatabaseTable } from "./models";
import { cleanCells } from "./row-write-ops";
import { cellValueEqual, newMutationContext, rowOf } from "./utils";

interface RowBatchOps {
  updateRows: UseDatabaseTable["updateRows"];
  pasteRows: UseDatabaseTable["pasteRows"];
}

function createRowBatchOps(ctx: RowOpsContext): RowBatchOps {
  const { bridge, tableId, rowsRef, pendingRowRef, revisionsRef, setRows, setPendingRow } = ctx;
  const { pushUndo, refresh, noteError, casOf, sameIdentity } = ctx;

  const updateRows = async (updates: Array<{ rowId: string; cells: Record<string, unknown> }>): Promise<void> => {
    if (updates.length === 0) return;
    const snapshot = rowsRef.current.map((row) => ({ rowId: row.rowId, cells: { ...row.cells } }));
    const pendingSnapshot = pendingRowRef.current;
    // The pre-operation cells of the touched rows (the inverse's
    // restore): the committed page rows + the pending row (the
    // filtered-out row the page holds no reference to — the inverse must
    // not strand it over the absent entry).
    const before = new Map(rowsRef.current.map((row) => [row.rowId, row.cells]));
    seedPendingBefore(before, pendingSnapshot, updates);
    const cleaned = updates.map(({ rowId, cells }) => ({ rowId, cells: cleanCells(cells) }));
    // The all-unchanged batch stands no write (the clear over an
    // already-empty region): the same equality guard as the single-row
    // path, over every touched cell (the effective stand — the pending
    // row's no-op stands the same no-write).
    if (
      cleaned.every(({ rowId, cells }) => {
        const row = rowOf(rowsRef, pendingRowRef, rowId);
        return (
          row !== undefined && Object.entries(cells).every(([key, value]) => cellValueEqual(row.cells[key], value))
        );
      })
    ) {
      return;
    }
    applyOptimistic(ctx, cleaned);
    try {
      const receipt = await bridge.batchRows(
        tableId,
        {
          ops: cleaned.map(({ rowId, cells }) => ({ op: "update", rowId, cells, ...casOf(rowId) })),
        },
        newMutationContext()
      );
      // The relink's drop: the commit landed on the previous table — the
      // revision map, the entry and the refetch belong to it.
      if (!sameIdentity()) return;
      for (const [id, revision] of Object.entries(receipt.revisions)) revisionsRef.current.set(id, revision);
      const restore = restorePatchesOf(before, cleaned);
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
      // The relink's drop: the rollback + the note stand the previous
      // table's failure, not the fresh grid's state.
      if (sameIdentity()) {
        setRows(snapshot);
        setPendingRow(pendingSnapshot);
        noteError(operationError);
        refresh();
      }
      throw toBridgeError(operationError); // the typed stand: the code stands the retry / the clear's decision
    }
  };

  /** The mixed paste: the visible rows' updates (from the active row down)
   *  + the overflow's creates — ONE `batchRows` (one transaction, one undo
   *  entry). The updates stand the optimistic apply (the instant cells);
   *  the creates stand no optimistic pre-apply (the id is bridge-assigned
   *  — the rows stand over the post-commit refresh). Returns the created
   *  rows' ids. */
  const pasteRows: UseDatabaseTable["pasteRows"] = async (input) => {
    const { updates, creates, beforeRowId } = input;
    if (updates.length === 0 && creates.length === 0) return [];
    const snapshot = rowsRef.current.map((row) => ({ rowId: row.rowId, cells: { ...row.cells } }));
    const pendingSnapshot = pendingRowRef.current;
    // The pre-operation cells of the updated rows (the inverse's
    // restore): the committed page rows + the pending row (the effective
    // stand — the same as the batch update's).
    const before = new Map(rowsRef.current.map((row) => [row.rowId, row.cells]));
    seedPendingBefore(before, pendingSnapshot, updates);
    const cleaned = updates.map(({ rowId, cells }) => ({ rowId, cells: cleanCells(cells) }));
    // The all-unchanged updates + no creates stands no write (the empty
    // clipboard's no-op — the same equality guard as the batch update's,
    // over the effective stand).
    const updatesChanged = cleaned.some(({ rowId, cells }) => {
      const row = rowOf(rowsRef, pendingRowRef, rowId);
      return row === undefined || !Object.entries(cells).every(([key, value]) => cellValueEqual(row.cells[key], value));
    });
    if (!updatesChanged && creates.length === 0) return [];
    if (updatesChanged) applyOptimistic(ctx, cleaned);
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
      // The relink's drop: the commit landed on the previous table — the
      // created rows' ids, the revision map, the entry and the refetch
      // belong to it.
      if (!sameIdentity()) return [];
      // The receipt's `rows` stand the created rows over the create
      // op's order (the contract's stand) — the created rows are the
      // ones NOT in the update set (the create's id is fresh; the
      // updated rows keep theirs — the filter stands the guard over
      // a bridge that would stand the wider set).
      const updatedIds = new Set(cleaned.map((entry) => entry.rowId));
      liveRowIds = receipt.result.rows.filter((row) => !updatedIds.has(row.id)).map((row) => row.id);
      for (const [id, revision] of Object.entries(receipt.revisions)) revisionsRef.current.set(id, revision);
      const restore = restorePatchesOf(before, cleaned);
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
      // The relink's drop: the rollback + the note stand the previous
      // table's failure, not the fresh grid's state.
      if (sameIdentity()) {
        if (updatesChanged) {
          setRows(snapshot);
          setPendingRow(pendingSnapshot);
        }
        noteError(operationError);
        refresh();
      }
      throw toBridgeError(operationError); // the typed stand: the code stands the retry / the clear's decision
    }
  };

  return { updateRows, pasteRows };
}

/** The pending row's pre-operation cells over the `before` map (the
 *  inverse's restore stand): the page holds no reference to the
 *  filtered-out row, so the map's seed is the write's pre-operation
 *  source only when the batch touches the row's id. */
function seedPendingBefore(
  before: Map<string, Record<string, unknown>>,
  pending: DatabaseTableRow | null,
  updates: Array<{ rowId: string }>
): void {
  if (pending === null) return;
  if (updates.some(({ rowId }) => rowId === pending.rowId)) before.set(pending.rowId, pending.cells);
}

/** The optimistic apply over the cleaned patches (the single-row / the
 *  batch's shared stand: the rows' cells + the pending row's cells). */
function applyOptimistic(
  ctx: Pick<RowOpsContext, "setRows" | "setPendingRow">,
  cleaned: Array<{ rowId: string; cells: Record<string, unknown> }>
): void {
  const { setRows, setPendingRow } = ctx;
  const byId = new Map(cleaned.map((entry) => [entry.rowId, entry.cells]));
  setRows((rows) =>
    rows.map((row) => {
      const patch = byId.get(row.rowId);
      return patch === undefined ? row : { ...row, cells: { ...row.cells, ...patch } };
    })
  );
  setPendingRow((current) => {
    if (current === null) return null;
    const patch = byId.get(current.rowId);
    return patch === undefined ? current : { ...current, cells: { ...current.cells, ...patch } };
  });
}

/** The inverse's restore patches over the pre-operation cells: the
 *  edited keys' pre-operation values, the absent-before key over the
 *  explicit null (the merge's removal stand — the `undefined` would be
 *  skipped by the bridge's cells' write). */
function restorePatchesOf(
  before: Map<string, Record<string, unknown>>,
  cleaned: Array<{ rowId: string; cells: Record<string, unknown> }>
): Array<{ rowId: string; cells: Record<string, unknown> }> {
  return cleaned.flatMap(({ rowId, cells }) => {
    const oldCells = before.get(rowId);
    if (oldCells === undefined) return [];
    // The keys stand the bridge's column ids (the data's stand — the
    // null-prototype's map keeps a hostile `__proto__` the inert own entry).
    const patch = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(cells)) {
      patch[key] = oldCells[key] === undefined ? null : oldCells[key];
    }
    if (Object.keys(patch).length === 0) return [];
    return [{ rowId, cells: patch }];
  });
}

export { createRowBatchOps };
export type { RowBatchOps };
