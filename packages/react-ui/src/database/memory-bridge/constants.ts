/** The in-memory bridge's constants: the defaults, the descriptor
 *  capabilities, and the negotiated limits. */
import type { ProtocolCapability } from "../bridge";

/** The default page size (the `query.limit`'s absent stand). */
const DEFAULT_LIMIT = 200;

/** The default operation retention horizon (seconds, 7 days): the
 *  idempotency store + the `getOperationStatus` visibility. */
const DEFAULT_OPERATION_RETENTION_SECONDS = 7 * 24 * 3600;

/** The default retry horizon (seconds, 5 minutes): the client retry window
 *  the descriptor advertises. */
const DEFAULT_RETRY_HORIZON_SECONDS = 300;

/** The default tombstone retention (ms, 0): a tombstone is GC-eligible the
 *  moment it is created — the reference's `gcTable` stand. */
const DEFAULT_TOMBSTONE_RETENTION_MS = 0;

/** The default replay window (envelopes, unlimited): how far behind the head
 *  a `subscribeTable`'s `afterSeq` may stand to still be replayed. */
const DEFAULT_REPLAY_WINDOW = Infinity;

/** The query semantics' constants (the server's declared stand). */
const SEMANTICS_VERSION = "1";
const SEMANTICS_COLLATION = "binary";
const SEMANTICS_TIMEZONE = "UTC";
const SEMANTICS_NULL_ORDERING = "last";

/** The negotiated limits (the `ProtocolDescriptor.limits`' stand). */
const MAX_FILTER_DEPTH = 8;
const MAX_FILTER_TERMS = 100;
const MAX_PAGE_SIZE = 500;
const MAX_BATCH_OPS = 1000;
const MAX_REQUEST_BYTES = 1_048_576;
const MAX_FRAME_BYTES = 1_048_576;
const MAX_SUBSCRIPTIONS = 64;

/** The protocol's declared capabilities (the baseline set + the reference
 *  bridge's supported optional stands: the CAS, the row / column restore,
 *  the server sort, the mixed batch). */
const PROTOCOL_CAPABILITIES: readonly ProtocolCapability[] = [
  "orderedRows",
  "snapshotReplay",
  "idempotentWrites",
  "structuredErrors",
  "viewInvalidation",
  "cas",
  "rowRestore",
  "columnRestore",
  "serverSort",
  "mixedBatch",
];

export {
  DEFAULT_LIMIT,
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
  SEMANTICS_COLLATION,
  SEMANTICS_NULL_ORDERING,
  SEMANTICS_TIMEZONE,
  SEMANTICS_VERSION,
};
