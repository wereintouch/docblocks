/**
 * Shared block layout accessors: raw Yjs reads over the flat blocks map
 * (blocks map, block map, registry type, children, table `cols`) plus
 * parent and descendant lookups, shared by the command modules.
 */
import * as Y from "yjs";

import { BLOCK_REGISTRY } from "@docblocks-core/schema";
import type { BlockId, BlockType } from "@docblocks-core/schema";

import { rootBlockIdOf, rootOrderOf } from "../layout";

/** The blocks map of the document (throws on a broken layout). */
function getBlocks(ydoc: Y.Doc): Y.Map<unknown> {
  const blocks = ydoc.getMap("blocks");
  if (!(blocks instanceof Y.Map)) throw new Error("docblocks: broken Yjs layout (blocks map missing)");
  return blocks;
}

/** Y.Map of the block; null when absent. */
function getBlockMap(ydoc: Y.Doc, id: string): Y.Map<unknown> | null {
  const block = getBlocks(ydoc).get(id);
  return block instanceof Y.Map ? block : null;
}

/** Registry type of the block; null when the block is missing or corrupt. */
function blockTypeOf(ydoc: Y.Doc, id: string): BlockType | null {
  const block = getBlockMap(ydoc, id);
  if (!block) return null;
  const type = block.get("type");
  return typeof type === "string" && type in BLOCK_REGISTRY ? (type as BlockType) : null;
}

/**
 * The block's raw children array; null when the block has none. The root
 * block's children are the registered rootOrder array, not an entry field.
 */
function childrenOf(ydoc: Y.Doc, id: string): Y.Array<string> | null {
  if (id === rootBlockIdOf(ydoc)) return rootOrderOf(ydoc);
  const block = getBlockMap(ydoc, id);
  if (!block) return null;
  const children = block.get("children");
  return children instanceof Y.Array ? (children as Y.Array<string>) : null;
}

/** The table's `cols` attr; null when the block or the attr is missing/corrupt. */
function readCols(ydoc: Y.Doc, id: string): number | null {
  const block = getBlockMap(ydoc, id);
  if (!block) return null;
  const attrs = block.get("attrs");
  if (!(attrs instanceof Y.Map)) return null;
  const cols = attrs.get("cols");
  return typeof cols === "number" && Number.isInteger(cols) ? cols : null;
}

/** The container whose children list holds `id`; null for orphans. */
function findParent(ydoc: Y.Doc, id: string): BlockId | null {
  // Top level first (the root's order is the registered array, and the root
  // entry carries no children field), then each entry's children; the first
  // match wins.
  if (rootOrderOf(ydoc).toArray().includes(id)) return rootBlockIdOf(ydoc);
  const blocks = getBlocks(ydoc);
  let parent: BlockId | null = null;
  blocks.forEach((block, blockId) => {
    if (parent !== null || !(block instanceof Y.Map)) return;
    const children = block.get("children");
    if (children instanceof Y.Array && (children as Y.Array<string>).toArray().includes(id)) parent = blockId;
  });
  return parent;
}

/** True when `candidate` is inside the subtree rooted at `ancestor`. */
function isDescendant(ydoc: Y.Doc, ancestor: string, candidate: string): boolean {
  const queue = [ancestor];
  const visited = new Set<string>([ancestor]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const children = childrenOf(ydoc, current);
    if (children === null) continue;
    for (const child of children.toArray()) {
      if (child === candidate) return true;
      if (!visited.has(child)) {
        visited.add(child);
        queue.push(child);
      }
    }
  }
  return false;
}

export { blockTypeOf, childrenOf, findParent, getBlockMap, getBlocks, isDescendant, readCols };
