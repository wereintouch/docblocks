/**
 * The default in-memory `DatabaseBridge` (the dev / e2e mode): the
 * tables, the columns, and the rows live in the page's JS memory — a
 * page reload drops them. The cross-tab / cross-page propagation is a
 * `BroadcastChannel` echo of the same event stream (each page keeps its
 * own copy of the state and applies the remote events idempotently); a
 * production consumer replaces the whole bridge with its backend
 * implementation. The bridge speaks the standard fractional row order
 * (the `rowOrder` column value) and the table-derived row ids (the
 * `r-{tableId}-{n}` `id` pk value — the dict-table rows stand the pk
 * value itself (the option label as the row id)); the table id stands derived from the
 * table name, so the channel's instances converge on the same tables
 * (the two tabs' identically-named demo tables share one table).
 */
import type { DatabaseFilterPayload } from "docblocks-core";

import { TEXT_TYPES, conditionMatches } from "./bridge";
import type {
  BridgeColumn,
  BridgeTableDescription,
  DatabaseBridge,
  RowPage,
  RowQuery,
  TableEvent,
  TableRef,
} from "./bridge";

/** The fractional order step (the value between two rows is their mean). */
const ORDER_STEP = 1024;

/** The default page size. */
const DEFAULT_LIMIT = 200;

/** The package's pk / order column names (the describeTable defaults). */
const PK_COLUMN = "id";
const ROW_ORDER_COLUMN = "rowOrder";

interface MemoryTable {
  name: string;
  /** The system (hidden) table — absent from `listTables` (the enum's
   *  options' stand). */
  system?: boolean;
  columns: BridgeColumn[];
  /** row id (the pk value) → the cells. */
  rows: Map<string, Record<string, unknown>>;
  /** row id → the fractional order value. */
  orderValues: Map<string, number>;
  /** The removed rows (the soft-delete trash): row id → the saved state.
   *  The trash keeps every cell the row had — the detached column's
   *  values stand, so a column's restore covers the removed rows too. */
  trash: Map<string, { cells: Record<string, unknown>; orderValue: number }>;
  /** The soft-deleted columns (the `deleteColumn`'s preserved state):
   *  column id → the definition + the anchor position (the id of the
   *  column that stood BEFORE it, null = the first). The cell values are
   *  NOT cleared (they stay in the rows' / trash's objects, invisible
   *  without the schema), so the restore re-inserts the schema and the
   *  values are already in place. `createColumn` of the same id DROPS
   *  the entry (the fresh column stands empty — the old data is gone). */
  detachedColumns: Map<string, { column: BridgeColumn; prevColumnId: string | null }>;
  /** The row-id counter (the pk values are `r-{tableId}-1`, `r-{tableId}-2`, ...). */
  rowCounter: number;
}

interface MemoryBridgeOptions {
  /** The BroadcastChannel name (the default `"docblocks-database-bridge"`); pass a
   *  distinct name per test to isolate the event echo. */
  channelName?: string;
}

/**
 * Creates the in-memory bridge. Two bridges on the same page with the
 * same channel name share the table state through the event echo (each
 * applies the other's events idempotently).
 */
