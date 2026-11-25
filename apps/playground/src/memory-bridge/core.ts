/**
 * The in-memory bridge's core: the instance's shared state (the tables /
 * the live subscribers / the idempotency store, the cursor's key, the
 * retention stands, the protocol descriptor) + the stateful primitives —
 * the table's lookup, the live notify (the outbox was appended first), the
 * commit's publish (one transaction → one envelope over the outbox, the
 * live delivery after), the idempotency's guard (the stored receipt's
 * replay / the conflict / the sticky expiry), the mutation body's
 * fingerprint, and the no-op mutation's receipt. The bridge's methods stand
 * over the core.
 */
import type {
  DomainEvent,
  MutationContext,
  MutationReceipt,
  ProtocolDescriptor,
  SubscriptionObserver,
  TableEvent,
} from "docblocks-react-ui";
import { BridgeError } from "docblocks-react-ui";

import {
  DEFAULT_OPERATION_RETENTION_SECONDS,
  DEFAULT_REPLAY_WINDOW,
  DEFAULT_RETRY_HORIZON_SECONDS,
  DEFAULT_TOMBSTONE_RETENTION_MS,
  MAX_BATCH_OPS,
  MAX_FILTER_DEPTH,
  MAX_FILTER_TERMS,
  MAX_FRAME_BYTES,
  MAX_PAGE_SIZE,
  MAX_REQUEST_BYTES,
  MAX_SUBSCRIPTIONS,
  PROTOCOL_CAPABILITIES,
} from "./constants";
import { queryFingerprintOf, randomKeyBytes } from "./cursor";
import type { MemoryBridgeOptions, MemoryIdempotencyEntry, MemoryTable } from "./models";
import { newTxId } from "./rows";
import { clone } from "./utils";

/** The reference bridge's shared state + the stateful primitives (the
 *  bridge's methods' single dependency). */
interface MemoryBridgeCore {
  tables: Map<string, MemoryTable>;
  subscribers: Map<string, Set<SubscriptionObserver>>;
  idempotency: Map<string, MemoryIdempotencyEntry>;
  cursorKey: Uint8Array;
  originSessionId: string;
  operationRetentionMs: number;
  replayWindow: number;
  tombstoneRetentionMs: number;
  descriptor: ProtocolDescriptor;
  tableOf(tableId: string): MemoryTable;
  notify(tableId: string, envelope: TableEvent): void;
  publish<T>(
    table: MemoryTable,
    operationId: string,
    result: T,
    revisions: Record<string, string>,
    events: DomainEvent[],
    rebalanced?: boolean
  ): MutationReceipt<T>;
  idempotent<T>(ctx: MutationContext, fingerprint: string, execute: () => MutationReceipt<T>): MutationReceipt<T>;
  fingerprintOf(kind: string, payload: Record<string, unknown>): string;
}

/** The no-op mutation's receipt (no envelope, no head advance): the
 *  commit sequence stands the table's current head. */
function noOpReceipt<T>(ctx: MutationContext, table: MemoryTable, result: T): MutationReceipt<T> {
  return {
    operationId: ctx.operationId,
    txId: newTxId(),
    committedSeq: table.headSeq,
    result: clone(result),
    revisions: {},
  };
}

