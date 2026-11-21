/**
 * The column / table schema writes over the bridge: the fresh
 * `operationId`'s write, the bridge-assigned id stand (the create's
 * receipt is the view state the caller appends, never the draft's
 * placeholder), and the forward-only undo entry — gated by the negotiated
 * capabilities (without `columnRestore` the `deleteColumn` destroys the
 * column's data: the removal is NOT undoable and never enters the stack).
 */
import { toBridgeError } from "../bridge";
import type { BridgeColumn, Column } from "../bridge";
import { columnPatchOf, columnSpecOf } from "./column-spec";
import type { ColumnOpsContext } from "./models";
import { newMutationContext } from "./utils";

interface ColumnOps {
  addColumn: (column: BridgeColumn, afterColumnId?: string) => Promise<string>;
  updateColumn: (columnId: string, patch: Partial<Omit<BridgeColumn, "id" | "name">>) => Promise<void>;
  deleteColumn: (columnId: string) => Promise<void>;
  renameColumn: (columnId: string, name: string) => Promise<void>;
  renameTable: (name: string) => Promise<void>;
}

function createColumnOps(ctx: ColumnOpsContext): ColumnOps {
  const { bridge, tableId, descriptionRef, capabilitiesRef } = ctx;
  const { pushUndo, sameIdentity } = ctx;
  // The relink's drop: a failure of the previous table must not surface
  // over the fresh one's grid (the undo entry stands guarded by the
  // history's own identity).
  const noteError = (operationError: unknown) => {
    if (sameIdentity()) ctx.noteError(operationError);
  };

  const addColumn = async (column: BridgeColumn, afterColumnId?: string): Promise<string> => {
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
      throw toBridgeError(operationError); // the typed stand: the code stands the retry / the clear's decision
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
  };

  const updateColumn = async (columnId: string, patch: Partial<Omit<BridgeColumn, "id" | "name">>): Promise<void> => {
    const current = descriptionRef.current?.columns.find((entry) => entry.id === columnId);
    const wirePatch = columnPatchOf(current, patch);
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
      throw toBridgeError(operationError); // the typed stand: the code stands the retry / the clear's decision
    }
  };

  const deleteColumn = async (columnId: string): Promise<void> => {
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
      throw toBridgeError(operationError); // the typed stand: the code stands the retry / the clear's decision
    }
  };

  const renameColumn = async (columnId: string, name: string): Promise<void> => {
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
      throw toBridgeError(operationError); // the typed stand: the code stands the retry / the clear's decision
    }
  };

  const renameTable = async (name: string): Promise<void> => {
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
      throw toBridgeError(operationError); // the typed stand: the code stands the retry / the clear's decision
    }
  };

  return { addColumn, updateColumn, deleteColumn, renameColumn, renameTable };
}

export { createColumnOps };
export type { ColumnOps };
