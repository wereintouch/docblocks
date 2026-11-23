/**
 * The protocol's + the committed event's types (the mutation's context /
 * receipt / status — the commit's envelope carries the very same receipt —
 * the protocol's descriptor / capabilities / limits, the domain events, the
 * per-table envelope's stream, the subscription's contract).
 */
import type { BridgeError } from "./errors";
import type { Column, Id, IsoInstant, Revision, RowWire, TableDescription, TableRef } from "./wire-types";

/** The write's context: the client-issued idempotency key (a UUID, unique
 *  within the operation retention) + the issue time + the optional CAS
 *  revision (its absence selects the LWW default — the last committed
 *  write of the same cell wins). */
interface MutationContext {
  operationId: Id;
  issuedAt: IsoInstant;
  expectedRevision?: Revision;
}

/** The committed mutation's receipt: the operation's ids + the commit's
 *  sequence + the server-normalized result + the new revisions. The outer
 *  commit envelope of the same operation carries the very same receipt. */
interface MutationReceipt<T> {
  operationId: Id;
  txId: Id;
  committedSeq: number;
  result: T;
  revisions: Record<Id, Revision>;
}

/** The operation's status (the lost-response reconciliation: the
 *  committed receipt or the pending stand). */
type OperationStatus<T = unknown> = { state: "committed"; receipt: MutationReceipt<T> } | { state: "pending" };

/** The protocol capability (the baseline set every conformant bridge
 *  declares; the optional sets gate the UI paths that need them). */
type ProtocolCapability =
  | "orderedRows"
  | "snapshotReplay"
  | "idempotentWrites"
  | "structuredErrors"
  | "viewInvalidation"
  | "cas"
  | "rowRestore"
  | "columnRestore"
  | "serverSort"
  | "mixedBatch"
  | "materializedWindow";

/** The negotiated finite limits (the server enforces the filter's depth /
 *  terms, the page size, the batch's count, the request / frame bytes and
 *  the active subscriptions with `limit_exceeded` / `payload_too_large`). */
interface ProtocolLimits {
  maxFilterDepth: number;
  maxFilterTerms: number;
  maxPageSize: number;
  maxBatchOps: number;
  maxRequestBytes: number;
  maxFrameBytes: number;
  maxSubscriptions: number;
}

/** The protocol descriptor (the version + the capabilities + the limits +
 *  the retention horizons). */
interface ProtocolDescriptor {
  protocolVersion: 2;
  capabilities: readonly ProtocolCapability[];
  limits: ProtocolLimits;
  operationRetentionSeconds: number;
  retryHorizonSeconds: number;
}

/** The domain event (the nested record of a committed transaction's
 *  envelope — the nested events never carry their own seq). */
type DomainEvent =
  | { type: "table.created"; payload: { table: TableDescription } }
  | { type: "table.renamed"; payload: { table: TableRef } }
  | { type: "table.deleted"; payload: { tableId: Id; revision: Revision } }
  | {
      type: "field.created" | "field.updated" | "field.restored";
      payload: { column: Column; schemaRevision: Revision };
    }
  | { type: "field.deleted"; payload: { columnId: Id; before: Column; schemaRevision: Revision } }
  | { type: "row.created" | "row.updated" | "row.restored" | "row.moved"; payload: { row: RowWire } }
  | { type: "row.deleted"; payload: { rowId: Id; deletedRevision: Revision; before: RowWire } }
  | { type: "enum.option.renamed"; payload: { catalogTableId: Id; option: RowWire } };

/** The committed transaction's envelope base (the per-table ordered
 *  stream's frame). */
interface TableEnvelopeBase {
  tableId: Id;
  /** The envelope's monotonic sequence (not necessarily the previous's + 1). */
  seq: number;
  /** The previous committed envelope's seq (null for the table's first) —
   *  the client detects a loss by the chain, not by the arithmetic. */
  prevSeq: number | null;
  txId: Id;
}

/** The per-table stream's frame: one committed transaction → one outer
 *  envelope → one `seq` / `prevSeq`; the `commit` kind carries the ordered
 *  nested domain events, the `invalidate` kind stands the explicit
 *  rebaseline (the server reset signal, the large rebalance). */
type TableEvent = TableEnvelopeBase &
  (
    | {
        kind: "commit";
        /** The session id of the write's origin (the per-connection stand
         *  — a second tab of the same user is NOT the origin). */
        originSessionId: Id;
        operationId: Id;
        receipt: MutationReceipt<unknown>;
        events: DomainEvent[];
      }
    | {
        kind: "invalidate";
        /** Present for a client mutation, null for a server reset signal. */
        originSessionId: Id | null;
        operationId: Id | null;
        receipt: MutationReceipt<unknown> | null;
        events: [];
      }
  );

/** The subscription's status (the bootstrap's phases). */
type SubscriptionStatus = "connecting" | "replaying" | "live" | "closed";

/** The subscription's observer: the readiness (the replay's cursor + the
 *  table's head + the protocol), the ordered at-least-once stream, the
 *  transport's errors, and the forced rebaseline signals. */
interface SubscriptionObserver {
  /** The subscriber is registered: the replay stands the events after
   *  `afterSeq`, `headSeq` is the table's current head. */
  ready: (value: { afterSeq: number; headSeq: number; protocol: ProtocolDescriptor }) => void;
  event: (value: TableEvent) => void;
  status: (value: SubscriptionStatus) => void;
  error: (error: BridgeError) => void;
  /** The local page is discarded and a fresh snapshot is taken (the
   *  replay expired, the permission lost, the gap detected). */
  reset: (value: { code: "replay_expired" | "permission_lost" | "gap_detected" }) => void;
}

/** The subscription's handle. */
interface SubscriptionHandle {
  unsubscribe(): void;
}

export type {
  DomainEvent,
  MutationContext,
  MutationReceipt,
  OperationStatus,
  ProtocolCapability,
  ProtocolDescriptor,
  ProtocolLimits,
  SubscriptionHandle,
  SubscriptionObserver,
  SubscriptionStatus,
  TableEnvelopeBase,
  TableEvent,
};
