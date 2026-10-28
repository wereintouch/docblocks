/**
 * The playground's persistent database bridge (harness-only): the package's
 * default in-memory bridge over a localStorage snapshot — the harness's
 * tables / columns / rows survive the tab's reload (the package's default
 * stands memory-only; the consumer's own backend persists on its side).
 *
 * The snapshot keeps the table's stable id (independent of the name — the
 * reload's restore re-creates the table under its original id, so a rename
 * and the doc's `tableId` references survive), the table names, the column
 * schema, and the rows in the row order (the row ids stand the pk-value
 * insertion, so the row-link cells survive). The soft-delete trash stands no
 * read API and is not captured.
 */
import { getDefaultDatabaseBridge } from "docblocks-react-ui";
import type { BridgeColumn, DatabaseBridge } from "docblocks-react-ui";

const STORAGE_KEY = "docblocks-playground-bridge-v1";

/** The save's debounce window: a mutation stands the snapshot within it
 * (a reload inside the window loses the very last mutation — the harness
 * trade-off over a save per keystroke). */
const SAVE_DEBOUNCE_MS = 150;

interface SnapshotTable {
  /** The table's stable id (the restore's identity — the doc's `tableId`
   *  references depend on it surviving a rename + reload). Absent on the
   *  legacy snapshots (the pre-id format — the seed falls back to the name's
   *  deterministic slug there). */
  id?: string;
  name: string;
  /** The system (hidden) table's stand (the enum's options — the
   *  `listTables` stands it out, so the snapshot names it explicitly). */
  system?: boolean;
  columns: BridgeColumn[];
  rows: { id: string; cells: Record<string, unknown> }[];
}

interface Snapshot {
  tables: SnapshotTable[];
}

function loadSnapshot(): Snapshot | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Snapshot;
    return parsed !== null && typeof parsed === "object" && Array.isArray(parsed.tables) ? parsed : null;
  } catch {
    return null;
  }
}

/** The full state re-read over the public API (the snapshot's source; the
 *  system tables stand over the `systemTableIds`' set — the `listTables`
 *  stands them out). */
async function snapshotOf(bridge: DatabaseBridge): Promise<Snapshot> {
  const tables: SnapshotTable[] = [];
  const refs = [...(await bridge.listTables()), ...[...systemTableIds].map((id) => ({ id, name: id }))];
  for (const ref of refs) {
    const description = await bridge.describeTable(ref.id);
    const rows: SnapshotTable["rows"] = [];
    let cursor: string | undefined;
    do {
      const page = await bridge.queryRows(ref.id, { cursor, limit: 1_000 });
      for (const rowId of Object.keys(page.rows)) {
        rows.push({ id: rowId, cells: page.rows[rowId] ?? {} });
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    tables.push({
      id: ref.id,
      name: description.name,
      system: systemTableIds.has(ref.id) ? true : undefined,
      columns: description.columns,
      rows,
    });
  }
  return { tables };
}

/** The snapshot's seed (the reload's restore): the tables / columns / rows
 * stand over the memory bridge before any consumer read. The duplicate
 * column create stands a concurrent seeder (the peer tab's echo over the
 * shared channel) already stood the column — the error is the adoption. */
function seed(bridge: DatabaseBridge, snapshot: Snapshot): Promise<void> {
  return (async () => {
    for (const table of snapshot.tables) {
      // The explicit id (the new snapshot format) restores the table under
      // its original identity (a rename + reload keeps the doc's `tableId`
      // references); the legacy snapshots (no id) stand the name's
      // deterministic slug (the pre-id behavior).
      const options = { system: table.system === true ? true : undefined, id: table.id };
      const id = await bridge.createTable(
        table.name,
        table.id !== undefined || table.system === true ? options : undefined
      );
      if (table.system === true) systemTableIds.add(id);
      for (const column of table.columns) {
        try {
          await bridge.createColumn(id, column);
        } catch {
          // The adoption stand (see the head note).
        }
      }
      if (table.rows.length > 0) {
        // The pk-value insertion: the row's own id stands the row's identity
        // (the row-link cells reference the ids).
        await bridge.insertRows(
          id,
          table.rows.map((row) => ({ id: row.id, ...row.cells }))
        );
      }
    }
  })();
}

let seedPromise: Promise<void> | null = null;

/** The system tables' ids (the `listTables` stands them out — the
 *  snapshot names them over this set; the seed restores the flag, the
 *  create records the fresh id). */
const systemTableIds = new Set<string>();

/** The seed's readiness (the harness's table seed awaits it: the guard
 * reads the snapshot's tables, not the empty bridge). */
export function databaseBridgeReady(): Promise<void> {
  if (seedPromise === null) {
    const snapshot = loadSnapshot();
    seedPromise = snapshot !== null ? seed(getDefaultDatabaseBridge(), snapshot) : Promise.resolve();
  }
  return seedPromise;
}

let saveTimer: number | null = null;
let saveInFlight = false;
let dirty = false;

async function flushSave(): Promise<void> {
  if (saveInFlight) return;
  saveInFlight = true;
  try {
    const bridge = getDefaultDatabaseBridge();
    // The re-save loop: a mutation inside the save stands a second pass
    // (the saved state is always at least as fresh as the last mutation
    // before the save's start).
    while (dirty) {
      dirty = false;
      const snapshot = await snapshotOf(bridge);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        // The storage's refusal (quota / private mode) stands the
        // memory-only stand (no throw over the mutation).
      }
    }
  } finally {
    saveInFlight = false;
  }
}

function scheduleSave(): void {
  dirty = true;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void flushSave();
  }, SAVE_DEBOUNCE_MS);
}

