/**
 * The playground's persistent database bridge (harness-only): the harness's
 * in-memory bridge (the consumer's own stand of the `DatabaseBridge`
 * contract) over a localStorage snapshot — the harness's tables / columns /
 * rows survive the tab's reload (the memory bridge stands memory-only; a
 * real consumer's backend persists on its side).
 *
 * The snapshot keeps each table's stable id (independent of the name — the
 * reload's restore re-creates the table under its original id, so a rename
 * and the doc's `tableId` references survive), the table's current name,
 * the live column schema (in the schema order), and the live rows in the
 * visible order (the `RowWire`'s cells are keyed by the column id, the row
 * order by the bridge's physical order key). The generated ids
 * (`c-<tableId>-N` / `r-<tableId>-N`) are restored exactly: the restore
 * advances the bridge's allocation counters with throwaway create + delete
 * pairs, so a deleted column / row stands no shift of the surviving ids
 * (the cells are keyed by the column id, the row-link cells reference the
 * row ids). The soft-delete trash and the envelope stream stand no capture.
 */
import { newMutationContext } from "docblocks-react-ui";
import type { BatchOp, CellMap, Column, DatabaseBridge, RowWire, TableRef } from "docblocks-react-ui";

import { createMemoryDatabaseBridge } from "./memory-bridge";
import type { MemoryDatabaseBridge } from "./memory-bridge";

/** The harness's shared in-memory bridge (the demo consumer's stand): a
 *  single instance shared by all the panes of the page (the panes sync
 *  over the bridge's own subscription, not over a per-pane instance). */
let memoryBridge: MemoryDatabaseBridge | null = null;
function bridge(): MemoryDatabaseBridge {
  if (memoryBridge === null) memoryBridge = createMemoryDatabaseBridge();
  return memoryBridge;
}

const STORAGE_KEY = "docblocks-playground-bridge-v2";

/** The save's debounce window: a mutation stands the snapshot within it
 * (a reload inside the window loses the very last mutation — the harness
 * trade-off over a save per keystroke). */
const SAVE_DEBOUNCE_MS = 150;

