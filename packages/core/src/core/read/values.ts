/** The read unit's value helpers: the known-type check, the order dedup, and
 *  the plain-value read. */
import * as Y from "yjs";

import { BLOCK_REGISTRY } from "@docblocks-core/schema";
import type { BlockType } from "@docblocks-core/schema";

function isKnownBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && value in BLOCK_REGISTRY;
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
 * primitives as-is. Layout contract: attr values are primitives or nested
 * Y.Maps only (Y.Text lives in meta.title and run text), so this cannot
 * return a live Yjs type.
 */
function readPlainValue(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const plain: Record<string, unknown> = {};
    value.forEach((entry, key) => {
      plain[key] = readPlainValue(entry);
    });
    return plain;
  }
  if (value instanceof Y.Array) {
    return value.toArray().map(readPlainValue);
  }
  return value;
}

export { dedupeOrder, isKnownBlockType, readPlainValue };
