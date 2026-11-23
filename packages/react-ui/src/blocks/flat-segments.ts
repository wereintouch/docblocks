/** The flat page model's sequence reads: the entry root's sequence
 *  container (the command parent) and the derived subtree segment, from
 *  a plain blocks map (no doc snapshot). */
import { BLOCK_REGISTRY } from "docblocks-core";
import type { Block, BlockId, BlockType, Doc, OpaqueBlock } from "docblocks-core";

import { indentOf } from "./flat";

/**
 * The sequence container of a provider's entry root, from a plain blocks
 * map (the store's projection — no doc snapshot): the entry root's own id
 * when it is a page-sequence container (the document root, a table cell,
 * a frame — its children are the entry sequence), otherwise the id of the
 * page-sequence container whose children hold the entry root. A page
 * block's nesting is the sequence's `indent` attr — the block is
 * structurally childless, so a command's `parent` must be the sequence's
 * container, not the block. A dangling entry root, or one under a
 * structural container (a table row, a surface — where the indent is not
 * the nesting), stands alone.
 */
function sequenceContainerOf(blocks: Record<BlockId, Block | OpaqueBlock>, entryRootId: BlockId): BlockId {
  const entry = blocks[entryRootId];
  if (
    entry !== undefined &&
    Object.hasOwn(BLOCK_REGISTRY, entry.type) &&
    BLOCK_REGISTRY[entry.type as BlockType]?.sequence
  )
    return entryRootId;
  for (const [parentId, candidate] of Object.entries(blocks)) {
    const children = "children" in candidate ? candidate.children : undefined;
    if (children !== undefined && children.includes(entryRootId)) {
      // The own-property stand: a prototype-key type name is an unknown
      // type (the inherited member is not a registry spec).
      const spec = Object.hasOwn(BLOCK_REGISTRY, candidate.type)
        ? BLOCK_REGISTRY[candidate.type as BlockType]
        : undefined;
      return spec !== undefined && spec.sequence ? parentId : entryRootId;
    }
  }
  return entryRootId;
}

/**
 * The command parent of a provider's entry root (the entry list's gesture
 * context): the entry root's sequence container (the document scan — the
 * entry root resolves once per provider render and the drag commit;
 * v1 documents are small).
 */
function entrySequenceParent(doc: Doc, entryRootId: BlockId): BlockId {
  if (entryRootId === doc.meta.id) return entryRootId;
  return sequenceContainerOf(doc.toJSON().blocks, entryRootId);
}

/**
 * The derived subtree (entry list) of a subtree entry's root, from a plain
 * blocks map (no doc snapshot): the contiguous stretch of the entry root's
 * page sequence (the container's children) from the block to the first
 * following block with `indent` <= its own (the block inclusive). A
 * container entry root (or a standalone one — a structural parent, a
 * dangling root) stands alone.
 */
function subtreeSegmentOf(blocks: Record<BlockId, Block>, containerId: BlockId, entryRootId: BlockId): BlockId[] {
  if (containerId === entryRootId) return [entryRootId];
  const container = blocks[containerId];
  const sequence = container !== undefined && "children" in container ? container.children : undefined;
  if (sequence === undefined) return [entryRootId];
  const index = sequence.indexOf(entryRootId);
  if (index === -1) return [entryRootId];
  const own = indentOf(blocks[entryRootId]);
  const out: BlockId[] = [entryRootId];
  for (let i = index + 1; i < sequence.length; i += 1) {
    const other = sequence[i];
    if (other === undefined) break;
    if (indentOf(blocks[other]) <= own) break;
    out.push(other);
  }
  return out;
}

export { entrySequenceParent, sequenceContainerOf, subtreeSegmentOf };
