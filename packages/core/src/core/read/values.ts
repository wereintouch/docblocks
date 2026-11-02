/** The read unit's value helpers: the known-type check, the order dedup, and
 *  the plain-value read. */
import * as Y from "yjs";

import { BLOCK_REGISTRY, setOwn } from "@docblocks-core/schema";
import type { BlockType } from "@docblocks-core/schema";

function isKnownBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && Object.hasOwn(BLOCK_REGISTRY, value);
}

/**
 * Read-side dedupe of an order array: duplicate entries can only arise from
 * merging the same deterministic insert (re-seeding a persistent sync room
 * with the same id generator); a well-formed writer never writes them.
 * The first occurrence wins, so every read sees a well-formed order.
 */
function dedupeOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Plain copy of a layout value: nested Y.Map → object, Y.Array → array,
 * primitives as-is, and a plain object / array held by reference (the
 * database's multi-select cell value, the layout's plain stand) over the
 * deep copy — the Yjs store holds the plain values by reference, so the
 * snapshot must not alias the store's own copy (a post-read mutation of the
 * snapshot would corrupt the doc outside any transaction — 0 change events,
 * persisted through the toJSON). Layout contract: attr values are
 * primitives, nested Y.Maps, or plain objects / arrays (Y.Text lives in
 * meta.title and run text), so this cannot return a live Yjs type.
 */
function readPlainValue(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const plain: Record<string, unknown> = {};
    value.forEach((entry, key) => {
      // The reserved-key stand (the open key comes from the CRDT — the
      // `__proto__` data key stands own, the prototype stands untouched).
      setOwn(plain, key, readPlainValue(entry));
    });
    return plain;
  }
  if (value instanceof Y.Array) {
    return value.toArray().map(readPlainValue);
  }
  // The plain object / array held by reference stands the deep copy (the
  // aliasing stand); the primitives stand as-is (immutable).
  if (typeof value === "object" && value !== null) return structuredClone(value);
  return value;
}

export { dedupeOrder, isKnownBlockType, readPlainValue };