function createMemoryDatabaseBridge(options: MemoryBridgeOptions = {}): DatabaseBridge {
  const tables = new Map<string, MemoryTable>();
  const listeners = new Map<string, Set<(events: TableEvent[]) => void>>();
  const origin = Math.random().toString(36).slice(2);

  const channel: BroadcastChannel | null =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(options.channelName ?? "docblocks-database-bridge")
      : null;

  function notifyLocal(tableId: string, events: TableEvent[]): void {
    const set = listeners.get(tableId);
    if (set === undefined || events.length === 0) return;
    for (const listener of [...set]) listener(events);
  }

  /** The local mutation: the events go to the local listeners and out the channel. */
  function emit(tableId: string, events: TableEvent[]): void {
    if (events.length === 0) return;
    notifyLocal(tableId, events);
    channel?.postMessage({ origin, tableId, events });
  }

  /** The remote echo: apply to the local state idempotently, notify the local listeners, no re-broadcast. */
  function applyRemote(tableId: string, events: TableEvent[]): void {
    // A created table stands the local state first (the echo carries the
    // origin's table id, so the local copy stands under the SAME key the
    // origin's row / schema events address); an already-seeded local table
    // is left untouched (the concurrent seed stands its own state).
    for (const event of events) {
      if (event.type === "table.created" && !tables.has(tableId)) {
        tables.set(tableId, {
          name: event.name,
          system: event.system === true ? true : undefined,
          columns: clone(event.columns),
          rows: new Map(),
          orderValues: new Map(),
          trash: new Map(),
          detachedColumns: new Map(),
          rowCounter: 0,
        });
      }
    }
    const table = tables.get(tableId);
    if (table !== undefined) applyEvents(tableId, table, events);
    notifyLocal(tableId, events);
  }

  channel?.addEventListener("message", (message: MessageEvent) => {
    const data = message.data as { origin?: string; tableId?: string; events?: TableEvent[] } | null;
    if (
      data === null ||
      typeof data !== "object" ||
      data.origin === origin ||
      typeof data.tableId !== "string" ||
      !Array.isArray(data.events)
    )
      return;
    applyRemote(data.tableId, data.events);
  });

  function tableOf(tableId: string): MemoryTable {
    const table = tables.get(tableId);
    if (table === undefined) throw new Error(`Unknown table "${tableId}".`);
    return table;
  }

  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function deepEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    const keysA = Object.keys(a as Record<string, unknown>);
    const keysB = Object.keys(b as Record<string, unknown>);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }

  function orderedRowIds(table: MemoryTable): string[] {
    return [...table.rows.keys()].sort((a, b) => (table.orderValues.get(a) ?? 0) - (table.orderValues.get(b) ?? 0));
  }

  function nextOrder(table: MemoryTable): number {
    let max = 0;
    for (const value of table.orderValues.values()) max = Math.max(max, value);
    return max + ORDER_STEP;
  }

  /** The idempotent event application (the remote echo path). */
  function applyEvents(tableId: string, table: MemoryTable, events: TableEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case "table.renamed": {
          table.name = event.name;
          break;
        }
        case "row.created": {
          if (!table.rows.has(event.rowId)) {
            table.rows.set(event.rowId, clone(event.cells));
            if (!table.orderValues.has(event.rowId)) table.orderValues.set(event.rowId, nextOrder(table));
          }
          // The peer's row id stands the shared per-table counter: advance
          // the local one so the next local insert never reuses a taken id.
          table.rowCounter = Math.max(table.rowCounter, rowCounterOf(tableId, event.rowId));
          break;
        }
        case "row.updated": {
          const row = table.rows.get(event.rowId);
          if (row === undefined) break;
          for (const [key, value] of Object.entries(event.cells)) {
            if (value === null) {
              if (key in row) delete row[key];
            } else if (!deepEqual(row[key], value)) {
              row[key] = clone(value);
            }
          }
          break;
        }
        case "row.removed": {
          const row = table.rows.get(event.rowId);
          if (row !== undefined) {
            table.trash.set(event.rowId, {
              cells: clone(row),
              orderValue: table.orderValues.get(event.rowId) ?? nextOrder(table),
            });
            table.rows.delete(event.rowId);
            table.orderValues.delete(event.rowId);
          }
          break;
        }
        case "row.moved": {
          const current = table.orderValues.get(event.rowId);
          if (current === undefined) break;
          moveOrder(table, event.rowId, event.beforeRowId);
          break;
        }
        case "schema.changed": {
          table.columns = clone(event.columns);
          break;
        }
      }
    }
  }

  /** Recomputes the row's order value before `beforeRowId` (null = the end). */
  function moveOrder(table: MemoryTable, rowId: string, beforeRowId: string | null): void {
    let value: number;
    if (beforeRowId === null) {
      value = nextOrder(table);
    } else {
      const beforeValue = table.orderValues.get(beforeRowId);
      if (beforeValue === undefined) return; // the before row vanished: stand where it was last known
      const beforeIds = orderedRowIds(table).filter(
        (id) => id !== rowId && (table.orderValues.get(id) ?? 0) < beforeValue
      );
      const prevId = beforeIds.length > 0 ? beforeIds[beforeIds.length - 1] : undefined;
      const prevValue = prevId !== undefined ? (table.orderValues.get(prevId) ?? 0) : undefined;
      value = prevValue !== undefined ? (prevValue + beforeValue) / 2 : beforeValue - ORDER_STEP;
    }
    table.orderValues.set(rowId, value);
  }

  function payloadMatches(payload: DatabaseFilterPayload, cells: Record<string, unknown>): boolean {
    const items: boolean[] = payload.conditions.map((condition) =>
      conditionMatches(condition.op, cells[condition.columnId], condition.value)
    );
    for (const group of payload.groups ?? []) items.push(payloadMatches(group, cells));
    if (items.length === 0) return true;
    return payload.logic === "and" ? items.every(Boolean) : items.some(Boolean);
  }

  function compareRows(table: MemoryTable, a: string, b: string, orderBy: string[]): number {
    const cellsA = table.rows.get(a) ?? {};
    const cellsB = table.rows.get(b) ?? {};
    for (const key of orderBy) {
      const descending = key.startsWith("-");
      const columnId = descending ? key.slice(1) : key;
      const va = cellsA[columnId];
      const vb = cellsB[columnId];
      let result: number;
      if (typeof va === "number" && typeof vb === "number") result = va - vb;
      else if (typeof va === "boolean" && typeof vb === "boolean") result = Number(va) - Number(vb);
      else result = String(va ?? "").localeCompare(String(vb ?? ""));
      if (result !== 0) return descending ? -result : result;
    }
    return 0; // the stable fallback is the row order (the query applies it after)
  }

  const bridge: DatabaseBridge = {
    async listTables(): Promise<TableRef[]> {
      return [...tables.entries()]
        .filter(([, table]) => table.system !== true)
        .map(([id, table]) => ({ id, name: table.name }));
    },

    async createTable(name: string, options?: { system?: boolean; id?: string }): Promise<string> {
      // The id stands the explicit `options.id` when given (the restore /
      // import stand — the table's identity is fixed independently of the
      // name, so a rename / a re-creation keeps the same id and the doc's
      // `tableId` references survive); absent, the id stands derived from
      // the name (deterministic across the channel's instances: the two
      // tabs' identically-named tables share one table — the demo-seed
      // contract). An existing table of the id (the local seed, the peer's
      // created echo, or the explicit-id restore) is adopted as-is.
      const id = options?.id ?? tableIdFor(name);
      if (tables.has(id)) return id;
      tables.set(id, {
        name,
        system: options?.system === true ? true : undefined,
        columns: [],
        rows: new Map(),
        orderValues: new Map(),
        trash: new Map(),
        detachedColumns: new Map(),
        rowCounter: 0,
      });
      emit(id, [
        { type: "table.created", tableId: id, name, columns: [], system: options?.system === true ? true : undefined },
      ]);
      return id;
    },

    async renameTable(tableId: string, name: string): Promise<void> {
      const table = tableOf(tableId);
      if (table.name === name) return;
      table.name = name;
      emit(tableId, [{ type: "table.renamed", name }]);
    },

    async describeTable(tableId: string): Promise<BridgeTableDescription> {
      const table = tableOf(tableId);
      return { name: table.name, columns: clone(table.columns), pkId: PK_COLUMN, rowOrderId: ROW_ORDER_COLUMN };
    },

    async createColumn(tableId: string, column: BridgeColumn, afterColumnId?: string): Promise<void> {
      const table = tableOf(tableId);
      if (table.columns.some((existing) => existing.id === column.id)) {
        throw new Error(`The column "${column.id}" already exists in table "${tableId}".`);
      }
      // The soft-delete's re-creation: a fresh column of the deleted
      // column's id DROPS the detached data (the old values stand cleared
      // — the live rows over the row.updated nulls, the trash's copy is
      // dropped locally; the remote's trash keeps no read API).
      const events: TableEvent[] = [];
      if (table.detachedColumns.delete(column.id)) {
        for (const [rowId, row] of table.rows) {
          if (column.id in row) {
            delete row[column.id];
            events.push({ type: "row.updated", rowId, cells: { [column.id]: null }, before: {} });
          }
        }
        for (const entry of table.trash.values()) delete entry.cells[column.id];
      }
      const at =
        afterColumnId === undefined
          ? table.columns.length
          : table.columns.findIndex((existing) => existing.id === afterColumnId);
      if (afterColumnId !== undefined && at === -1)
        throw new Error(`Unknown column "${afterColumnId}" in table "${tableId}".`);
      table.columns.splice(at, 0, clone(column));
      emit(tableId, [...events, { type: "schema.changed", columns: clone(table.columns) }]);
    },

    async deleteColumn(tableId: string, columnId: string): Promise<void> {
      const table = tableOf(tableId);
      const at = table.columns.findIndex((existing) => existing.id === columnId);
      if (at === -1) throw new Error(`Unknown column "${columnId}" in table "${tableId}".`);
      // The soft delete: the definition + the anchor position stand
      // preserved (the restore re-inserts the schema at the anchor), the
      // cell values stay in the rows' objects (invisible without the
      // schema) — the restore therefore covers every row, the loaded
      // pages' and the removed ones alike.
      const column = table.columns[at]!;
      table.detachedColumns.set(columnId, {
        column: clone(column),
        prevColumnId: at > 0 ? table.columns[at - 1]!.id : null,
      });
      table.columns.splice(at, 1);
      emit(tableId, [{ type: "schema.changed", columns: clone(table.columns) }]);
    },

    async restoreDeletedColumn(tableId: string, columnId: string): Promise<void> {
      const table = tableOf(tableId);
      // The column stands in the schema again (the re-creation dropped the
      // detached data) — the restore stands a no-op.
      if (table.columns.some((existing) => existing.id === columnId)) return;
      const detached = table.detachedColumns.get(columnId);
      if (detached === undefined) throw new Error(`No deleted column "${columnId}" to restore in table "${tableId}".`);
      table.detachedColumns.delete(columnId);
      // The anchor position: the deleted stand's `null` anchor = the column
      // stood first (the restore stands it at the head); a living anchor
      // column = after it; a vanished anchor column = the end fallback.
      let at: number;
      if (detached.prevColumnId === null) {
        at = 0;
      } else {
        const anchorIndex = table.columns.findIndex((existing) => existing.id === detached.prevColumnId);
        at = anchorIndex === -1 ? table.columns.length : anchorIndex + 1;
      }
      table.columns.splice(at, 0, clone(detached.column));
      emit(tableId, [{ type: "schema.changed", columns: clone(table.columns) }]);
    },

    async renameColumn(tableId: string, columnId: string, name: string): Promise<void> {
      const table = tableOf(tableId);
      const column = table.columns.find((existing) => existing.id === columnId);
      if (column === undefined) throw new Error(`Unknown column "${columnId}" in table "${tableId}".`);
      column.name = name;
      emit(tableId, [{ type: "schema.changed", columns: clone(table.columns) }]);
    },

    async updateColumn(
      tableId: string,
      columnId: string,
      patch: Partial<Omit<BridgeColumn, "id" | "name">>
    ): Promise<void> {
      const table = tableOf(tableId);
      const column = table.columns.find((existing) => existing.id === columnId);
      if (column === undefined) throw new Error(`Unknown column "${columnId}" in table "${tableId}".`);
      // The patch never removes an attribute: the undefined entries stand
      // skipped, the existing attributes keep.
      let changed = false;
      for (const [key, value] of Object.entries(patch)) {
        if (key === "id" || key === "name" || value === undefined) continue;
        (column as unknown as Record<string, unknown>)[key] = clone(value);
        changed = true;
      }
      if (!changed) return; // the zero-change no-op
      emit(tableId, [{ type: "schema.changed", columns: clone(table.columns) }]);
    },

    async resolveRowDisplay(
      tableId: string,
      rowIds: string[],
      displayColumn?: string
    ): Promise<Record<string, string>> {
      const table = tableOf(tableId);
      // The display column: the declared one (when it stands a column of
      // the table), else the first text column, else the first column /
      // the pk fallback.
      let column =
        displayColumn !== undefined ? table.columns.find((existing) => existing.id === displayColumn) : undefined;
      if (column === undefined) {
        column = table.columns.find((existing) => TEXT_TYPES.has(existing.type)) ??
          table.columns[0] ?? {
            id: PK_COLUMN,
            name: PK_COLUMN,
            type: "text",
          };
      }
      const displays: Record<string, string> = {};
      for (const rowId of rowIds) {
        const row = table.rows.get(rowId);
        if (row === undefined) {
          displays[rowId] = "";
          continue;
        }
        const value = row[column.id];
        displays[rowId] = value === undefined || value === null || value === "" ? rowId : String(value);
      }
      return displays;
    },

    async queryRows(tableId: string, query: RowQuery): Promise<RowPage> {
      const table = tableOf(tableId);
      let ids = orderedRowIds(table);
      if (query.filter !== undefined) ids = ids.filter((id) => payloadMatches(query.filter!, table.rows.get(id) ?? {}));
      if (query.orderBy !== undefined && query.orderBy.length > 0) {
        ids = [...ids].sort((a, b) => {
          const compared = compareRows(table, a, b, query.orderBy!);
          return compared !== 0 ? compared : (table.orderValues.get(a) ?? 0) - (table.orderValues.get(b) ?? 0);
        });
      }
      const start = query.cursor !== undefined ? decodeCursor(query.cursor) : 0;
      const limit = query.limit ?? DEFAULT_LIMIT;
      const page = ids.slice(start, start + limit);
      const rows: Record<string, Record<string, unknown>> = {};
      for (const id of page) rows[id] = clone(table.rows.get(id) ?? {});
      const nextCursor = start + limit < ids.length ? encodeCursor(start + limit) : null;
      return { rows, nextCursor };
    },

    async insertRow(tableId: string, row: Record<string, unknown>): Promise<string> {
      const table = tableOf(tableId);
      // The row id stands derived from the table + the per-table counter
      // (deterministic over the channel's instances: the seeded demo rows
      // stand the same ids on both sides; the counter syncs over the
      // echoes). A pk value IN the row stands the dict-table stand (the
      // pk IS the value — the option label): the row id = the pk value
      // (the deterministic stand across the channel's instances).
      const pkValue = row[PK_COLUMN];
      const rowId = typeof pkValue === "string" && pkValue !== "" ? pkValue : `r-${tableId}-${++table.rowCounter}`;
      if (table.rows.has(rowId)) return rowId; // the idempotent re-seed
      table.rows.set(rowId, clone(stripManaged(row)));
      table.orderValues.set(rowId, nextOrder(table));
      emit(tableId, [{ type: "row.created", rowId, cells: clone(table.rows.get(rowId) ?? {}) }]);
      return rowId;
    },

    async updateRow(tableId: string, rowId: string, cells: Record<string, unknown>): Promise<void> {
      const table = tableOf(tableId);
      const row = table.rows.get(rowId);
      if (row === undefined) throw new Error(`Unknown row "${rowId}" of table "${tableId}".`);
      const patch: Record<string, unknown> = {};
      const before: Record<string, unknown> = {};
      applyCells(row, cells, patch, before);
      if (Object.keys(patch).length === 0) return; // the zero-change no-op
      emit(tableId, [{ type: "row.updated", rowId, cells: clone(patch), before: clone(before) }]);
    },

    async removeRow(tableId: string, rowId: string): Promise<void> {
      const table = tableOf(tableId);
      if (!table.rows.has(rowId)) throw new Error(`Unknown row "${rowId}" of table "${tableId}".`);
      emit(tableId, [{ type: "row.removed", rowId }]);
      applyEvents(tableId, table, [{ type: "row.removed", rowId }]);
    },

    async undeleteRows(tableId: string, rowIds: string[]): Promise<void> {
      const table = tableOf(tableId);
      for (const rowId of rowIds) {
        const entry = table.trash.get(rowId);
        if (entry === undefined || table.rows.has(rowId)) continue;
        table.rows.set(rowId, clone(entry.cells));
        table.orderValues.set(rowId, entry.orderValue);
        table.trash.delete(rowId);
      }
    },

    async insertRows(tableId: string, rows: Record<string, unknown>[]): Promise<string[]> {
      const table = tableOf(tableId);
      const created: TableEvent[] = [];
      const ids: string[] = [];
      for (const row of rows) {
        // The pk-value row stand (the dict table's label rows) — the same
        // stand as the single insertRow.
        const pkValue = row[PK_COLUMN];
        const rowId = typeof pkValue === "string" && pkValue !== "" ? pkValue : `r-${tableId}-${++table.rowCounter}`;
        if (table.rows.has(rowId)) {
          ids.push(rowId);
          continue;
        }
        table.rows.set(rowId, clone(stripManaged(row)));
        table.orderValues.set(rowId, nextOrder(table));
        created.push({ type: "row.created", rowId, cells: clone(table.rows.get(rowId) ?? {}) });
        ids.push(rowId);
      }
      emit(tableId, created);
      return ids;
    },

    async updateRows(tableId: string, rows: ({ rowId: string } & Record<string, unknown>)[]): Promise<void> {
      const table = tableOf(tableId);
      const events: TableEvent[] = [];
      for (const entry of rows) {
        const { rowId, ...cells } = entry;
        const row = table.rows.get(rowId);
        if (row === undefined) continue;
        const patch: Record<string, unknown> = {};
        const before: Record<string, unknown> = {};
        applyCells(row, cells, patch, before);
        if (Object.keys(patch).length > 0)
          events.push({ type: "row.updated", rowId, cells: clone(patch), before: clone(before) });
      }
      emit(tableId, events);
    },

    async removeRows(tableId: string, rowIds: string[]): Promise<void> {
      const table = tableOf(tableId);
      const events: TableEvent[] = rowIds
        .filter((rowId) => table.rows.has(rowId))
        .map((rowId) => ({
          type: "row.removed",
          rowId,
        }));
      emit(tableId, events);
      applyEvents(tableId, table, events);
    },

    async moveRow(tableId: string, rowId: string, beforeRowId: string | null): Promise<void> {
      const table = tableOf(tableId);
      if (!table.rows.has(rowId)) throw new Error(`Unknown row "${rowId}" of table "${tableId}".`);
      if (beforeRowId !== null && !table.orderValues.has(beforeRowId)) {
        throw new Error(`Unknown before row "${beforeRowId}" of table "${tableId}".`);
      }
      moveOrder(table, rowId, beforeRowId);
      emit(tableId, [{ type: "row.moved", rowId, beforeRowId }]);
    },

    subscribeTable(tableId: string, onEvents: (events: TableEvent[]) => void): () => void {
      let set = listeners.get(tableId);
      if (set === undefined) {
        set = new Set();
        listeners.set(tableId, set);
      }
      set.add(onEvents);
      return () => {
        set!.delete(onEvents);
      };
    },
  };

  return bridge;

  /** The cells write: null clears the cell, `undefined` is skipped, the equal value is a no-op. */
  function applyCells(
    row: Record<string, unknown>,
    cells: Record<string, unknown>,
    patch: Record<string, unknown>,
    before: Record<string, unknown>
  ): void {
    for (const [key, value] of Object.entries(cells)) {
      if (value === undefined || key === PK_COLUMN || key === ROW_ORDER_COLUMN) continue;
      if (value === null) {
        if (key in row) {
          before[key] = row[key];
          delete row[key];
          patch[key] = null;
        }
        continue;
      }
      if (!deepEqual(row[key], value)) {
        before[key] = row[key];
        row[key] = clone(value);
        patch[key] = value;
      }
    }
  }
}

