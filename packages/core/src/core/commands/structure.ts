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
 * Only the registry containers carry one: the remodeled page types are
 * structurally childless in the flat page model (their nesting is the
 * `indent` attr), so any legacy `children` field a remote state may still
 * carry is not a parent context.
 */
function childrenOf(ydoc: Y.Doc, id: string): Y.Array<string> | null {
  if (id === rootBlockIdOf(ydoc)) return rootOrderOf(ydoc);
  const type = blockTypeOf(ydoc, id);
  if (type === null || !BLOCK_REGISTRY[type].children) return null;
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

/** The block's effective `indent` (absent or corrupt is 0). */
function indentOfBlock(ydoc: Y.Doc, id: string): number {
  const block = getBlockMap(ydoc, id);
  if (!block) return 0;
  const attrs = block.get("attrs");
  if (!(attrs instanceof Y.Map)) return 0;
  const indent = attrs.get("indent");
  return typeof indent === "number" && Number.isInteger(indent) ? indent : 0;
}

/** True when the block is a page-sequence container (root / cell / frame). */
function isPageSequence(ydoc: Y.Doc, id: string): boolean {
  const type = blockTypeOf(ydoc, id);
  return type !== null && BLOCK_REGISTRY[type].sequence === true;
}

/**
 * The indent-jump rule of a flat page sequence over a
 * POST-change snapshot: `childIds` is the sequence after the change,
 * `index` the position of the checked block. Returns a violation
 * message, or null when the position keeps the rule (the first block of
 * a sequence anchors at indent 0; any other block may exceed the
 * preceding block's indent by at most 1).
 */
function indentJumpViolation(ydoc: Y.Doc, childIds: string[], index: number, indent: number): string | null {
  if (index === 0 && indent > 0) {
    return `the first block of a page sequence must have indent 0 (got ${indent})`;
  }
  const prevId = childIds[index - 1];
  if (prevId !== undefined && indent > indentOfBlock(ydoc, prevId) + 1) {
    return `indent ${indent} must not exceed the preceding block's indent (${indentOfBlock(ydoc, prevId)}) by more than 1`;
  }
  return null;
}

/** The array-search owner: the container whose children list holds `id`. */
function findParentInArrays(ydoc: Y.Doc, id: string): BlockId | null {
  // Top level first (the root's order is the registered array, and the root
  // entry carries no children field), then each container entry's children
  // (the registry containers only — see childrenOf); the first match wins.
  if (rootOrderOf(ydoc).toArray().includes(id)) return rootBlockIdOf(ydoc);
  const blocks = getBlocks(ydoc);
  let parent: BlockId | null = null;
  blocks.forEach((block, blockId) => {
    if (parent !== null || !(block instanceof Y.Map)) return;
    const type = block.get("type");
    if (typeof type !== "string" || !(type in BLOCK_REGISTRY) || !BLOCK_REGISTRY[type as BlockType].children) return;
    const children = block.get("children");
    if (children instanceof Y.Array && (children as Y.Array<string>).toArray().includes(id)) parent = blockId;
  });
  return parent;
}

/**
 * The block's owner parent: the single CRDT-resolved `parent` field (set by
 * insert/move/load). A concurrent move can leave the id in two containers'
 * children arrays; the field stands over the array membership as the one
 * source of ownership. Falls back to the array search when the field is
 * absent (legacy state). Returns null for the root and orphans.
 */
function findParent(ydoc: Y.Doc, id: string): BlockId | null {
  if (id === rootBlockIdOf(ydoc)) return null;
  const block = getBlockMap(ydoc, id);
  if (block === null) return null;
  const parent = block.get("parent");
  if (typeof parent === "string" && parent !== "") return parent;
  return findParentInArrays(ydoc, id);
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

export {
  blockTypeOf,
  childrenOf,
  findParent,
  getBlockMap,
  getBlocks,
  indentJumpViolation,
  indentOfBlock,
  isDescendant,
  isPageSequence,
  readCols,
};
