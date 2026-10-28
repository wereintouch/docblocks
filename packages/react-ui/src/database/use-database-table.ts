/**
 * The external-form database data provider: the `useDatabaseTable` hook.
 * Loads the table schema (`describeTable`) and the row pages
 * (`queryRows` with the block's `filter`), subscribes to the table's
 * live events (the refetch on any event — the bridge is the source of
 * truth), and exposes the row / column operations with the optimistic
 * layer (the local apply before the bridge call, the rollback to the
 * pre-operation snapshot + the refetch on a reject) and the
 * FORWARD-ONLY per-block undo stack (the inverse operations: insert →
 * remove, update → update with the old values of the edited cells only
 * (the full old row would clobber a remote edit of another cell — the
 * same-cell conflict stands the undo as the newest write), remove →
 * undelete (when the consumer has soft-delete — otherwise the removal is
 * not undoable and never enters the stack), move → move back, column
 * delete → restore (when the consumer's bridge preserves the deleted
 * column's data over `restoreDeletedColumn` — otherwise the destruction
 * stands not undoable and never enters the stack)). The doc-undo does not
 * cover the table rows (they are not in the doc); the hotkey wiring is
 * the consumer UI (the `undo` / `redo` API).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { DatabaseFilterPayload } from "docblocks-core";

import type { BridgeColumn, BridgeTableDescription, DatabaseBridge } from "./bridge";

/** One loaded row: the row id (the pk value) + the cells. */
interface DatabaseTableRow {
  rowId: string;
  cells: Record<string, unknown>;
}

type DatabaseTablePhase = "loading" | "ready" | "broken";

/** The page size the provider loads (the `nextCursor` continuation). */
const PAGE_SIZE = 200;

/** The undo stack entry: the operation's two directions — the forward
 * re-applies the change (the redo), the inverse restores the
 * pre-operation state (the undo). */
interface InverseOp {
  label: string;
  forward: () => Promise<void>;
  inverse: () => Promise<void>;
}

/** The public result of the hook (the grid renderer + the consumer UI read from it). */
interface UseDatabaseTable {
  phase: DatabaseTablePhase;
  /** The table description (the schema); null while loading / broken. */
  table: BridgeTableDescription | null;
  /** The loaded rows in the row order. */
  rows: DatabaseTableRow[];
  /** The cursor of the next page; null = the last page is loaded. */
  nextCursor: string | null;
  /** The last operation error (the transient display); cleared on the next load. */
  error: string | null;
  insertRow(cells?: Record<string, unknown>): Promise<string>;
  updateRow(rowId: string, cells: Record<string, unknown>): Promise<void>;
  /** The batch update: ONE commit (the one bridge call + the one undo
   *  entry — the inverse restores every touched row over the one undo,
   *  so the multi-row clear stands back over a single undo press). */
  updateRows(updates: Array<{ rowId: string; cells: Record<string, unknown> }>): Promise<void>;
  removeRow(rowId: string): Promise<void>;
  moveRow(rowId: string, beforeRowId: string | null): Promise<void>;
  addColumn(column: BridgeColumn, afterColumnId?: string): Promise<void>;
  updateColumn(columnId: string, patch: Partial<Omit<BridgeColumn, "id" | "name">>): Promise<void>;
  deleteColumn(columnId: string): Promise<void>;
  renameColumn(columnId: string, name: string): Promise<void>;
  /** Renames the table (the bridge's attribute — every block over the
   *  tableId stands the new name over the table event). */
  renameTable(name: string): Promise<void>;
  /** Loads the next page (the `nextCursor` continuation). */
  loadMore(): Promise<void>;
  /** Reloads from the bridge (the broken-state retry). */
  retry(): void;
  /** The forward-only undo (the inverse operation via the bridge). */
  undo(): Promise<void>;
  /** The forward-only redo. */
  redo(): Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
}

/** The cell-value equality (null / undefined stand as the empty cell). */
function cellValueEqual(current: unknown, next: unknown): boolean {
  if (current === undefined || current === null) return next === undefined || next === null;
  return current === next;
}

/**
 * The external-form data provider for one `tableId` (per block instance:
 * each block has its own row store and its own undo stack, even when
 * several blocks reference the same table).
 */
