/**
 * Chain-level text range commands: deleteTextRange, setMarkRange.
 *
 * A cross-block range spans the DFS chain between its endpoint blocks (the
 * reading-order chain the selection engine maintains). The range is
 * resolved per block: the from block's tail [from.offset, end), every block
 * strictly between (a text block in full, a non-text block removed whole),
 * the to block's head [0, to.offset). One command = one local transaction:
 * one undo step, one wire update.
 *
 * Postures:
 * - deleteTextRange removes the fully covered middle blocks of any type
 *   (a block's children cascade with it, v1) and removes the endpoint
 *   blocks whose whole text lies inside the range (their children cascade
 *   too). The returned caret seam: the from block's range start when that
 *   block keeps a prefix (offset > 0), the to block's start when it keeps
 *   a suffix (offset < its length), else the first block with text at or
 *   after the deleted interval; null when the document carries no text
 *   left at all.
 * - setMarkRange applies the mark to the per-block segments; the per-block
 *   setMark rejects marks in a code block, so the cross command rejects
 *   the whole range when any covered text block is a code block.
 * - A same-block range delegates to the per-block command (which keeps the
 *   block: deleteText never removes it; the seam is the range start).
 */
import * as Y from "yjs";

import { BLOCK_REGISTRY, validateMarkSet } from "@docblocks-core/schema";
import type { BlockId } from "@docblocks-core/schema";

import {
  InvalidMarkError,
  InvalidOperationError,
  InvalidRangeError,
  UnknownBlockError,
  formatValidationErrors,
} from "../errors";
import { localTransact, rootBlockIdOf } from "../layout";
import { readText } from "../read";
import { linearize } from "../selection/rebase";
import type { Linearizable } from "../selection/rebase";
import { getBlockMap } from "./blocks";
import { removeBlock } from "./blocks";
import { markInputToMark, setMark } from "./marks";
import type { MarkInput } from "./marks";
import { blockTypeOf, childrenOf } from "./structure";
import { contentTextLength, deleteText } from "./text";

/** A structural point in a block's flattened text (the selection's point shape). */
type RangePoint = { blockId: BlockId; offset: number };

/** A validated point: the block's text length is the offset boundary. */
interface ValidPoint {
  blockId: BlockId;
  offset: number;
  length: number;
}

/** The linearization surface over the raw ydoc (the root id + the children walk). */
function surfaceOf(ydoc: Y.Doc): Linearizable {
  return {
    meta: { id: rootBlockIdOf(ydoc) },
    getChildren: (id: BlockId) => childrenOf(ydoc, id)?.toArray() ?? [],
  };
}

/** The point's block must exist and carry text; the offset must be in range. */
function requireTextPoint(ydoc: Y.Doc, point: RangePoint, label: string): ValidPoint {
  const block = getBlockMap(ydoc, point.blockId);
  if (block === null) throw new UnknownBlockError(`Unknown block "${point.blockId}".`);
  const type = blockTypeOf(ydoc, point.blockId);
  if (type === null) throw new UnknownBlockError(`Unknown block "${point.blockId}".`);
  const noText = new InvalidOperationError(`Block "${point.blockId}" (type "${type}") has no text content.`);
  if (!BLOCK_REGISTRY[type].content) throw noText;
  const content = block.get("content");
  if (!(content instanceof Y.Array)) throw noText;
  const length = contentTextLength(content as Y.Array<Y.Map<unknown>>);
  if (!Number.isInteger(point.offset) || point.offset < 0 || point.offset > length) {
    throw new InvalidRangeError(
      `${label} offset ${point.offset} is outside [0, ${length}] of block "${point.blockId}".`
    );
  }
  return { blockId: point.blockId, offset: point.offset, length };
}

/**
 * The DFS chain between the two points, from-block first. The to point
 * must come after the from point in document order (and both must be
 * reachable); otherwise the range is inverted or does not exist.
 */
function chainSpan(ydoc: Y.Doc, fromId: BlockId, toId: BlockId): { chain: BlockId[]; toIndex: number } {
  const linearization = linearize(surfaceOf(ydoc));
  const fromIndex = linearization.indexOf(fromId);
  const toIndex = linearization.indexOf(toId);
  if (fromIndex === -1 || toIndex === -1) {
    throw new InvalidRangeError(`Range endpoint "${toId}" is not reachable from the root.`);
  }
  if (toIndex < fromIndex) {
    throw new InvalidRangeError(`The to point "${toId}" must come after the from point "${fromId}" in document order.`);
  }
  return { chain: linearization.slice(fromIndex, toIndex + 1), toIndex };
}

/**
 * Deletes the cross-block text range [from, to).
 *
 * Same block: delegates to deleteText (the block is kept, the seam is the
 * range start). Cross: one local transaction over the DFS chain — the from
 * block's tail, the middle blocks (removed whole, any type), the to block's
 * head, then the endpoint blocks the trim emptied (their children cascade
 * with them, v1). Returns the caret seam (see the module header); a block
 * that a previous cascade in the same batch already removed is skipped.
 */
