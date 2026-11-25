/**
 * The in-memory bridge's subscription + the operation status (over the
 * core): the live feed (the replay's coverage stand — the subscription
 * over the snapshot's `afterSeq` replays the envelopes between the read
 * and the subscription, the replay window's expiry stands the forced
 * rebaseline), the idempotency store's visibility (the committed receipt,
 * the sticky expiry's stand), and the reference tombstone GC (invisible —
 * no envelope, no head advance).
 */
import type { OperationStatus, SubscriptionHandle, SubscriptionObserver } from "docblocks-react-ui";
import { BridgeError } from "docblocks-react-ui";

import { MAX_SUBSCRIPTIONS } from "./constants";
import type { MemoryBridgeCore } from "./core";
import { clone } from "./utils";

function subscribeTable(
  core: MemoryBridgeCore,
  tableId: string,
  input: { afterSeq: number },
  observer: SubscriptionObserver
): SubscriptionHandle {
  const table = core.tableOf(tableId);
  const noopHandle: SubscriptionHandle = { unsubscribe(): void {} };
  if (typeof input.afterSeq !== "number" || !Number.isInteger(input.afterSeq) || input.afterSeq < 0) {
    observer.status("connecting");
    observer.error(new BridgeError("validation", "The subscription afterSeq must be a non-negative integer."));
    observer.status("closed");
    return noopHandle;
  }
  if (Number.isFinite(core.replayWindow) && input.afterSeq < table.headSeq - core.replayWindow) {
    observer.status("connecting");
    observer.ready({ afterSeq: input.afterSeq, headSeq: table.headSeq, protocol: core.descriptor });
    observer.status("replaying");
    observer.reset({ code: "replay_expired" });
    observer.status("closed");
    return noopHandle;
  }
  let set = core.subscribers.get(tableId);
  if (set === undefined) {
    set = new Set();
    core.subscribers.set(tableId, set);
  }
  if (set.size >= MAX_SUBSCRIPTIONS) {
    observer.status("connecting");
    observer.error(
      new BridgeError("limit_exceeded", `The table's live subscriptions reach the limit of ${MAX_SUBSCRIPTIONS}.`)
    );
    observer.status("closed");
    return noopHandle;
  }
  let closed = false;
  const handle: SubscriptionHandle = {
    unsubscribe(): void {
      if (closed) return;
      closed = true;
      set.delete(observer);
      observer.status("closed");
    },
  };
  set.add(observer);
  observer.status("connecting");
  observer.ready({ afterSeq: input.afterSeq, headSeq: table.headSeq, protocol: core.descriptor });
  if (input.afterSeq < table.headSeq) {
    observer.status("replaying");
    for (const envelope of table.envelopes) {
      if (envelope.seq > input.afterSeq) observer.event(clone(envelope));
    }
  }
  if (!closed) observer.status("live");
  return handle;
}

async function getOperationStatus(core: MemoryBridgeCore, operationId: string): Promise<OperationStatus> {
  const entry = core.idempotency.get(operationId);
  if (entry === undefined) {
    throw new BridgeError("operation_unknown", `The operation "${operationId}" is unknown.`);
  }
  // The tombstone stand (the sticky expiry of the write path): an
  // expired id stands the operation_unknown (the entry is not deleted
  // — the write path's never-re-execute stand stands on it).
  if (entry.receipt === null || Date.now() - entry.committedAt > core.operationRetentionMs) {
    entry.receipt = null;
    throw new BridgeError("operation_unknown", `The operation "${operationId}" is outside the retention horizon.`);
  }
  return { state: "committed", receipt: entry.receipt };
}

function gcTable(core: MemoryBridgeCore, tableId: string): void {
  const table = core.tableOf(tableId);
  const deadline = Date.now() - core.tombstoneRetentionMs;
  const before = table.rows.length;
  table.rows = table.rows.filter((row) => row.deletedAt === null || row.deletedAt > deadline);
  if (table.rows.length === before) return;
  // The GC is invisible by design: no envelope, no head advance — the
  // public stream stands unchanged and a restore of a GC'd row stands
  // the safe `not_found`.
}

export { getOperationStatus, gcTable, subscribeTable };
