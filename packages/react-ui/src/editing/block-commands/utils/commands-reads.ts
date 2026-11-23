/**
 * The page sequence's shared reads (the `./commands`'s helpers): the
 * block's flattened text and runs, the effective indent, the parent's
 * document scan, and the derived segment range.
 */
import type { Block, BlockId, Doc, TextRun } from "docblocks-core";

/** The flattened text of the runs. */
function textOf(runs: TextRun[]): string {
  return runs.reduce((text, run) => text + run.text, "");
}

/**
 * The runs of a block snapshot: `content` is omitted from a snapshot when
 * the runs are empty, so an absent field and an empty list are the same.
 */
function runsOf(block: Block): TextRun[] {
  return "content" in block ? (block.content ?? []) : [];
}

/** The block's effective indent: a non-negative integer attr; absent is 0. */
function indentOf(doc: Doc, id: BlockId): number {
  const block = doc.getBlock(id);
  if (block === null || !("attrs" in block)) return 0;
  const indent = (block.attrs as { indent?: unknown } | undefined)?.indent;
  return typeof indent === "number" && Number.isInteger(indent) && indent >= 0 ? indent : 0;
}

/**
 * The parent id of a block: the single block whose children hold it (the
 * page context for a page block — the root, a table cell, or a frame). A
 * document scan — gestures are user-driven and v1 documents are small.
 */
function findParentId(doc: Doc, id: BlockId): BlockId | null {
  const blocks = doc.toJSON().blocks;
  for (const [parentId, block] of Object.entries(blocks)) {
    if ("children" in block && block.children !== undefined && block.children.includes(id)) return parentId;
  }
  return null;
}

/**
 * The derived subtree of a block in its page sequence: the
 * contiguous segment from the block to the first following block with
 * `indent` <= the block's own (the block inclusive). The core's removeBlock
 * cascades this derived segment too — a gesture that removes the segment
 * head may rely on the cascade, and the blocks-kind delete de-duplicates
 * against it (a live read skips ids the cascade already took).
 */
function segmentRange(doc: Doc, contextId: BlockId, id: BlockId): { start: number; end: number } | null {
  const sequence = doc.getChildren(contextId);
  const start = sequence.indexOf(id);
  if (start === -1) return null;
  const indent = indentOf(doc, id);
  let end = start + 1;
  while (end < sequence.length && indentOf(doc, sequence[end]!) > indent) end += 1;
  return { start, end };
}

export { findParentId, indentOf, runsOf, segmentRange, textOf };
