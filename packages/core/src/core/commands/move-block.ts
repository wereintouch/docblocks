/**
 * The block structure move command: moveBlock. A command validates first
 * (typed errors, no silent no-ops) and then mutates in one transaction
 * with the local origin.
 */
import * as Y from "yjs";

import { BLOCK_REGISTRY } from "@docblocks-core/schema";

import { InvalidChildError, InvalidOperationError, InvalidRangeError, UnknownBlockError } from "../errors";
import { localTransact } from "../layout";
import {
  blockTypeOf,
  childrenOf,
  findParent,
  getBlockMap,
  indentJumpViolation,
  indentOfBlock,
  isDescendant,
  isPageSequence,
  readCols,
} from "./structure";
import { refreshSurfaceZIndex } from "./z-order";

/**
 * Moves a block to `toIndex` under `toParent` (pre-move index semantics).
 * The root cannot be moved; moving into itself or a descendant is rejected.
 */
function moveBlock(ydoc: Y.Doc, id: string, toParent: string, toIndex: number): void {
  const type = blockTypeOf(ydoc, id);
  if (type === null) throw new UnknownBlockError(`Unknown block "${id}".`);
  if (type === "root") throw new InvalidOperationError("The root block cannot be moved.");

  const parentType = blockTypeOf(ydoc, toParent);
  if (parentType === null) throw new UnknownBlockError(`Unknown block "${toParent}".`);
  const parentSpec = BLOCK_REGISTRY[parentType];
  if (!parentSpec.children) {
    // The remodeled page types used to carry children (the legacy form) — a
    // typed rejection: the nesting is the flat sequence's indent attr.
    if (parentSpec.legacyChildrenTypes !== undefined) {
      throw new InvalidOperationError(
        `Block "${toParent}" (type "${parentType}") no longer carries children: page content is a flat sequence — move within the page sequence (the nesting is the indent attr).`
      );
    }
    throw new InvalidChildError(`Block type "${type}" is not allowed as a child of "${parentType}".`);
  }
  if (!parentSpec.childrenTypes?.includes(type)) {
    throw new InvalidChildError(`Block type "${type}" is not allowed as a child of "${parentType}".`);
  }
  if (id === toParent || isDescendant(ydoc, id, toParent)) {
    throw new InvalidOperationError(`Block "${id}" cannot be moved into itself or its descendant "${toParent}".`);
  }

  const fromParent = findParent(ydoc, id);
  if (fromParent === null) throw new InvalidOperationError(`Block "${id}" has no parent.`);
  const fromChildren = childrenOf(ydoc, fromParent);
  const toChildren = childrenOf(ydoc, toParent);
  if (fromChildren === null || toChildren === null) {
    throw new InvalidOperationError(`Blocks "${fromParent}" and "${toParent}" must have children.`);
  }

  const fromIndex = fromChildren.toArray().indexOf(id);
  const toLength = toChildren.toArray().length;
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > toLength) {
    throw new InvalidRangeError(`toIndex must be an integer in [0, ${toLength}] (got ${toIndex}).`);
  }

  // Same-parent move: pre-move indices, so removal shifts the target left.
  const insertAt = fromChildren === toChildren && fromIndex < toIndex ? toIndex - 1 : toIndex;

  // The flat page model: the landed position must keep the
  // sequence's jump rule (the block's indent does not change on a move).
  // (The open-transaction marker is the Yjs `_transaction` slot: set while
  // any transaction on the doc is in flight, null otherwise.)
  const inBatch = (ydoc as unknown as { _transaction?: unknown })._transaction !== null;
  if (parentSpec.sequence) {
    const post = toChildren.toArray().filter((child) => child !== id);
    post.splice(insertAt, 0, id);
    const violation = indentJumpViolation(ydoc, post, insertAt, indentOfBlock(ydoc, id));
    if (violation !== null) {
      throw new InvalidOperationError(`Block "${id}" cannot move to position ${insertAt}: ${violation}.`);
    }
    // The displaced block (the one standing at the landing before the
    // insert) gets the moved block as its new predecessor: its pair must
    // keep the rule too — a shallower block landing mid-segment would
    // otherwise dangle the displaced deeper block (the TO side of the
    // jump rule; the stranding guard is the FROM-side complement). The
    // check stands only for a command that commits its own transaction —
    // a batched composition (the UI's seam drag) moves the block at its
    // old indent and updates the indent in the same atomic transact, so
    // the mid-transact pair is a transient the composition resolves
    // (the seam rule owns the final state); the same posture as the
    // stranding guard below.
    if (!inBatch) {
      const displaced = post[insertAt + 1];
      if (displaced !== undefined) {
        const displacedViolation = indentJumpViolation(ydoc, post, insertAt + 1, indentOfBlock(ydoc, displaced));
        if (displacedViolation !== null) {
          throw new InvalidOperationError(
            `Block "${id}" cannot move to position ${insertAt}: block "${displaced}" would be displaced (${displacedViolation}).`
          );
        }
      }
    }
  }

  // The flat page model: the move carries the block ALONE — its derived
  // segment (the deeper followers) stays at the head's old slot, where
  // the new predecessor (the head's old predecessor, or the sequence's
  // start) can break the jump rule. The command moves one block (the UI
  // composes whole-segment moves), so a stranding is rejected instead of
  // cascaded. The rejection stands only for a command that commits its
  // own transaction: inside the caller's open batch (a `doc.transact`
  // composition — the UI's segment move) the stranding is a mid-batch
  // transient the composition's later steps resolve, and the Yjs
  // transaction's atomicity keeps it off the wire and off every listener.
  // The check runs over the post-move from-sequence at the first
  // follower's landing.
  if (!inBatch && isPageSequence(ydoc, fromParent)) {
    const fromIds = fromChildren.toArray();
    const ownIndent = indentOfBlock(ydoc, id);
    let segmentEnd = fromIndex + 1;
    for (let i = fromIndex + 1; i < fromIds.length; i += 1) {
      const next = fromIds[i];
      if (next === undefined || indentOfBlock(ydoc, next) <= ownIndent) break;
      segmentEnd = i + 1;
    }
    if (segmentEnd > fromIndex + 1) {
      // The post-move from-sequence: the head removed, and re-inserted at
      // its landing when the move is within the sequence. The first
      // follower's post-move index is the head's old slot (the removal
      // shifts it left), shifted right by a same-sequence landing at or
      // before the slot — at the slot itself the head stands right before
      // the follower, its old position (the in-place no-op).
      const postFrom = fromIds.filter((child) => child !== id);
      if (fromChildren === toChildren) postFrom.splice(insertAt, 0, id);
      const followerIndex = fromChildren === toChildren && insertAt <= fromIndex ? fromIndex + 1 : fromIndex;
      const follower = postFrom[followerIndex];
      if (follower !== undefined) {
        const violation = indentJumpViolation(ydoc, postFrom, followerIndex, indentOfBlock(ydoc, follower));
        if (violation !== null) {
          throw new InvalidOperationError(
            `Block "${id}" cannot move without its derived segment: block "${follower}" would be stranded (${violation}). The segment must be moved with the block — moveBlock moves one block.`
          );
        }
      }
    }
  }

  // Table invariants: a cell is bound to its column (its position in the
  // row ↔ the table's columnOrder), so a cell cannot move at all — not
  // between rows and not within its row (the column order is managed by
  // moveTableColumn, which moves the cells with their column); a row moves
  // only within its own table (its cells are bound to that table's column
  // identities).
  if (type === "table-cell") {
    const samePosition = fromChildren === toChildren && insertAt === fromIndex;
    if (!samePosition) {
      const tableId = findParent(ydoc, fromParent);
      const cols = tableId !== null ? readCols(ydoc, tableId) : null;
      throw new InvalidOperationError(
        `Cell "${id}" is bound to its column (position ${fromIndex} of ${cols ?? "?"}) and cannot move: a cell move would desync the row from the table's columnOrder. Column order is managed by moveTableColumn (the cells move with their column).`
      );
    }
  }
  if (type === "table-row" && toParent !== fromParent) {
    const rowCells = childrenOf(ydoc, id);
    const cellCount = rowCells !== null ? rowCells.toArray().length : 0;
    const targetCols = readCols(ydoc, toParent);
    throw new InvalidOperationError(
      `Row "${id}" cannot move between tables: it has ${cellCount} cell(s) against table "${toParent}"'s ${targetCols ?? "?"} column(s), and its cells are bound to the source table's columnOrder identities.`
    );
  }

  localTransact(ydoc, () => {
    fromChildren.delete(fromIndex, 1);
    toChildren.insert(insertAt, [id]);
    // The owner parent: the single CRDT-resolved ownership stand. A
    // concurrent move of the same block into a different container resolves
    // to one owner (the field) instead of a duplicate reference in two
    // arrays.
    const blockMap = getBlockMap(ydoc, id);
    if (blockMap !== null) blockMap.set("parent", toParent);
    // The canvas z-order mirror: a surface move reorders the canvas elements
    // (the children order is the z-order) — refresh the dense zIndex in the
    // affected surface(s) so the index stays consistent with the order.
    if (blockTypeOf(ydoc, toParent) === "surface") refreshSurfaceZIndex(ydoc, toParent);
    if (fromParent !== toParent && blockTypeOf(ydoc, fromParent) === "surface") {
      refreshSurfaceZIndex(ydoc, fromParent);
    }
  });
}

export { moveBlock };
