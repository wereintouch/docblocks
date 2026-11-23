/**
 * The document-level snapshot reads: the meta and the whole-document JSON.
 * Snapshots are plain objects per the schema, never live Yjs types; runs
 * are normalized lazily (merge adjacent equal-mark runs, drop empty-text
 * runs).
 */
import * as Y from "yjs";

import { setOwn } from "@docblocks-core/schema";
import type { Block, DocJSON, DocMeta, OpaqueBlock } from "@docblocks-core/schema";

import { readBlockSnapshot } from "./read-blocks";
import { readPlainValue } from "./values";

function readMeta(ydoc: Y.Doc): DocMeta {
  const meta = ydoc.getMap("meta");
  const id = meta.get("id");
  const title = meta.get("title");
  const avatar = meta.get("avatar");
  const createdAt = meta.get("createdAt");
  // The doc-attributes record: a single nested Y.Map read as a
  // plain record with sorted keys (the Y.Map iteration order is
  // process-dependent) and the own-property stand. The values stand as-read
  // (the lenient preservation of an unsupported value — the reader's
  // contract); absent / empty = the field stands off.
  const attributesMap = meta.get("attributes");
  let attributes: DocMeta["attributes"];
  if (attributesMap instanceof Y.Map && attributesMap.size > 0) {
    const entries: Array<[string, unknown]> = [];
    attributesMap.forEach((value, key) => entries.push([key, readPlainValue(value)]));
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const record: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      setOwn(record, key, value);
    }
    attributes = record as DocMeta["attributes"];
  }
  // The attributes' display order (the custom attribute's reorder's
  // persistence): the Y.Array's strings, absent / empty = the field
  // stands off (the reader's fallback is the record's key order).
  const orderArray = meta.get("attributesOrder");
  let attributesOrder: string[] | undefined;
  if (orderArray instanceof Y.Array) {
    const keys = orderArray.toArray().filter((key): key is string => typeof key === "string");
    if (keys.length > 0) attributesOrder = keys;
  }
  return {
    v: 1,
    id: typeof id === "string" ? id : "",
    // Yjs-only `updatedAt` is deliberately excluded from the JSON meta.
    title: title instanceof Y.Text ? title.toString() : typeof title === "string" ? title : "",
    // The avatar is optional: absent or empty means none (the field stands off).
    ...(typeof avatar === "string" && avatar !== "" ? { avatar } : {}),
    ...(attributes !== undefined ? { attributes } : {}),
    ...(attributesOrder !== undefined ? { attributesOrder } : {}),
    createdAt: typeof createdAt === "string" ? createdAt : "",
  };
}

/** The whole document as plain schema JSON (all export normalization applied). */
function toDocJSON(ydoc: Y.Doc): DocJSON {
  const meta = readMeta(ydoc);
  const blocks: Record<string, Block | OpaqueBlock> = {};
  const blocksMap = ydoc.getMap("blocks");
  // The blocks are assembled in sorted id order: the Y.Map's iteration order
  // depends on the creation history, so peers that converge on the same
  // content would otherwise export the same data in different key orders
  // (the byte-identical peer export's stand; the JSON's object order is
  // semantically irrelevant — the children's arrays carry the document
  // order).
  const ids = [...blocksMap.keys()].sort();
  for (const id of ids) {
    const block = readBlockSnapshot(ydoc, id);
    if (block) setOwn(blocks, id, block);
  }
  return { ...meta, blocks };
}

export { readBlock, readBlockSnapshot } from "./read-blocks";
export { readChildren, readRuns, readText } from "./read-text";
export { readMeta, toDocJSON };
