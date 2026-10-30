import type { Doc } from "@docblocks-core/core";
import { localOriginOf, undoManagerOf } from "@docblocks-core/core";

import type { SyncProvider } from "./models";

/**
 * A sync session: routes one document to one provider.
 *
 * `detach` releases all routing and is idempotent. It does not disconnect
 * the provider — the provider lifecycle is owned by the application.
 *
 * Attach order: the remote subscription is registered BEFORE the
 * bootstrap send, so a provider that answers synchronously (an in-memory
 * relay, its accumulated-state delivery) cannot stand a reply lost over
 * the send. The provider's accumulated wire state stands delivered to the
 * new subscription at attach time (the onUpdate contract), so a late
 * attach — the provider already connected and holding room state —
 * recovers the full state over the CRDT merge; the doc and the provider
 * then converge over the bootstrap + the usual update flow.
 */
interface SyncSession {
  detach(): void;
}

/**
 * Route a document and a provider to each other.
 *
 * Local to provider: the update handler filters by transaction origin — the
 * local origin symbol (commands, transact batches) and the undo manager
 * (undo/redo inverse steps) are the local client; remote applies
 * (`doc.applyUpdate`, the documented remote-apply API) commit without one.
 * Origin-based suppression (not a flag around the apply call) holds even
 * when Yjs defers the update event past the apply call.
 *
 * `attach` does not call `provider.connect()` (the application orchestrates
 * the join flow) and does not route awareness: setAwareness/onAwareness is
 * a direct application↔provider channel.
 *
 * Multiple sessions on one document are independent — each session routes
 * to its own provider.
 *
 * Remote delivery errors (e.g. malformed bytes) propagate synchronously to
 * the provider's delivery context; a failed apply may commit the decoded
 * prefix, and the consumer can resync through `getLocalStateVector`. Escaped
 * commits via `doc.raw` (non-guaranteed origin) are not synced.
 */
function attach(doc: Doc, provider: SyncProvider): SyncSession {
  const ydoc = doc.raw;
  const localOrigin = localOriginOf(ydoc);
  const undoOrigin = undoManagerOf(ydoc);
  let detached = false;

  // Stored by reference: yjs ObservableV2's on() returns the handler itself
  // (not an unbind), so detach is via off() with this same reference.
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (detached || (origin !== localOrigin && origin !== undoOrigin)) return;
    provider.sendUpdate(update);
  };
  ydoc.on("update", onUpdate);

  // Subscribe BEFORE the bootstrap send: a synchronous provider reply to
  // the send would stand lost over a send-first order. The provider's
  // accumulated state (if any) stands delivered right here, at subscribe
  // time — the late-attach recovery (the contract stands in SyncProvider
  // onUpdate).
  const unsubscribeRemote = provider.onUpdate((bytes) => {
    if (detached) return;
    doc.applyUpdate(bytes);
  });

  // Bootstrap the session with the document's full state. The provider's
  // internal doc starts empty (or stands state from earlier sessions), and
  // the initial layout is written before attach: incremental updates alone
  // reference client clocks and items the session has never seen, which
  // Yjs cannot integrate (they stay pending and never enter any state
  // vector).
  provider.sendUpdate(doc.encode());

  return {
    detach() {
      if (detached) return;
      detached = true;
      ydoc.off("update", onUpdate);
      unsubscribeRemote();
    },
  };
}

export { attach };
export type { SyncSession };
