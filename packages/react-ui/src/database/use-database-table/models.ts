/**
 * The database table hook's types: the loaded row, the load phase, the undo
 * stack entry (the operation's two directions), and the hook's public result
 * (the grid renderer + the consumer UI read from it).
 */
import type { BridgeColumn, BridgeTableDescription } from "../bridge";

/** One loaded row: the row id (the pk value) + the cells. */
interface DatabaseTableRow {
  rowId: string;
  cells: Record<string, unknown>;
}

type DatabaseTablePhase = "loading" | "ready" | "broken";

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

export type { DatabaseTableRow, DatabaseTablePhase, InverseOp, UseDatabaseTable };