function deleteTextRange(ydoc: Y.Doc, from: RangePoint, to: RangePoint): RangePoint | null {
  const fromPoint = requireTextPoint(ydoc, from, "from");
  const toPoint = requireTextPoint(ydoc, to, "to");
  if (fromPoint.blockId === toPoint.blockId) {
    deleteText(ydoc, fromPoint.blockId, fromPoint.offset, toPoint.offset);
    return { blockId: fromPoint.blockId, offset: fromPoint.offset };
  }
  const { chain, toIndex } = chainSpan(ydoc, fromPoint.blockId, toPoint.blockId);
  const linearization = linearize(surfaceOf(ydoc));
  const toSurvives = toPoint.offset < toPoint.length;

  localTransact(ydoc, () => {
    // The from block's tail: a no-op when the range starts at its end.
    deleteText(ydoc, fromPoint.blockId, fromPoint.offset, fromPoint.length);
    // Every middle block in full. A block a previous cascade already
    // removed (the chain is DFS-ordered: a parent precedes its children)
    // is skipped.
    for (const id of chain.slice(1, -1)) {
      if (getBlockMap(ydoc, id) !== null) removeBlock(ydoc, id);
    }
    // The to block's head: a no-op when the range ends at its start. A to
    // block that a cascade already removed (it sat inside a removed block's
    // subtree) is skipped.
    if (getBlockMap(ydoc, toPoint.blockId) !== null) {
      deleteText(ydoc, toPoint.blockId, 0, toPoint.offset);
    }
    // The endpoint blocks the trim emptied are removed (offset 0: the whole
    // from text; offset at the end: the whole to text).
    if (fromPoint.offset === 0 && getBlockMap(ydoc, fromPoint.blockId) !== null) {
      removeBlock(ydoc, fromPoint.blockId);
    }
    if (toPoint.offset === toPoint.length && getBlockMap(ydoc, toPoint.blockId) !== null) {
      removeBlock(ydoc, toPoint.blockId);
    }
  });

  if (fromPoint.offset > 0) return { blockId: fromPoint.blockId, offset: fromPoint.offset };
  if (toSurvives && getBlockMap(ydoc, toPoint.blockId) !== null) return { blockId: toPoint.blockId, offset: 0 };
  return seamAfterInterval(ydoc, linearization, toIndex);
}

/**
 * The seam when both endpoints were consumed: the first block with text at
 * or after the deleted interval (pre-change DFS order); null when no text
 * remains at or after it.
 */
function seamAfterInterval(ydoc: Y.Doc, preLinearization: readonly BlockId[], toIndex: number): RangePoint | null {
  for (const id of linearize(surfaceOf(ydoc))) {
    if (preLinearization.indexOf(id) <= toIndex) continue; // before the interval
    const type = blockTypeOf(ydoc, id);
    if (type === null || !BLOCK_REGISTRY[type].content) continue;
    if (readText(ydoc, id).length === 0) continue;
    return { blockId: id, offset: 0 };
  }
  return null;
}

/**
 * Applies `mark` to the cross-block text range [from, to): the from block's
 * tail, every middle text block in full (non-text blocks carry no text and
 * are skipped), the to block's head — one local transaction. Same block:
 * delegates to setMark. The mark and every covered text block are
 * validated before the transaction, so the per-block setMark calls inside
 * the batch cannot throw (a failed batch would commit partially): a code
 * block in the range rejects the whole range (the per-block posture).
 */
function setMarkRange(ydoc: Y.Doc, from: RangePoint, to: RangePoint, mark: MarkInput): void {
  const { markSet } = markInputToMark(mark);
  const markErrors = validateMarkSet("paragraph", markSet);
  if (markErrors.length > 0) {
    throw new InvalidMarkError(`Invalid mark for the range: ${formatValidationErrors(markErrors)}`);
  }
  const fromPoint = requireTextPoint(ydoc, from, "from");
  const toPoint = requireTextPoint(ydoc, to, "to");
  if (fromPoint.blockId === toPoint.blockId) {
    setMark(ydoc, fromPoint.blockId, fromPoint.offset, toPoint.offset, mark);
    return;
  }
  const { chain } = chainSpan(ydoc, fromPoint.blockId, toPoint.blockId);
  // The per-block posture: marks are rejected in a code block — the whole
  // range is rejected when a covered text block is one (checked before the
  // transaction: the per-block calls inside the batch must not throw).
  for (const id of [fromPoint.blockId, ...chain.slice(1, -1), toPoint.blockId]) {
    const type = blockTypeOf(ydoc, id);
    if (type === null || !BLOCK_REGISTRY[type].content) continue; // no text
    if (type === "code") throw new InvalidOperationError(`Marks cannot be applied in a code block "${id}".`);
  }
  const middle: string[] = [];
  for (const id of chain.slice(1, -1)) {
    const type = blockTypeOf(ydoc, id);
    if (type !== null && BLOCK_REGISTRY[type].content) middle.push(id);
  }

  localTransact(ydoc, () => {
    setMark(ydoc, fromPoint.blockId, fromPoint.offset, fromPoint.length, mark);
    for (const id of middle) {
      setMark(ydoc, id, 0, contentTextLengthOf(ydoc, id), mark);
    }
    setMark(ydoc, toPoint.blockId, 0, toPoint.offset, mark);
  });
}

/** The stored text length of a block (the middle segment boundary). */
function contentTextLengthOf(ydoc: Y.Doc, blockId: BlockId): number {
  const block = getBlockMap(ydoc, blockId);
  const content = block?.get("content");
  return content instanceof Y.Array ? contentTextLength(content as Y.Array<Y.Map<unknown>>) : 0;
}

export { deleteTextRange, setMarkRange };
export type { RangePoint };
