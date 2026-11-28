/**
 * The structural row ops (the removal / the move): the fresh `operationId`'s
 * write over the bridge, the optimistic order / visibility stand, and the
 * forward-only undo entry — the removal's inverse is the `undeleteRows`
 * when the `rowRestore` capability stands (else the removal is not
 * undoable and never enters the stack), the move's inverse stands the
 * ORIGINAL SEAT (the pre-move successor, resolved at the undo's time over
 * the refetched state).
 */
import { toBridgeError } from "../bridge";
import type { RowOpsContext, UseDatabaseTable } from "./models";
import { newMutationContext, rowOf } from "./utils";

interface RowStructureOps {
  removeRow: UseDatabaseTable["removeRow"];
  removeRows: UseDatabaseTable["removeRows"];
  moveRow: UseDatabaseTable["moveRow"];
}

function createRowStructureOps(ctx: RowOpsContext): RowStructureOps {
  const { bridge, tableId, rowsRef, pendingRowRef, capabilitiesRef, setRows, setPendingRow } = ctx;
  const { pushUndo, refresh, noteError, casOf, sameIdentity } = ctx;

  const removeRows = async (rowIds: string[]): Promise<void> => {
    const ids = [...new Set(rowIds)].filter((rowId) => rowOf(rowsRef, pendingRowRef, rowId) !== undefined);
    if (ids.length === 0) return;
    const removed = new Set(ids);
    const snapshot = rowsRef.current;
    const pendingSnapshot = pendingRowRef.current;
    setRows((rows) => rows.filter((entry) => !removed.has(entry.rowId)));
    try {
      await bridge.batchRows(
        tableId,
        { ops: ids.map((rowId) => ({ op: "delete", rowId, ...casOf(rowId) })) },
        newMutationContext()
      );
      if (!sameIdentity()) return;
      setPendingRow((current) => (current !== null && removed.has(current.rowId) ? null : current));
      // Row restoration is an optional bridge capability; without it a
      // deletion never enters the undo stack.
      if (capabilitiesRef.current.includes("rowRestore")) {
        pushUndo(
          {
            label: `remove rows ${ids.join(", ")}`,
            forward: async () => {
              await bridge.batchRows(
                tableId,
                { ops: ids.map((rowId) => ({ op: "delete", rowId })) },
                newMutationContext()
              );
            },
            inverse: async () => {
              await bridge.undeleteRows(tableId, { rowIds: ids }, newMutationContext());
            },
          },
          bridge,
          tableId
        );
      }
      refresh();
    } catch (operationError) {
      if (sameIdentity()) {
        setRows(snapshot);
        setPendingRow(pendingSnapshot);
        noteError(operationError);
        refresh();
      }
      throw toBridgeError(operationError);
    }
  };

  const removeRow = async (rowId: string): Promise<void> => removeRows([rowId]);

  const moveRow = async (rowId: string, beforeRowId: string | null): Promise<void> => {
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
      // The relink's drop: the commit landed on the previous table — the
      // entry and the refetch belong to it.
      if (!sameIdentity()) return;
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
            await bridge.batchRows(tableId, { ops: [{ op: "move", rowId, beforeRowId: seat }] }, newMutationContext());
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
        noteError(operationError);
        refresh();
      }
      throw toBridgeError(operationError); // the typed stand: the code stands the retry / the clear's decision
    }
  };

  return { removeRow, removeRows, moveRow };
}

export { createRowStructureOps };
export type { RowStructureOps };
