/**
 * The block gestures' structural ops (the `./commands`'s helpers): the
 * blocks-selection removal over the derived segments, the
 * trailing-paragraph stand, the same-type insert, and the runs' range
 * copy.
 */
import { BLOCK_REGISTRY } from "docblocks-core";
import type { Block, BlockId, Doc, TextRun } from "docblocks-core";

import { indentOf, segmentRange } from "./commands-reads";

/**
 * The gutter (blocks) selection removal: each selected block's derived
 * segment (its deeper followers) goes with it — the core's removeBlock
 * cascades the segment, so the removals run head-first and skip what a
 * previous cascade already took. One transact (one undo step, one wire
 * update), including the document root's trailing-paragraph stand. A surface
 * in the selection is skipped: it is a canvas layer (not rendered in the page
 * view), and the page gesture's removal would cascade the whole surface (its
 * figures) — the surface's removal is the core API's, not a page gesture's.
 *
 * The returned caret home is the next surviving text block, then the previous
 * one, then the stood trailing paragraph. Null means the caller parks focus on
 * the editor root to keep the undo hotkey reachable.
 */
function removeBlocksSelection(
  doc: Doc,
  parentId: BlockId,
  ids: BlockId[]
): { blockId: BlockId; offset: number } | null {
  const before = doc.getChildren(parentId);
  const indexes = ids.map((id) => before.indexOf(id)).filter((index) => index >= 0);
  if (indexes.length === 0) return null;
  const removalIndex = Math.min(...indexes);

  doc.transact(() => {
    for (const blockId of ids) {
      const block = doc.getBlock(blockId);
      if (block === null) continue; // a previous cascade took it
      if (block.type === "surface") continue;
      const segment = segmentRange(doc, parentId, blockId);
      if (segment === null) continue;
      const sequence = doc.getChildren(parentId);
      for (let i = segment.start; i < segment.end; i += 1) {
        const segId = sequence[i];
        if (segId !== undefined && doc.getBlock(segId) !== null) doc.removeBlock(segId);
      }
    }
    if (parentId === doc.meta.id) ensureTrailingParagraph(doc, parentId);
  });

  const survivors = doc.getChildren(parentId);
  for (let i = removalIndex; i < survivors.length; i += 1) {
    const id = survivors[i];
    const block = id === undefined ? null : doc.getBlock(id);
    if (id !== undefined && block !== null && BLOCK_REGISTRY[block.type].content) {
      return { blockId: id, offset: 0 };
    }
  }
  for (let i = Math.min(removalIndex - 1, survivors.length - 1); i >= 0; i -= 1) {
    const id = survivors[i];
    const block = id === undefined ? null : doc.getBlock(id);
    if (id !== undefined && block !== null && BLOCK_REGISTRY[block.type].content) {
      return { blockId: id, offset: doc.getText(id).length };
    }
  }
  return null;
}

/**
 * The page sequence's tail guarantee: a non-text last block (a database /
 * image / table / divider — or the empty sequence) stands no caret home
 * and no delete stand over the sequence's end, so an empty paragraph
 * stands after it (the paste / slash's trailing-paragraph contract,
 * generalized to every sequence-stand). The caller runs it inside its own
 * transact when the stand must share the gesture's one undo step.
 * Returns the stood paragraph's id (the caret's home), or null when the
 * tail already stands a text block (no stand, the caller's focus stands).
 */
/** Stands the document's trailing paragraph (the tail contract) and returns
 *  its id, or null when the tail already stands. The paragraph takes the
 *  RESERVED id derived from the doc id, which makes the stand idempotent
 *  across peers: two peers standing the same non-text tail insert the same
 *  block id, and the idempotent insert converges to one block (per-peer
 *  uuids would leave a duplicate paragraph in every peer). A reserved
 *  paragraph that stands somewhere else in the doc (the user moved it)
 *  wins: the stand writes nothing. */
function ensureTrailingParagraph(doc: Doc, parentId: BlockId): BlockId | null {
  const tailId = `${doc.meta.id}-tail`;
  if (doc.getBlock(tailId) !== null) return null;
  try {
    const sequence = doc.getChildren(parentId);
    const lastId = sequence[sequence.length - 1];
    if (lastId === undefined) return doc.insertBlock("paragraph", undefined, { parent: parentId, id: tailId });
    const last = doc.getBlock(lastId);
    if (last === null) return null;
    if (BLOCK_REGISTRY[last.type].content) return null;
    return doc.insertBlock("paragraph", undefined, { parent: parentId, after: lastId, id: tailId });
  } catch (error) {
    // The deterministic id makes a concurrent peer stand (or a peer update
    // applied between the check and the write) the only source of an id
    // collision — the stand then stands nothing: the peer's paragraph is
    // the tail.
    if (doc.getBlock(tailId) !== null) return null;
    throw error;
  }
}

/** Inserts a block of the same type and attrs as `block`, right after `after` under `parent` (the indent stands). */
function insertSameTypeAfter(doc: Doc, block: Block, parent: BlockId, after: BlockId): BlockId {
  const indent = indentOf(doc, after);
  switch (block.type) {
    case "heading":
      return doc.insertBlock("heading", { level: block.attrs.level, indent }, { parent, after });
    case "list-item":
      // A new item's check stands UNSET (a checked task's Enter must not
      // spawn a checked sibling — the placeholder would stand struck).
      return doc.insertBlock("list-item", { list: block.attrs.list, indent }, { parent, after });
    case "callout":
      return doc.insertBlock(
        "callout",
        block.attrs?.variant !== undefined ? { variant: block.attrs.variant, indent } : { indent },
        { parent, after }
      );
    case "code":
      return doc.insertBlock(
        "code",
        block.attrs?.language !== undefined ? { language: block.attrs.language, indent } : { indent },
        { parent, after }
      );
    case "canvas-text":
      return doc.insertBlock("canvas-text", block.attrs !== undefined ? { ...block.attrs } : undefined, {
        parent,
        after,
      });
    case "quote":
      // The optional align does not ride the split: a new quote starts with
      // the default alignment (the same as a new paragraph).
      return doc.insertBlock("quote", indent !== 0 ? { indent } : undefined, { parent, after });
    default:
      return doc.insertBlock("paragraph", indent !== 0 ? { indent } : undefined, { parent, after });
  }
}

/**
 * Copies the runs covering flattened offsets [from, to) into `targetId`
 * at `targetPos`, reapplying each run's marks (a plain-text copy would
 * silently drop them).
 */
function copyRunsRange(
  doc: Doc,
  runs: TextRun[],
  from: number,
  to: number,
  targetId: BlockId,
  targetPos: number
): void {
  let pos = 0;
  let cursor = targetPos;
  for (const run of runs) {
    const start = pos;
    pos += run.text.length;
    if (pos <= from || start >= to) continue;
    const piece = run.text.slice(Math.max(0, from - start), Math.min(run.text.length, to - start));
    if (piece === "") continue;
    doc.insertText(targetId, cursor, piece, run.marks);
    cursor += piece.length;
  }
}

export { copyRunsRange, ensureTrailingParagraph, insertSameTypeAfter, removeBlocksSelection };
