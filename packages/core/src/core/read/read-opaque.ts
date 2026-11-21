/**
 * The cross-minor opaque read of an unknown-type block (a future minor's
 * data): the entry's fields as plain data, as-is. The reader/renderer stand
 * a placeholder (and the text without the unknown marks); the data is not
 * lost on save (the writer's opaque stand). The strict validator rejects it.
 */
import * as Y from "yjs";

import { setOwn } from "@docblocks-core/schema";
import type { OpaqueBlock, TextRun } from "@docblocks-core/schema";

import { normalizeRuns } from "../normalize";
import { attrsToMarkSet } from "../text-model";
import type { TextDeltaOp } from "../text-model";
import { readPlainValue } from "./values";

function readOpaqueBlock(yblock: Y.Map<unknown>, type: unknown): OpaqueBlock {
  const block: OpaqueBlock = { type: typeof type === "string" ? type : "unknown" };

  const attrs = yblock.get("attrs");
  if (attrs instanceof Y.Map && attrs.size > 0) {
    // Sorted keys: the Y.Map iteration order is process-dependent, so
    // without normalization the toJSON() bytes would depend on the peer.
    const entries: Array<[string, unknown]> = [];
    attrs.forEach((value, key) => entries.push([key, readPlainValue(value)]));
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const plain: Record<string, unknown> = {};
    // The own-property stand: the reserved key (`__proto__`) becomes an own
    // data key, not the prototype's reassignment (the data survives the
    // export, the snapshot's prototype stands untouched).
    for (const [key, value] of entries) setOwn(plain, key, value);
    block.attrs = plain;
  }

  const geometry = yblock.get("geometry");
  if (geometry instanceof Y.Map && geometry.size > 0)
    block.geometry = readPlainValue(geometry) as Record<string, number>;

  const content = yblock.get("content");
  if (content instanceof Y.Text) {
    const raw: TextRun[] = [];
    for (const op of content.toDelta() as TextDeltaOp[]) {
      if (typeof op.insert !== "string") continue;
      raw.push({ text: op.insert, marks: attrsToMarkSet(op.attributes) });
    }
    const runs = normalizeRuns(raw);
    if (runs.length > 0) block.content = runs;
  }

  const children = yblock.get("children");
  if (children instanceof Y.Array) {
    const ids = children.toArray().filter((childId): childId is string => typeof childId === "string");
    if (ids.length > 0) block.children = ids;
  }

  // Additive top-level fields of a future minor: preserved as-is so a save
  // never drops data the engine does not know (the cross-minor stand). The
  // layout-only `parent` (the owner field) never reaches the JSON. Sorted
  // keys: the Y.Map iteration order is process-dependent, so the JSON key
  // order stays deterministic on every peer.
  const extra: Array<[string, unknown]> = [];
  yblock.forEach((value, key) => {
    if (
      key === "type" ||
      key === "attrs" ||
      key === "content" ||
      key === "children" ||
      key === "geometry" ||
      key === "parent"
    )
      return;
    extra.push([key, value]);
  });
  extra.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [key, value] of extra) {
    if (value instanceof Y.Text) {
      // A text field reads like the content: Y.Text -> runs (a plain value
      // must never leak a live Yjs type).
      const raw: TextRun[] = [];
      for (const op of value.toDelta() as TextDeltaOp[]) {
        if (typeof op.insert !== "string") continue;
        raw.push({ text: op.insert, marks: attrsToMarkSet(op.attributes) });
      }
      const runs = normalizeRuns(raw);
      if (runs.length > 0) setOwn(block, key, runs);
      continue;
    }
    // The open key comes from the CRDT (the reserved-key's stand — the
    // own data key, the prototype untouched).
    setOwn(block, key, readPlainValue(value));
  }

  return block;
}

export { readOpaqueBlock };
