/**
 * The single-row's cell writes (the insert / the update) over the bridge:
 * the fresh `operationId`'s write, the optimistic apply (the update), the
 * no-op's equality guard (the unchanged patch stands no write — no bridge
 * call, no refetch, no no-op undo entry), and the forward-only undo entry
 * (the inverse covers the edited keys only).
 */
import { BridgeError, toBridgeError } from "../bridge";
import type { RowOpsContext, UseDatabaseTable } from "./models";
import { cellValueEqual, newMutationContext, rowOf } from "./utils";

interface RowWriteOps {
  insertRow: UseDatabaseTable["insertRow"];
  updateRow: UseDatabaseTable["updateRow"];
}

function createRowWriteOps(ctx: RowOpsContext): RowWriteOps {
  const { bridge, tableId, rowsRef, pendingRowRef, revisionsRef, setRows, setPendingRow } = ctx;
  const { pushUndo, refresh, noteError, casOf, sameIdentity } = ctx;

  const insertRow = async (cells: Record<string, unknown> = {}): Promise<string> => {
    // The row id is bridge-assigned (the `c-` / `r-` allocation), so the
    // insert waits for the receipt (no optimistic row id to reconcile).
    // The identity cell (the `let` the inverse reads) stands the row the
    // inverse addresses: the redo re-creates with a FRESH id (a fresh
    // logical operation), so every inverse stands the row the last
    // forward actually created.
    let liveRowId: string;
    let createdCells: Record<string, unknown> = {};
    let createdRevision: string | undefined;
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
      createdCells = { ...created.cells };
      createdRevision = created.revision;
      for (const [id, revision] of Object.entries(receipt.revisions)) revisionsRef.current.set(id, revision);
    } catch (operationError) {
      // The relink's drop: the failure belongs to the previous table —
      // its note + rollback would land over the fresh one's grid.
      if (sameIdentity()) noteError(operationError);
      throw toBridgeError(operationError); // the typed stand: the code stands the retry / the clear's decision
    }
    if (!sameIdentity()) return liveRowId; // the relink's drop: no entry, no refetch over the fresh table
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
    const insertedRowId = liveRowId;
    refresh((snapshot) => {
      if (snapshot.page.rows.some((row) => row.id === insertedRowId)) return;
      if (createdRevision !== undefined) revisionsRef.current.set(insertedRowId, createdRevision);
      const inserted = { rowId: insertedRowId, cells: { ...createdCells } };
      pendingRowRef.current = inserted;
      setPendingRow(inserted);
    });
    return liveRowId;
  };

  const updateRow = async (rowId: string, cells: Record<string, unknown>, expectedRevision?: string): Promise<void> => {
    const snapshot = rowsRef.current.map((row) => ({ rowId: row.rowId, cells: { ...row.cells } }));
    const pendingSnapshot = pendingRowRef.current;
    // The effective stand (the committed page row, else the pending row):
    // the filtered-out row stands no entry over rowsRef, and the no-op
    // guard / the undo entry must not strand over its absent entry.
    const current = rowOf(rowsRef, pendingRowRef, rowId);
    const cleaned = cleanCells(cells);
    // The unchanged patch stands no write (no bridge call, no refetch,
    // no no-op undo entry): the guard stands before the optimistic apply
    // (an unknown row — filtered out — commits as usual).
    if (
      current !== undefined &&
      Object.entries(cleaned).every(([key, value]) => cellValueEqual(current.cells[key], value))
    ) {
      return;
    }
    setRows((rows) => rows.map((row) => (row.rowId === rowId ? { ...row, cells: { ...row.cells, ...cleaned } } : row)));
    setPendingRow((current) =>
      current?.rowId === rowId ? { ...current, cells: { ...current.cells, ...cleaned } } : current
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
      // The relink's drop: the commit landed on the previous table — the
      // revision map, the entry and the refetch belong to it.
      if (!sameIdentity()) return;
      for (const [id, revision] of Object.entries(receipt.revisions)) revisionsRef.current.set(id, revision);
      if (current !== undefined) {
        const oldCells = { ...current.cells };
        pushUndo(
          {
            label: `update row ${rowId}`,
            forward: async () => {
              await bridge.batchRows(tableId, { ops: [{ op: "update", rowId, cells: cleaned }] }, newMutationContext());
            },
            inverse: async () => {
              // The inverse patch covers the EDITED KEYS ONLY (the full
              // old row would clobber a remote edit of another cell
              // landed after the operation): the pre-operation value of
              // each edited key, the absent-before key over the explicit
              // null (the merge's removal stand). The same-cell conflict
              // policy: the undo stands the newest write.
              // The keys stand the bridge's column ids (the data's
              // stand — a hostile id stands the inert own entry, not the
              // prototype's write): the null-prototype's map.
              const restore = Object.create(null) as Record<string, unknown>;
              for (const key of Object.keys(cleaned)) {
                restore[key] = oldCells[key] === undefined ? null : oldCells[key];
              }
              await bridge.batchRows(tableId, { ops: [{ op: "update", rowId, cells: restore }] }, newMutationContext());
            },
          },
          bridge,
          tableId
        );
      }
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

  return { insertRow, updateRow };
}

/** The clean cells patch: the `undefined` values stand no write (the
 *  merge keeps the current cell). */
function cleanCells(cells: Record<string, unknown>): Record<string, unknown> {
  // The keys stand the bridge's column ids (the data's stand — the
  // null-prototype's map keeps a hostile `__proto__` the inert own entry).
  const patch = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(cells)) if (value !== undefined) patch[key] = value;
  return patch;
}

export { cleanCells, createRowWriteOps };
