/** The document root's trailing-paragraph guarantee (the session's start
 *  stand): a doc that stands a non-text last block (the external data,
 *  the peer's mid-session stand) has no caret home over its end — the
 *  empty paragraph stands after it, locally at the session's start and
 *  over the wire on a peer's write. */
import { useEffect, useRef } from "react";

import { BLOCK_REGISTRY } from "docblocks-core";
import type { BlockId, Doc } from "docblocks-core";

import { ensureTrailingParagraph } from "../editing/block-commands";

function useTrailingParagraph(doc: Doc, rootBlockId: BlockId | undefined, editingStand: boolean): void {
  // The editing stand over the mount (the guarantee's write gate): a
  // read-only stand (view / published) never runs the write — the
  // published's snapshot stands static over the render and a read-only
  // subtree must not write into its own doc (the embedded's master over
  // the published's stand is read-only too).
  const editingStandRef = useRef(editingStand);
  editingStandRef.current = editingStand;

  useEffect(() => {
    // The empty doc stands no stand here (the starter's seeder owns the
    // empty room, the empty hint owns the empty editor), the text tail
    // stands no write (no no-op transact — a mount with nothing to stand
    // must not stamp the doc), and the subtree providers' sequence ends
    // are the consumer's stand.
    if (rootBlockId === undefined && editingStandRef.current) {
      const sequence = doc.getChildren(doc.meta.id);
      const lastId = sequence[sequence.length - 1];
      const last = lastId === undefined ? null : doc.getBlock(lastId);
      if (last !== null && !BLOCK_REGISTRY[last.type].content) {
        doc.transact(() => {
          ensureTrailingParagraph(doc, doc.meta.id);
        });
      }
    }

    // The remote feed (full-doc editors only): a peer's write that leaves
    // the tail non-text (a seed load over the wire, a foreign writer)
    // stands its trailing paragraph over the wire. The feed is
    // remote-only — the local gesture paths (the removal, the slash's
    // insert, the drag's commit) stand their own paragraph inside their
    // one transact, and a local-origin guard would double-stand the
    // paragraph over the peer's guard of the same write. The check runs
    // once the in-flight transaction settles (a microtask) so the
    // insertion commits as its own LOCAL transaction: a guard write
    // inside the remote transaction would stand the remote origin and the
    // origin guard would keep it off the wire.
    let unsubscribeTail: (() => void) | null = null;
    if (rootBlockId === undefined && editingStandRef.current) {
      unsubscribeTail = doc.onRemoteChange(() => {
        void queueMicrotask(() => {
          ensureTrailingParagraph(doc, doc.meta.id);
        });
      });
    }

    return () => {
      if (unsubscribeTail !== null) unsubscribeTail();
    };
  }, [doc, rootBlockId]);
}

export { useTrailingParagraph };
