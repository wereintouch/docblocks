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
import { newMutationContext } from "./utils";

interface RowStructureOps {
  removeRow: UseDatabaseTable["removeRow"];
  moveRow: UseDatabaseTable["moveRow"];
}

function createRowStructureOps(ctx: RowOpsContext): RowStructureOps {
  const { bridge, tableId, rowsRef, capabilitiesRef, setRows, setPendingRow } = ctx;
  const { pushUndo, refresh, noteError, casOf } = ctx;

  const removeRow = async (rowId: string): Promise<void> => {
    const snapshot = rowsRef.current;
    const row = snapshot.find((entry) => entry.rowId === rowId);
    setRows((rows) => rows.filter((entry) => entry.rowId !== rowId));
    try {
      await bridge.batchRows(tableId, { ops: [{ op: "delete", rowId, ...casOf(rowId) }] }, newMutationContext());
      setPendingRow((current) => (current?.rowId === rowId ? null : current));
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
      throw toBridgeError(operationError); // the typed stand: the code stands the retry / the clear's decision
    }
  };

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
      setRows(snapshot);
      noteError(operationError);
      refresh();
      throw toBridgeError(operationError); // the typed stand: the code stands the retry / the clear's decision
    }
  };

  return { removeRow, moveRow };
}

export { createRowStructureOps };
export type { RowStructureOps };
