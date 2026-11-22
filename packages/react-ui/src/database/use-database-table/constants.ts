/** The database table provider's load constants. */

/** The page size the provider loads (the `nextCursor` continuation). */
const PAGE_SIZE = 200;

/** The at-least-once dedup set's seq window: over the bound the set stands
 * cleared (the stale check — the seq at or below the head's drop —
 * protects the pruned seqs, the long session's growth stands bounded). */
const SEQ_DEDUP_WINDOW = 1024;

export { PAGE_SIZE, SEQ_DEDUP_WINDOW };
