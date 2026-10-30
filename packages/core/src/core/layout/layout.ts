/** The layout's read accessors + the fresh-doc construction: the blocks
 *  map, the root order, the root id, the meta write, the local transact, and
 *  the empty-page layout. */
import * as Y from "yjs";

import type { AnyMap } from "./models";
import { localOriginOf } from "./origins";

/** The registered blocks map (throws on a broken layout). */
function getBlocks(ydoc: Y.Doc): AnyMap {
  const blocks = ydoc.getMap("blocks");
  if (!(blocks instanceof Y.Map)) {
    throw new Error("docblocks: broken Yjs layout (blocks map missing)");
  }
  return blocks;
}

/** The registered root-order array: the root block's children (throws on a broken layout). */
function rootOrderOf(ydoc: Y.Doc): Y.Array<string> {
  const rootOrder = ydoc.getArray("rootOrder");
  if (!(rootOrder instanceof Y.Array)) {
    throw new Error("docblocks: broken Yjs layout (rootOrder array missing)");
  }
  return rootOrder as Y.Array<string>;
}

/** The root block's id: the document id, which keys the root entry in `blocks`. */
function rootBlockIdOf(ydoc: Y.Doc): string {
  const id = ydoc.getMap("meta").get("id");
  if (typeof id !== "string") {
    throw new Error("docblocks: broken Yjs layout (meta.id missing)");
  }
  return id;
}

/** Write the registered meta map on a fresh doc. */
function writeMeta(ydoc: Y.Doc, id: string, title: string, createdAt: string, avatar?: string): void {
  const meta = ydoc.getMap("meta");
  meta.set("v", 1);
  meta.set("id", id);
  meta.set("title", new Y.Text(title));
  meta.set("createdAt", createdAt);
  meta.set("updatedAt", createdAt);
  // The avatar is optional: it stands only for a non-empty string (absent/empty = none).
  if (avatar !== undefined && avatar !== "") meta.set("avatar", avatar);
}

/**
 * Run `fn` in a local transaction and refresh the Yjs-only `meta.updatedAt`
 * bookkeeping field (every local transaction counts as a document change).
 * Nested calls join the outer transaction.
 */
function localTransact(ydoc: Y.Doc, fn: () => void): void {
  ydoc.transact(() => {
    ydoc.getMap("meta").set("updatedAt", new Date().toISOString());
    fn();
  }, localOriginOf(ydoc));
}

export { getBlocks, localTransact, rootBlockIdOf, rootOrderOf, writeMeta };
