/**
 * The per-block text/children reads: the normalized runs of a text block,
 * the ordered child ids (the owner filter, the dangling-id drop), the
 * flattened run text.
 */
import * as Y from "yjs";

import { BLOCK_REGISTRY } from "@docblocks-core/schema";
import type { BlockId, TextRun } from "@docblocks-core/schema";

import { rootBlockIdOf, rootOrderOf } from "../layout";
import { normalizeRuns } from "../normalize";
import { attrsToMarkSet } from "../text-model";
import type { TextDeltaOp } from "../text-model";
import { dedupeOrder, isKnownBlockType } from "./values";

function getBlockMap(ydoc: Y.Doc, id: string): Y.Map<unknown> | null {
  const blocks = ydoc.getMap("blocks");
  const block = blocks.get(id);
  return block instanceof Y.Map ? block : null;
}

/** Normalized runs of a text block; [] for non-text types or missing blocks. */
function readRuns(ydoc: Y.Doc, blockId: string): TextRun[] {
  const yblock = getBlockMap(ydoc, blockId);
  if (!yblock) return [];
  const type = yblock.get("type");
  if (!isKnownBlockType(type) || !BLOCK_REGISTRY[type].content) return [];
  const content = yblock.get("content");
  if (!(content instanceof Y.Text)) return [];
  // The runs stand the Y.Text's delta: each insert op is a span carrying its
  // marks as the character attributes.
  const raw: TextRun[] = [];
  for (const op of content.toDelta() as TextDeltaOp[]) {
    if (typeof op.insert !== "string") continue;
    raw.push({ text: op.insert, marks: attrsToMarkSet(op.attributes) });
  }
  return normalizeRuns(raw);
}

/** Ordered child ids; [] for non-containers or missing blocks. */
function readChildren(ydoc: Y.Doc, id: string): BlockId[] {
  const yblock = getBlockMap(ydoc, id);
  if (!yblock) return [];
  const type = yblock.get("type");
  if (!isKnownBlockType(type) || !BLOCK_REGISTRY[type].children) return [];
  // A concurrent move + remove of the same block can converge to a
  // re-inserted order id with no block entry (the move's delete + reinsert
  // and the remove's delete race on the same array element). The lenient
  // reader drops the dangling id (the raw Yjs layer keeps it — doc.raw is
  // the escape hatch); the strict validator still rejects it in JSON.
  const present = (childId: string) => getBlockMap(ydoc, childId) !== null;
  // The owner filter: a concurrent move can leave the id in two containers'
  // arrays; the block's `parent` field (set by insert/move/load) is the
  // single owner. Only the owner's array lists the block in the snapshot —
  // the non-owner containers' arrays drop the phantom. Legacy blocks (no
  // field) keep the array membership stand.
  const ownedBySelf = (childId: string): boolean => {
    const childMap = getBlockMap(ydoc, childId);
    if (childMap === null) return false;
    const parent = childMap.get("parent");
    if (typeof parent === "string" && parent !== "") return parent === id;
    return true;
  };
  // The root block's order lives in the registered rootOrder array.
  if (id === rootBlockIdOf(ydoc)) {
    return dedupeOrder(
      rootOrderOf(ydoc)
        .toArray()
        .filter((childId): childId is string => typeof childId === "string" && present(childId) && ownedBySelf(childId))
    );
  }
  const children = yblock.get("children");
  if (!(children instanceof Y.Array)) return [];
  return dedupeOrder(
    children
      .toArray()
      .filter((childId): childId is string => typeof childId === "string" && present(childId) && ownedBySelf(childId))
  );
}

/** Flattened run text; "" for non-text types or missing blocks. */
function readText(ydoc: Y.Doc, blockId: string): string {
  let text = "";
  for (const run of readRuns(ydoc, blockId)) text += run.text;
  return text;
}

export { getBlockMap, readChildren, readRuns, readText };
