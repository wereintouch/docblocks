/** The keyboard unit's helpers: the mark-toggle action, the sibling text
 *  block lookup, the parent block id, and the cell descent target. */
import { BLOCK_REGISTRY } from "docblocks-core";
import type { BlockId, Doc } from "docblocks-core";

import type { FormatMark } from "./models";

/**
 * The toggle decision for one mark over [from, to): "unset" when every run
 * overlapping the range already carries the mark, "set" otherwise. A
 * partially covered run counts only if it carries the mark. Reads the block
 * snapshot via `getBlock`; the caller issues the command.
 */
function markToggleAction(doc: Doc, blockId: BlockId, from: number, to: number, mark: FormatMark): "set" | "unset" {
  const block = doc.getBlock(blockId);
  if (block === null || !("content" in block)) return "set";
  let pos = 0;
  let overlaps = false;
  for (const run of block.content ?? []) {
    const start = pos;
    pos += run.text.length;
    if (pos <= from || start >= to) continue;
    overlaps = true;
    if (run.marks[mark] !== true) return "set";
  }
  return overlaps ? "unset" : "set";
}

/**
 * The adjacent sibling a cross-block arrow can land in: the nearest
 * previous/next sibling whose type carries text content — non-text siblings
 * (divider, image, ...) are skipped. Null when nothing with content remains
 * in that direction.
 */
function findSiblingTextBlock(
  doc: Doc,
  id: BlockId,
  parentId: BlockId,
  direction: "previous" | "next"
): { id: BlockId; length: number } | null {
  const siblings = doc.getChildren(parentId);
  const index = siblings.indexOf(id);
  if (index === -1) return null;
  const step = direction === "previous" ? -1 : 1;
  for (let i = index + step; i >= 0 && i < siblings.length; i += step) {
    const siblingId = siblings[i];
    if (siblingId === undefined) return null;
    const sibling = doc.getBlock(siblingId);
    if (sibling === null || !BLOCK_REGISTRY[sibling.type].content) continue;
    return { id: siblingId, length: doc.getTextLength(siblingId) };
  }
  return null;
}

/**
 * The parent of a block element: the nearest block wrapper above it (the
 * nested children render inside the parent's wrapper), or the document
 * root when it stands at the top level.
 */
function parentBlockIdOf(blockEl: HTMLElement, doc: Doc): BlockId {
  const wrapper = blockEl.parentElement;
  const parent = wrapper?.parentElement?.closest<HTMLElement>("[data-block-id]") ?? null;
  return parent?.dataset.blockId ?? doc.meta.id;
}

/**
 * The down-edge descent of a focused text block's cell's own content
 * layer: the layer stands above the cell's children sequence, so the
 * first text child takes the caret (the row's sibling walk finds the next
 * cell instead). Null for every other block or edge.
 */
function cellDescendTarget(doc: Doc, focusBlockId: BlockId): { id: BlockId; length: number } | null {
  const block = doc.getBlock(focusBlockId);
  if (block === null || block.type !== "table-cell") return null;
  for (const childId of doc.getChildren(focusBlockId)) {
    if (childId === undefined) return null;
    const child = doc.getBlock(childId);
    if (child === null || !BLOCK_REGISTRY[child.type].content) continue;
    return { id: childId, length: doc.getTextLength(childId) };
  }
  return null;
}

export { cellDescendTarget, findSiblingTextBlock, markToggleAction, parentBlockIdOf };