interface SnapshotTable {
  /** The table's stable id (the restore's identity — the doc's `tableId`
   *  references depend on it surviving a rename + reload). */
  id: string;
  name: string;
  /** The system (hidden) table's stand (the enum's options — the
   *  `listTables` stands it out, so the snapshot names it explicitly). */
  system?: boolean;
  columns: Column[];
  rows: RowWire[];
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

/** The generated id's sequence over the `c-<tableId>-N` / `r-<tableId>-N`
 * allocation (null = an id outside the reference bridge's pattern). */
function generatedSeq(tableId: string, kind: "c" | "r", id: string): number | null {
  const prefix = `${kind}-${tableId}-`;
  if (!id.startsWith(prefix)) return null;
  const seq = Number(id.slice(prefix.length));
  return Number.isInteger(seq) && seq > 0 ? seq : null;
}

/** The column's create spec (the wire `Column` minus the bridge-owned
 * `id` / `revision`). */
function columnSpecOf(column: Column): Omit<Column, "id" | "revision"> {
  return {
    name: column.name,
    type: column.type,
    position: column.position,
    nullable: column.nullable,
    ...(column.operators !== undefined ? { operators: [...column.operators] } : {}),
    ...(column.reference !== undefined ? { reference: { ...column.reference } } : {}),
    ...(column.numberDisplay !== undefined ? { numberDisplay: { ...column.numberDisplay } } : {}),
  };
}

/** The restore's table order: a referenced table stands before its
 * referencer (the column's reference validation requires the linked
 * table's presence); a cycle keeps the snapshot's order. */
function restoreOrder(tables: SnapshotTable[]): SnapshotTable[] {
  const byId = new Map(tables.map((table) => [table.id, table]));
  const placed = new Set<string>();
  const out: SnapshotTable[] = [];
  const visit = (table: SnapshotTable, chain: Set<string>): void => {
    if (placed.has(table.id) || chain.has(table.id)) return;
    chain.add(table.id);
    for (const column of table.columns) {
      const refTableId = column.reference?.tableId;
      if (refTableId !== undefined) {
        const linked = byId.get(refTableId);
        if (linked !== undefined) visit(linked, chain);
      }
    }
    chain.delete(table.id);
    placed.add(table.id);
    out.push(table);
  };
  for (const table of tables) visit(table, new Set());
  return out;
}

/** The full state re-read over the public API (the snapshot's source; the
 * system tables stand over the `systemTableIds`' set — the `listTables`
 * stands them out, so the snapshot names them explicitly). */
async function snapshotOf(bridge: DatabaseBridge): Promise<Snapshot> {
  const limit = (await bridge.describeProtocol()).limits.maxPageSize;
  const refs: TableRef[] = [
    ...(await bridge.listTables()),
    ...[...systemTableIds].map((id) => ({ id, name: id, revision: "" })),
  ];
  const tables: SnapshotTable[] = [];
  for (const ref of refs) {
    let snapshot = await bridge.snapshotTable(ref.id, { limit });
    // The keyset cursor's continuation (a commit during the save stands the
    // cursor's expiry — the failure rejects the save's pass, the next
    // mutation re-saves).
    while (snapshot.page.nextCursor !== null) {
      const cursor = snapshot.page.nextCursor;
      const page = await bridge.queryNextPage(ref.id, {
        cursor,
        asOfSeq: snapshot.page.asOfSeq,
        queryFingerprint: snapshot.page.queryFingerprint,
      });
      snapshot = {
        ...snapshot,
        page: {
          ...snapshot.page,
          rows: [...snapshot.page.rows, ...page.rows],
          nextCursor: page.nextCursor,
        },
      };
    }
    tables.push({
      id: snapshot.table.id,
      name: snapshot.table.name,
      ...(snapshot.table.system === true ? { system: true } : {}),
      columns: snapshot.columns,
      rows: snapshot.page.rows,
    });
  }
  return { tables };
}

/** The column / row restore over the bridge's generated id's counter: a
 * throwaway create + delete pair advances the allocation by one (the
 * throwaway stands soft-deleted — invisible over the live schema / page,
 * the stream is not captured). The caller passes the bridge's allocated
 * counter (the last allocated sequence, 0 over a fresh table) and the
 * target's sequence minus one. */
async function padColumns(bridge: DatabaseBridge, tableId: string, current: number, target: number): Promise<void> {
  for (let pad = current; pad < target; pad += 1) {
    const dummy = await bridge.createColumn(
      tableId,
      { column: { name: "tmp", type: "text", position: 0, nullable: true } },
      newMutationContext()
    );
    await bridge.deleteColumn(tableId, dummy.result.id, newMutationContext());
  }
}

async function padRows(bridge: DatabaseBridge, tableId: string, current: number, target: number): Promise<void> {
  const dummies = target - current;
  if (dummies <= 0) return;
  const ops: BatchOp[] = [];
  for (let i = 0; i < dummies; i += 1) ops.push({ op: "create", row: {}, beforeRowId: null });
  const dummyReceipt = await bridge.batchRows(tableId, { ops }, newMutationContext());
  const dummyIds = dummyReceipt.result.rows.map((row) => row.id);
  const deletes: BatchOp[] = dummyIds.map((rowId) => ({ op: "delete", rowId }));
  await bridge.batchRows(tableId, { ops: deletes }, newMutationContext());
}

/** The snapshot's seed (the reload's restore): the tables / columns / rows
 * stand over the memory bridge before any consumer read. The reference
 * bridge derives the table id from the name's slug, so the table is
 * created under the slug the saved id implies and then renamed to the
 * saved name (the rename's stand over the create's id). The generated
 * column / row ids are restored over the counter's padding (see
 * `padColumns` / `padRows`); the rows are re-created in the saved visible
 * order (the append's stand keeps it), and a cell over a since-deleted
 * column is dropped (the column's soft-delete posture stands no capture). */
function seed(bridge: DatabaseBridge, snapshot: Snapshot): Promise<void> {
  return (async () => {
    for (const table of restoreOrder(snapshot.tables)) {
      try {
        // The slug name the saved id implies (the `table-` prefix's stand);
        // a malformed id stands the saved name (the fresh derivation's
        // best-effort stand).
        const slug = table.id.startsWith("table-") ? table.id.slice("table-".length) : table.name;
        const receipt = await bridge.createTable(
          { name: slug, ...(table.system === true ? { system: true } : {}) },
          newMutationContext()
        );
        if (table.system === true) systemTableIds.add(receipt.result.id);
        if (receipt.result.name !== table.name) {
          await bridge.renameTable(receipt.result.id, { name: table.name }, newMutationContext());
        }
        // The columns stand the ascending generated-id sequence (the
        // counter's allocation stand — the padding advances the bridge's
        // allocation over the deleted columns' gaps), placed over the
        // `afterColumnId` anchor (the nearest standing visible
        // predecessor), so the visible order stands the snapshot's schema
        // order.
        let columnSeq = 0;
        const createdColumnIndexes = new Set<number>();
        const createOrder = table.columns
          .map((column, index) => ({ column, index, seq: generatedSeq(receipt.result.id, "c", column.id) }))
          .sort((a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER));
        for (const entry of createOrder) {
          if (entry.seq !== null) await padColumns(bridge, receipt.result.id, columnSeq, entry.seq - 1);
          let anchorId: string | undefined;
          for (let index = entry.index - 1; index >= 0; index -= 1) {
            if (createdColumnIndexes.has(index)) {
              anchorId = table.columns[index]!.id;
              break;
            }
          }
          await bridge.createColumn(
            receipt.result.id,
            {
              column: columnSpecOf(entry.column),
              ...(anchorId !== undefined ? { afterColumnId: anchorId } : {}),
            },
            newMutationContext()
          );
          columnSeq = entry.seq !== null ? entry.seq : columnSeq + 1;
          createdColumnIndexes.add(entry.index);
        }
        const liveColumnIds = new Set(table.columns.map((column) => column.id));
        let rowSeq = 0;
        for (const row of table.rows) {
          const seq = generatedSeq(receipt.result.id, "r", row.id);
          if (seq !== null) await padRows(bridge, receipt.result.id, rowSeq, seq - 1);
          const cells: CellMap = {};
          for (const [key, value] of Object.entries(row.cells)) {
            if (liveColumnIds.has(key)) cells[key] = value;
          }
          await bridge.batchRows(
            receipt.result.id,
            { ops: [{ op: "create", row: cells, beforeRowId: null }] },
            newMutationContext()
          );
          rowSeq = seq !== null ? seq : rowSeq + 1;
        }
      } catch (error) {
        // The un-restorable table (the malformed snapshot / the foreign
        // reference) stands the page's survival: the demo tables re-seed
        // over insert-blocks, the user's table stands the console's stand.
        console.error("the persistent bridge's restore failed for the table", table.id, error);
      }
    }
  })();
}

/** The system tables' ids (the `listTables` stands them out — the
 * snapshot names them over this set; the seed restores the flag, the
 * create records the fresh id). */
const systemTableIds = new Set<string>();

/** The seed's readiness (the harness's table seed awaits it: the guard
 * reads the snapshot's tables, not the empty bridge). */
let seedPromise: Promise<void> | null = null;
function databaseBridgeReady(): Promise<void> {
  if (seedPromise === null) {
    const snapshot = loadSnapshot();
    seedPromise = snapshot !== null ? seed(bridge(), snapshot) : Promise.resolve();
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
    const bridgeInstance = bridge();
    // The re-save loop: a mutation inside the save stands a second pass
    // (the saved state is always at least as fresh as the last mutation
    // before the save's start).
    while (dirty) {
      dirty = false;
      const snapshot = await snapshotOf(bridgeInstance);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        // The storage's refusal (quota / private mode) stands the
        // memory-only stand (no throw over the mutation).
      }
    }
  } catch (error) {
    // The save's read failure (the cursor's expiry over a concurrent
    // commit) stands the skip — the next mutation re-saves.
    console.error("the persistent bridge's save failed", error);
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
const persistentDatabaseBridge: DatabaseBridge = {
  describeProtocol: async () => {
    await databaseBridgeReady();
    return bridge().describeProtocol();
  },
  listTables: async () => {
    await databaseBridgeReady();
    return bridge().listTables();
  },
  createTable: async (input, ctx) => {
    await databaseBridgeReady();
    const receipt = await bridge().createTable(input, ctx);
    if (input.system === true) systemTableIds.add(receipt.result.id);
    scheduleSave();
    return receipt;
  },
  renameTable: async (tableId, input, ctx) => {
    await databaseBridgeReady();
    const receipt = await bridge().renameTable(tableId, input, ctx);
    scheduleSave();
    return receipt;
  },
  describeTable: async (tableId) => {
    await databaseBridgeReady();
    return bridge().describeTable(tableId);
  },
  snapshotTable: async (tableId, query) => {
    await databaseBridgeReady();
    return bridge().snapshotTable(tableId, query);
  },
  queryNextPage: async (tableId, input) => {
    await databaseBridgeReady();
    return bridge().queryNextPage(tableId, input);
  },
  createColumn: async (tableId, input, ctx) => {
    await databaseBridgeReady();
    const receipt = await bridge().createColumn(tableId, input, ctx);
    scheduleSave();
    return receipt;
  },
  updateColumn: async (tableId, columnId, patch, ctx) => {
    await databaseBridgeReady();
    const receipt = await bridge().updateColumn(tableId, columnId, patch, ctx);
    scheduleSave();
    return receipt;
  },
  deleteColumn: async (tableId, columnId, ctx) => {
    await databaseBridgeReady();
    const receipt = await bridge().deleteColumn(tableId, columnId, ctx);
    scheduleSave();
    return receipt;
  },
  restoreDeletedColumn: async (tableId, columnId, ctx) => {
    await databaseBridgeReady();
    const receipt = await bridge().restoreDeletedColumn(tableId, columnId, ctx);
    scheduleSave();
    return receipt;
  },
  resolveRowDisplay: async (tableId, input) => {
    await databaseBridgeReady();
    return bridge().resolveRowDisplay(tableId, input);
  },
  batchRows: async (tableId, input, ctx) => {
    await databaseBridgeReady();
    const receipt = await bridge().batchRows(tableId, input, ctx);
    scheduleSave();
    return receipt;
  },
  undeleteRows: async (tableId, input, ctx) => {
    await databaseBridgeReady();
    const receipt = await bridge().undeleteRows(tableId, input, ctx);
    scheduleSave();
    return receipt;
  },
  // The subscription stands the seed-less passthrough (the consumer's
  // bootstrap reads the snapshot first — that read stands the seed — and
  // subscribes over the snapshot's `asOfSeq`, so the replay's coverage
  // stands the events between the read and the subscription).
  subscribeTable: (tableId, input, observer) => bridge().subscribeTable(tableId, input, observer),
  getOperationStatus: async (operationId) => {
    await databaseBridgeReady();
    return bridge().getOperationStatus(operationId);
  },
};

export { databaseBridgeReady, newMutationContext, persistentDatabaseBridge };