/** The pk / the order column are bridge-managed: they are not cell data. */
function stripManaged(row: Record<string, unknown>): Record<string, unknown> {
  const cells: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === PK_COLUMN || key === ROW_ORDER_COLUMN) continue;
    cells[key] = value;
  }
  return cells;
}

/** The table id derived from the name (deterministic across the channel's instances). */
function tableIdFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `table-${slug || Math.random().toString(36).slice(2, 8)}`;
}

/** The counter carried by the row id (`r-{tableId}-{n}`). */
function rowCounterOf(tableId: string, rowId: string): number {
  const prefix = `r-${tableId}-`;
  if (!rowId.startsWith(prefix)) return 0;
  const n = Number(rowId.slice(prefix.length));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function encodeCursor(index: number): string {
  return `i${index}`;
}

function decodeCursor(cursor: string): number {
  const parsed = Number(cursor.slice(1));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/** The shared per-page default bridge (the `databaseBridge` prop fallback). */
let defaultBridge: DatabaseBridge | null = null;

/** The per-page default bridge (created lazily, shared by all the panes of the page). */
function getDefaultDatabaseBridge(): DatabaseBridge {
  if (defaultBridge === null) defaultBridge = createMemoryDatabaseBridge();
  return defaultBridge;
}

export { createMemoryDatabaseBridge, getDefaultDatabaseBridge };
export type { MemoryBridgeOptions };
