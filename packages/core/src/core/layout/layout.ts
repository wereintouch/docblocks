/** The layout's read accessors + the fresh-doc construction: the blocks
 *  map, the root order, the root id, the meta write, the local transact, and
 *  the empty-page layout. */
import * as Y from "yjs";

import { DocBlocksError } from "../errors";
import type { AnyMap } from "./models";
import { localOriginOf } from "./origins";

/** The registered blocks map (throws on a broken layout). */
function getBlocks(ydoc: Y.Doc): AnyMap {
  const blocks = ydoc.getMap("blocks");
  if (!(blocks instanceof Y.Map)) {
    throw new DocBlocksError("docblocks: broken Yjs layout (the blocks map is missing)");
  }
  return blocks;
}

/** The registered root-order array: the root block's children (throws on a broken layout). */
function rootOrderOf(ydoc: Y.Doc): Y.Array<string> {
  const rootOrder = ydoc.getArray("rootOrder");
  if (!(rootOrder instanceof Y.Array)) {
    throw new DocBlocksError("docblocks: broken Yjs layout (the rootOrder array is missing)");
  }
  return rootOrder as Y.Array<string>;
}

/** The root block's id: the document id, which keys the root entry in `blocks`. */
function rootBlockIdOf(ydoc: Y.Doc): string {
  const id = ydoc.getMap("meta").get("id");
  if (typeof id !== "string") {
    throw new DocBlocksError("docblocks: broken Yjs layout (the meta.id is missing)");
  }
  return id;
}

/**
 * Write the registered meta map on a fresh doc.
 *
 * The `attributes` record stands one nested Y.Map under
 * `meta.attributes`, written only when non-empty (absent / empty = the
 * field stands off — the writer's parity: an absent field is never written
 * as an empty record). The `attributesOrder` array (the record's keys'
 * display order) stands one Y.Array under `meta.attributesOrder`, written
 * the same way. A concurrent init of the record resolves as a
 * whole-record LWW (the meta map's last-writer-wins), so a doc's creation
 * stays server-coordinated.
 */
function writeMeta(
  ydoc: Y.Doc,
  id: string,
  title: string,
  createdAt: string,
  avatar?: string,
  attributes?: Record<string, unknown>,
  attributesOrder?: string[]
): void {
  const meta = ydoc.getMap("meta");
  meta.set("v", 1);
  meta.set("id", id);
  meta.set("title", new Y.Text(title));
  meta.set("createdAt", createdAt);
  meta.set("updatedAt", createdAt);
  // The avatar is optional: it stands only for a non-empty string (absent/empty = none).
  if (avatar !== undefined && avatar !== "") meta.set("avatar", avatar);
  if (attributes !== undefined && Object.keys(attributes).length > 0) {
    const attrs = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(attributes)) {
      writeAttributeEntry(attrs, key, value);
    }
    meta.set("attributes", attrs);
  }
  if (attributesOrder !== undefined && attributesOrder.length > 0) {
    const order = new Y.Array<string>();
    order.push(attributesOrder);
    meta.set("attributesOrder", order);
  }
}

/**
 * The flat value write of the doc-attributes record: primitives stand as-is,
 * a list stands a Y.Array (the elements are cloned — no aliasing of
 * caller-owned values into the CRDT), and a plain object (the lenient
 * preservation of an unsupported value) stands a nested Y.Map.
 */
function writeAttributeEntry(map: Y.Map<unknown>, key: string, value: unknown): void {
  if (Array.isArray(value)) {
    const arr = new Y.Array<unknown>();
    for (const item of value) {
      arr.push(structuredClone(item));
    }
    map.set(key, arr);
    return;
  }
  if (value !== null && typeof value === "object") {
    const obj = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(value)) {
      obj.set(k, structuredClone(v));
    }
    map.set(key, obj);
    return;
  }
  map.set(key, value);
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