function buildCore(options: MemoryBridgeOptions = {}): MemoryBridgeCore {
  const operationRetentionSeconds = options.operationRetentionSeconds ?? DEFAULT_OPERATION_RETENTION_SECONDS;
  const operationRetentionMs = operationRetentionSeconds * 1000;
  const retryHorizonSeconds = options.retryHorizonSeconds ?? DEFAULT_RETRY_HORIZON_SECONDS;
  const tombstoneRetentionMs = options.tombstoneRetentionMs ?? DEFAULT_TOMBSTONE_RETENTION_MS;
  const replayWindow = options.replayWindow ?? DEFAULT_REPLAY_WINDOW;

  /** The cursor / fingerprint signature's key (the per-instance stand of
   *  the consumer's server-side secret; the `cursorKey`'s absent stand is
   *  the fresh CSPRNG key). */
  const cursorKey: Uint8Array =
    options.cursorKey !== undefined ? new TextEncoder().encode(options.cursorKey) : randomKeyBytes();

  const tables = new Map<string, MemoryTable>();
  const subscribers = new Map<string, Set<SubscriptionObserver>>();
  const idempotency = new Map<string, MemoryIdempotencyEntry>();
  /** The instance's session id (the envelope's `originSessionId` stand —
   *  the per-connection id the consumer assigns). */
  const originSessionId = `session-${Math.random().toString(36).slice(2, 10)}`;

  const descriptor: ProtocolDescriptor = {
    protocolVersion: 2,
    capabilities: PROTOCOL_CAPABILITIES,
    limits: {
      maxFilterDepth: MAX_FILTER_DEPTH,
      maxFilterTerms: MAX_FILTER_TERMS,
      maxPageSize: MAX_PAGE_SIZE,
      maxBatchOps: MAX_BATCH_OPS,
      maxRequestBytes: MAX_REQUEST_BYTES,
      maxFrameBytes: MAX_FRAME_BYTES,
      maxSubscriptions: MAX_SUBSCRIPTIONS,
    },
    operationRetentionSeconds,
    retryHorizonSeconds,
  };

  function tableOf(tableId: string): MemoryTable {
    const table = tables.get(tableId);
    if (table === undefined) throw new BridgeError("not_found", `The table "${tableId}" is unknown.`);
    return table;
  }

  /** The live delivery (the outbox was already appended — the replay
   *  coverage of a delivered event always holds). */
  function notify(tableId: string, envelope: TableEvent): void {
    const set = subscribers.get(tableId);
    if (set === undefined) return;
    for (const observer of [...set]) observer.event(clone(envelope));
  }

  /** One committed transaction → one outer envelope (the `commit` kind
   *  with the ordered nested events, or the `invalidate` kind when the
   *  rebalance rewrote the order keys). The receipt stands in both. */
  function publish<T>(
    table: MemoryTable,
    operationId: string,
    result: T,
    revisions: Record<string, string>,
    events: DomainEvent[],
    rebalanced = false
  ): MutationReceipt<T> {
    table.headSeq += 1;
    const seq = table.headSeq;
    const previous = table.envelopes[table.envelopes.length - 1];
    const txId = newTxId();
    const receipt: MutationReceipt<T> = {
      operationId,
      txId,
      committedSeq: seq,
      result: clone(result),
      revisions: clone(revisions),
    };
    const base = {
      tableId: table.id,
      seq,
      prevSeq: previous !== undefined ? previous.seq : null,
      txId,
    };
    const envelope: TableEvent = rebalanced
      ? {
          ...base,
          kind: "invalidate" as const,
          originSessionId,
          operationId,
          receipt: receipt as MutationReceipt<unknown>,
          events: [],
        }
      : {
          ...base,
          kind: "commit" as const,
          originSessionId,
          operationId,
          receipt: receipt as MutationReceipt<unknown>,
          events: clone(events),
        };
    table.envelopes.push(envelope);
    notify(table.id, envelope);
    return receipt;
  }

  /** The same operation id + the same canonical body → the stored receipt
   *  (never a second effect); the same id with a different body →
   *  `idempotency_conflict`; past the retention → `idempotency_expired`
   *  (never re-executed). */
  function idempotent<T>(
    ctx: MutationContext,
    fingerprint: string,
    execute: () => MutationReceipt<T>
  ): MutationReceipt<T> {
    const entry = idempotency.get(ctx.operationId);
    if (entry !== undefined) {
      // The expiry is sticky (the tombstone stand): an id past the horizon
      // is never re-executed — the entry stands (a deleted entry would let
      // a later retry re-execute the operation), the receipt drops.
      if (entry.receipt === null || Date.now() - entry.committedAt > operationRetentionMs) {
        entry.receipt = null;
        throw new BridgeError(
          "idempotency_expired",
          `The operation "${ctx.operationId}" is outside the retention horizon and is never re-executed.`
        );
      }
      if (entry.fingerprint !== fingerprint) {
        throw new BridgeError(
          "idempotency_conflict",
          `The operation "${ctx.operationId}" was committed with a different body.`
        );
      }
      return entry.receipt as MutationReceipt<T>;
    }
    const receipt = execute();
    idempotency.set(ctx.operationId, {
      fingerprint,
      receipt: receipt as MutationReceipt<unknown>,
      committedAt: Date.now(),
    });
    return receipt;
  }

  /** The idempotency's body fingerprint (the keyed stand — the same
   *  signature scheme as the query's, the collision stand over the
   *  same `operationId` + the different body). */
  function fingerprintOf(kind: string, payload: Record<string, unknown>): string {
    return queryFingerprintOf(cursorKey, { kind, ...payload });
  }

  return {
    tables,
    subscribers,
    idempotency,
    cursorKey,
    originSessionId,
    operationRetentionMs,
    replayWindow,
    tombstoneRetentionMs,
    descriptor,
    tableOf,
    notify,
    publish,
    idempotent,
    fingerprintOf,
  };
}

export { buildCore, noOpReceipt };
export type { MemoryBridgeCore };
