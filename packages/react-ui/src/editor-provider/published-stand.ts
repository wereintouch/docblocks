import type { Doc } from "docblocks-core";

/** The published snapshot's stand key: one key per snapshot instance. A new
 *  snapshot remounts the nested published provider (the doc's stand must not
 *  change over a mounted provider — the doc's stand guard), while the same
 *  snapshot keeps its stand over the re-renders. */

const SNAPSHOT_KEYS = new WeakMap<object, number>();
let SNAPSHOT_KEY_SEQ = 0;

function publishedStandKey(doc: Doc): string {
  let key = SNAPSHOT_KEYS.get(doc);
  if (key === undefined) {
    key = SNAPSHOT_KEY_SEQ;
    SNAPSHOT_KEY_SEQ += 1;
    SNAPSHOT_KEYS.set(doc, key);
  }
  return `published-${key}`;
}

export { publishedStandKey };