function useDatabaseTable(bridge: DatabaseBridge, tableId: string, filter?: DatabaseFilterPayload): UseDatabaseTable {
  const [phase, setPhase] = useState<DatabaseTablePhase>("loading");
  const [table, setTable] = useState<BridgeTableDescription | null>(null);
  const [rows, setRows] = useState<DatabaseTableRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [, setStackVersion] = useState(0); // a re-render trigger for canUndo / canRedo

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  // The load token: a refetch superseded by a newer one (two table events
  // back to back) drops its stale result instead of standing it over the
  // fresh state.
  const loadTokenRef = useRef(0);
  const undoStackRef = useRef<InverseOp[]>([]);
  const redoStackRef = useRef<InverseOp[]>([]);
  const filterKey = filter === undefined ? "" : JSON.stringify(filter);

  /** Loads the description + the first page; `quiet` = no loading flicker (the refetch). */
  const load = useCallback(
    async (quiet: boolean) => {
      const token = ++loadTokenRef.current;
      if (!quiet) setPhase("loading");
      try {
        const description = await bridge.describeTable(tableId);
        const page = await bridge.queryRows(tableId, {
          filter: filter === undefined ? undefined : filter,
          limit: PAGE_SIZE,
        });
        if (token !== loadTokenRef.current) return; // a newer load stands
        setTable(description);
        setRows(Object.entries(page.rows).map(([rowId, cells]) => ({ rowId, cells })));
        setNextCursor(page.nextCursor ?? null);
        setError(null);
        setPhase("ready");
      } catch (loadError) {
        if (quiet) return; // a refetch failure keeps the current state
        setPhase("broken");
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    },
    // The filter by its serialized key (the store re-renders with a fresh
    // object reference only when the block's JSON changed).
    [bridge, tableId, filterKey, loadVersion]
  );

  // The initial load + the live subscription (the refetch on any event —
  // the subscription delivers events for ALL rows regardless of the
  // client's filter / page; the bridge is the source of truth).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await load(false);
    })();
    const unsubscribe = bridge.subscribeTable(tableId, () => {
      if (!cancelled) void load(true);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [load, tableId, bridge]);

  const bump = useCallback(() => setStackVersion((version) => version + 1), []);
  const pushUndo = useCallback(
    (op: InverseOp) => {
      undoStackRef.current.push(op);
      redoStackRef.current = []; // a new operation clears the redo side (forward-only)
      bump();
    },
    [bump]
  );

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  const insertRow = useCallback(
    async (cells: Record<string, unknown> = {}) => {
      // The row id is bridge-assigned (the pk value), so the insert waits
      // for the response (no optimistic row id to reconcile). The identity
      // cell (the `let` the inverse reads) stands the row the inverse
      // addresses: the redo re-inserts with a FRESH id (the backend that
      // always assigns new ids) and updates the cell, so every inverse
      // stands the row the last forward actually created (a stale id would
      // make the next undo throw and leave the redo's row orphaned). The
      // row-link cells of the other tables reference the id by value: a
      // re-insert over a fresh id stands their dead-row stand (the
      // display's empty stand) — the links are other tables' data, not
      // this hook's to rewrite.
      let liveRowId: string;
      try {
        liveRowId = await bridge.insertRow(tableId, cells);
      } catch (operationError) {
        throw new Error(messageOf(operationError), { cause: operationError });
      }
      pushUndo({
        label: `insert row ${liveRowId}`,
        forward: async () => {
          liveRowId = await bridge.insertRow(tableId, cells);
        },
        inverse: async () => bridge.removeRow(tableId, liveRowId),
      });
      refresh();
      return liveRowId;
    },
    [bridge, tableId, pushUndo, refresh]
  );

  const updateRow = useCallback(
    async (rowId: string, cells: Record<string, unknown>) => {
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
        await bridge.updateRow(tableId, rowId, cleaned);
        if (current !== undefined) {
          const oldCells = { ...current.cells };
          pushUndo({
            label: `update row ${rowId}`,
            forward: async () => bridge.updateRow(tableId, rowId, cleaned),
            inverse: async () => {
              // The inverse patch covers the EDITED KEYS ONLY (the full old
              // row would clobber a remote edit of another cell landed
              // after the operation): the pre-operation value of each
              // edited key, the absent-before key over the explicit null
              // (the merge's removal stand). The same-cell conflict policy:
              // the undo stands the newest write (the local pre-operation
              // value over a remote edit of the same cell landed since).
              const restore: Record<string, unknown> = {};
              for (const key of Object.keys(cleaned)) {
                restore[key] = oldCells[key] === undefined ? null : oldCells[key];
              }
              await bridge.updateRow(tableId, rowId, restore);
            },
          });
        }
        refresh();
      } catch (operationError) {
        setRows(snapshot);
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
        await bridge.updateRows(
          tableId,
          cleaned.map(({ rowId, cells }) => ({ rowId, ...cells }))
        );
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
          return [{ rowId, ...patch }];
        });
        pushUndo({
          label: `update rows ${updates.map((entry) => entry.rowId).join(", ")}`,
          // The one entry for the whole batch: the inverse restores every
          // touched row over the single undo, the forward stands the batch
          // again over the single redo.
          forward: async () =>
            bridge.updateRows(
              tableId,
              cleaned.map(({ rowId, cells }) => ({ rowId, ...cells }))
            ),
          inverse: async () => {
            if (restore.length === 0) return;
            await bridge.updateRows(tableId, restore);
          },
        });
        refresh();
      } catch (operationError) {
        setRows(snapshot);
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
        await bridge.removeRow(tableId, rowId);
        // Without soft-delete (no undeleteRows) the removal is NOT
        // undoable: it never enters the stack.
        if (row !== undefined && bridge.undeleteRows !== undefined) {
          pushUndo({
            label: `remove row ${rowId}`,
            forward: async () => bridge.removeRow(tableId, rowId),
            inverse: async () => bridge.undeleteRows!(tableId, [rowId]),
          });
        }
        refresh();
      } catch (operationError) {
        setRows(snapshot);
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
      // moved row in the pre-move order (the inverse's anchor stand —
      // see below).
      const successors = original.slice(from + 1).map((row) => row.rowId);
      const ordered = [...original];
      const moved = ordered.splice(from, 1)[0]!;
      const at = beforeRowId === null ? -1 : ordered.findIndex((row) => row.rowId === beforeRowId);
      ordered.splice(beforeRowId === null || at === -1 ? ordered.length : at, 0, moved);
      setRows(ordered);
      try {
        await bridge.moveRow(tableId, rowId, beforeRowId);
        pushUndo({
          label: `move row ${rowId}`,
          forward: async () => bridge.moveRow(tableId, rowId, beforeRowId),
          inverse: async () => {
            // The inverse stands the ORIGINAL SEAT: the bridge's moveRow
            // inserts the row BEFORE the given row (null = the end), so
            // the anchor is the row's pre-move SUCCESSOR, not its
            // predecessor. The anchor stands resolved at the undo's time
            // over the refetched state: a successor a peer removed in the
            // meantime slides to the next survivor (null = the end when
            // none survive).
            const current = rowsRef.current;
            const seat = successors.find((id) => current.some((row) => row.rowId === id)) ?? null;
            await bridge.moveRow(tableId, rowId, seat);
          },
        });
        refresh();
      } catch (operationError) {
        setRows(snapshot);
        refresh();
        throw new Error(messageOf(operationError), { cause: operationError });
      }
    },
    [bridge, tableId, pushUndo, refresh]
  );

  const addColumn = useCallback(
    async (column: BridgeColumn, afterColumnId?: string) => {
      try {
        await bridge.createColumn(tableId, column, afterColumnId);
        pushUndo({
          label: `create column ${column.id}`,
          forward: async () => bridge.createColumn(tableId, column, afterColumnId),
          inverse: async () => bridge.deleteColumn(tableId, column.id),
        });
      } catch (operationError) {
        throw new Error(messageOf(operationError), { cause: operationError });
      }
    },
    [bridge, tableId, pushUndo]
  );

  const updateColumn = useCallback(
    async (columnId: string, patch: Partial<Omit<BridgeColumn, "id" | "name">>) => {
      const column = table?.columns.find((entry) => entry.id === columnId);
      if (column === undefined) return;
      // The pre-patch attributes (the inverse's restore — the patch's
      // keys only).
      const previous = { ...column };
      try {
        await bridge.updateColumn(tableId, columnId, patch);
        pushUndo({
          label: `update column ${columnId}`,
          forward: async () => bridge.updateColumn(tableId, columnId, patch),
          inverse: async () => {
            const restore: Record<string, unknown> = {};
            for (const key of Object.keys(patch)) restore[key] = (previous as Record<string, unknown>)[key];
            await bridge.updateColumn(tableId, columnId, restore);
          },
        });
      } catch (operationError) {
        throw new Error(messageOf(operationError), { cause: operationError });
      }
    },
    [bridge, tableId, table, pushUndo]
  );

  const deleteColumn = useCallback(
    async (columnId: string) => {
      if (table?.columns.some((entry) => entry.id === columnId) !== true) return;
      try {
        await bridge.deleteColumn(tableId, columnId);
        // Without the reversible delete (no `restoreDeletedColumn`) the
        // backend destroys the column's data — the removal is NOT
        // undoable and never enters the stack (the same stand as the row
        // removal without soft-delete).
        if (bridge.restoreDeletedColumn !== undefined) {
          pushUndo({
            label: `delete column ${columnId}`,
            forward: async () => bridge.deleteColumn(tableId, columnId),
            inverse: async () => bridge.restoreDeletedColumn!(tableId, columnId),
          });
        }
      } catch (operationError) {
        throw new Error(messageOf(operationError), { cause: operationError });
      }
    },
    [bridge, tableId, table, pushUndo]
  );

  const renameColumn = useCallback(
    async (columnId: string, name: string) => {
      const column = table?.columns.find((entry) => entry.id === columnId);
      if (column === undefined || column.name === name) return;
      try {
        await bridge.renameColumn(tableId, columnId, name);
        pushUndo({
          label: `rename column ${columnId}`,
          forward: async () => bridge.renameColumn(tableId, columnId, name),
          inverse: async () => bridge.renameColumn(tableId, columnId, column.name),
        });
      } catch (operationError) {
        throw new Error(messageOf(operationError), { cause: operationError });
      }
    },
    [bridge, tableId, table, pushUndo]
  );

  const renameTable = useCallback(
    async (name: string) => {
      if (table?.name === name) return;
      const previous = table?.name;
      if (previous === undefined) return; // a broken table stands its own retry
      try {
        await bridge.renameTable(tableId, name);
        pushUndo({
          label: `rename table to ${name}`,
          forward: async () => bridge.renameTable(tableId, name),
          inverse: async () => bridge.renameTable(tableId, previous),
        });
      } catch (operationError) {
        throw new Error(messageOf(operationError), { cause: operationError });
      }
    },
    [bridge, tableId, table, pushUndo]
  );

  const loadMore = useCallback(async () => {
    if (nextCursor === null) return;
    try {
      const page = await bridge.queryRows(tableId, {
        filter: filter === undefined ? undefined : filter,
        cursor: nextCursor,
        limit: PAGE_SIZE,
      });
      setRows((rows) => {
        const known = new Set(rows.map((row) => row.rowId));
        const appended = Object.entries(page.rows)
          .filter(([rowId]) => !known.has(rowId))
          .map(([rowId, cells]) => ({ rowId, cells }));
        return [...rows, ...appended];
      });
      setNextCursor(page.nextCursor ?? null);
    } catch (operationError) {
      setError(messageOf(operationError));
    }
  }, [bridge, tableId, nextCursor, filterKey]);

  const retry = useCallback(() => setLoadVersion((version) => version + 1), []);

  const undo = useCallback(async () => {
    const op = undoStackRef.current.pop();
    if (op === undefined) return;
    try {
      await op.inverse();
      redoStackRef.current.push(op);
    } catch (operationError) {
      setError(messageOf(operationError));
    }
    bump();
    refresh();
  }, [bump, refresh]);

  const redo = useCallback(async () => {
    const op = redoStackRef.current.pop();
    if (op === undefined) return;
    try {
      await op.forward();
      undoStackRef.current.push(op);
    } catch (operationError) {
      setError(messageOf(operationError));
    }
    bump();
    refresh();
  }, [bump, refresh]);

  return {
    phase,
    table,
    rows,
    nextCursor,
    error,
    insertRow,
    updateRow,
    updateRows,
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
  };
}

export { useDatabaseTable };
export type { DatabaseTableRow, DatabaseTablePhase };
