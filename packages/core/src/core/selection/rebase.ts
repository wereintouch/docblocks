import type { BlockId } from "@docblocks-core/schema";

import type { TextDelta } from "./deltas";
import type { Selection, TextPoint } from "./selection";

/**
 * Pure selection rebase: map a selection over the document changes of one
 * transaction (text deltas + structural facts, all post-change).
 *
 * Point rule for a delta { pos, inserted, deleted } over old offset `o`:
 * `o - clamp(o - pos, 0, deleted) + (o > pos ? inserted : 0)` — an insertion
 * exactly at the caret does not move it; a deletion covering the caret keeps
 * it at the deletion start. Offsets are then clamped to the new block length;
 * a range that ends up inverted collapses to a caret at the clamped `from`.
 */

/** Structural facts of the post-change document, gathered by the caller. */
interface StructuralFacts {
  /** Block ids removed by the change. */
  deletedIds: ReadonlySet<BlockId>;
  /** DFS (reading) order of every block, post-change. */
  linearization: readonly BlockId[];
  /** Flattened text length of a block, post-change. */
  textLength: (blockId: BlockId) => number;
  /** Whether a block carries text content, post-change. */
  isTextBlock: (blockId: BlockId) => boolean;
}

/** Map one offset over a pos-sorted delta list, clamped to [0, newLength]. */
function rebaseOffset(offset: number, deltas: readonly TextDelta[], newLength: number): number {
  let o = offset;
  for (const delta of deltas) {
    const removed = Math.min(Math.max(o - delta.pos, 0), delta.deleted);
    o = o - removed + (o > delta.pos ? delta.inserted : 0);
  }
  return Math.min(Math.max(o, 0), newLength);
}

/**
 * The DFS chain between two blocks, ordered from-block first and to-block
 * last (reversed when the to-block precedes the from-block); null when
 * either block is not in the linearization.
 */
function chainBetween(linearization: readonly BlockId[], fromId: BlockId, toId: BlockId): BlockId[] | null {
  const a = linearization.indexOf(fromId);
  const b = linearization.indexOf(toId);
  if (a === -1 || b === -1) return null;
  const slice = linearization.slice(Math.min(a, b), Math.max(a, b) + 1);
  return a > b ? [...slice].reverse() : slice;
}

/** The document surface the linearization reads (the Doc's meta.id + getChildren). */
interface Linearizable {
  meta: { id: BlockId };
  getChildren(id: BlockId): readonly BlockId[];
}

/** DFS (reading) order of every block, starting at the root. */
function linearize(doc: Linearizable): BlockId[] {
  const order: BlockId[] = [];
  const visit = (id: BlockId): void => {
    order.push(id);
    for (const child of doc.getChildren(id)) visit(child);
  };
  visit(doc.meta.id);
  return order;
}

/** Rebase a selection over one transaction; `state` is left untouched. */
function rebaseSelection(
  state: Selection,
  deltas: ReadonlyMap<BlockId, readonly TextDelta[]>,
  facts: StructuralFacts
): Selection {
  if (state.kind === "none") return state;

  if (state.kind === "blocks") {
    if (facts.deletedIds.has(state.anchorId)) return { kind: "none" };
    const ids = state.ids.filter((id) => !facts.deletedIds.has(id));
    if (ids.length === 0) return { kind: "none" };
    return { kind: "blocks", ids, anchorId: state.anchorId };
  }

  const { from, to } = state;
  if (facts.deletedIds.has(from.blockId) || (to !== null && facts.deletedIds.has(to.blockId))) {
    return { kind: "none" };
  }
  // No type-change command exists in v1; this is a cheap defensive check.
  if (!facts.isTextBlock(from.blockId) || (to !== null && !facts.isTextBlock(to.blockId))) {
    return { kind: "none" };
  }

  const fromOffset = rebaseOffset(from.offset, deltas.get(from.blockId) ?? [], facts.textLength(from.blockId));
  let toPoint: TextPoint | null = null;
  if (to !== null) {
    toPoint = {
      blockId: to.blockId,
      offset: rebaseOffset(to.offset, deltas.get(to.blockId) ?? [], facts.textLength(to.blockId)),
    };
  }
  // Inversion within one block: collapse to a caret at the clamped from.
  if (toPoint !== null && toPoint.blockId === from.blockId && fromOffset > toPoint.offset) {
    toPoint = null;
  }

  const blocks =
    toPoint === null || toPoint.blockId === from.blockId
      ? [from.blockId]
      : chainBetween(facts.linearization, from.blockId, toPoint.blockId);
  if (blocks === null) return { kind: "none" };

  const next: Selection = {
    kind: "text",
    from: { blockId: from.blockId, offset: fromOffset },
    to: toPoint,
    blocks,
    ...(state.reverse !== undefined ? { reverse: state.reverse } : {}),
  };
  return next;
}

export { chainBetween, linearize, rebaseOffset, rebaseSelection };
export type { Linearizable, StructuralFacts };
