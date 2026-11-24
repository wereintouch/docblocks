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
import type { DatabaseBridge } from "docblocks-react-ui";

import { seed, snapshotOf, systemTableIds } from "./bridge-restore";
import { STORAGE_KEY, loadSnapshot } from "./bridge-snapshot";
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

/** The save's debounce window: a mutation stands the snapshot within it
 * (a reload inside the window loses the very last mutation — the harness
 * trade-off over a save per keystroke). */
const SAVE_DEBOUNCE_MS = 150;

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