/** The wrapped bridge: every read stands the seed first (the consumer
 * never sees the bridge pre-restore), every mutation schedules the
 * snapshot's save. */
export const persistentDatabaseBridge: DatabaseBridge = {
  listTables: () => databaseBridgeReady().then(() => getDefaultDatabaseBridge().listTables()),
  createTable: (name, options) =>
    databaseBridgeReady().then(async () => {
      const id = await getDefaultDatabaseBridge().createTable(name, options);
      if (options?.system === true) systemTableIds.add(id);
      scheduleSave();
      return id;
    }),
  renameTable: (tableId, name) =>
    databaseBridgeReady().then(async () => {
      await getDefaultDatabaseBridge().renameTable(tableId, name);
      scheduleSave();
    }),
  describeTable: (tableId) => databaseBridgeReady().then(() => getDefaultDatabaseBridge().describeTable(tableId)),
  createColumn: (tableId, column, afterColumnId) =>
    databaseBridgeReady().then(async () => {
      await getDefaultDatabaseBridge().createColumn(tableId, column, afterColumnId);
      scheduleSave();
    }),
  updateColumn: (tableId, columnId, patch) =>
    databaseBridgeReady().then(async () => {
      await getDefaultDatabaseBridge().updateColumn(tableId, columnId, patch);
      scheduleSave();
    }),
  resolveRowDisplay: (tableId, rowIds, displayColumn) =>
    databaseBridgeReady().then(() => getDefaultDatabaseBridge().resolveRowDisplay(tableId, rowIds, displayColumn)),
  deleteColumn: (tableId, columnId) =>
    databaseBridgeReady().then(async () => {
      await getDefaultDatabaseBridge().deleteColumn(tableId, columnId);
      scheduleSave();
    }),
  restoreDeletedColumn: (tableId, columnId) =>
    databaseBridgeReady().then(async () => {
      await getDefaultDatabaseBridge().restoreDeletedColumn!(tableId, columnId);
      scheduleSave();
    }),
  renameColumn: (tableId, columnId, name) =>
    databaseBridgeReady().then(async () => {
      await getDefaultDatabaseBridge().renameColumn(tableId, columnId, name);
      scheduleSave();
    }),
  queryRows: (tableId, query) => databaseBridgeReady().then(() => getDefaultDatabaseBridge().queryRows(tableId, query)),
  insertRow: (tableId, row) =>
    databaseBridgeReady().then(async () => {
      const id = await getDefaultDatabaseBridge().insertRow(tableId, row);
      scheduleSave();
      return id;
    }),
  updateRow: (tableId, rowId, cells) =>
    databaseBridgeReady().then(async () => {
      await getDefaultDatabaseBridge().updateRow(tableId, rowId, cells);
      scheduleSave();
    }),
  removeRow: (tableId, rowId) =>
    databaseBridgeReady().then(async () => {
      await getDefaultDatabaseBridge().removeRow(tableId, rowId);
      scheduleSave();
    }),
  undeleteRows: (tableId, rowIds) =>
    databaseBridgeReady().then(async () => {
      await getDefaultDatabaseBridge().undeleteRows?.(tableId, rowIds);
      scheduleSave();
    }),
  insertRows: (tableId, rows) =>
    databaseBridgeReady().then(async () => {
      const ids = await getDefaultDatabaseBridge().insertRows(tableId, rows);
      scheduleSave();
      return ids;
    }),
  updateRows: (tableId, rows) =>
    databaseBridgeReady().then(async () => {
      await getDefaultDatabaseBridge().updateRows(tableId, rows);
      scheduleSave();
    }),
  removeRows: (tableId, rowIds) =>
    databaseBridgeReady().then(async () => {
      await getDefaultDatabaseBridge().removeRows(tableId, rowIds);
      scheduleSave();
    }),
  moveRow: (tableId, rowId, beforeRowId) =>
    databaseBridgeReady().then(async () => {
      await getDefaultDatabaseBridge().moveRow(tableId, rowId, beforeRowId);
      scheduleSave();
    }),
  // The subscription stands the seed-less passthrough (the events flow
  // over the base bridge regardless of the restore).
  subscribeTable: (tableId, onEvents) => getDefaultDatabaseBridge().subscribeTable(tableId, onEvents),
};
