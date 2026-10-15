/**
 * Block structure commands: insertBlock, moveBlock, removeBlock.
 * A command validates first (typed errors, no silent no-ops) and then
 * mutates in one transaction with the local origin.
 */
import * as Y from "yjs";

import { BLOCK_REGISTRY, validateBlockAttrs, validateCanvasBlock } from "@docblocks-core/schema";
import type { AttrsFor, BlockId, BlockType, ValidationError } from "@docblocks-core/schema";

import {
  DetachedBlockError,
  InvalidAttrsError,
  InvalidChildError,
  InvalidOperationError,
  InvalidRangeError,
  UnknownBlockError,
  UnknownBlockTypeError,
  formatValidationErrors,
} from "../errors";
import { localTransact, writeAttrValue } from "../layout";
import { readMeta } from "../read";
import { assertValidDatabaseInsert } from "./database";
import {
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
} from "./structure";

/** Where to insert a new block: under `parent`, after the sibling `after`. */
interface InsertBlockPosition {
  /** Parent block id; defaults to the root block (id === doc id). */
  parent?: BlockId;
  /** Existing child of `parent`; the new block lands right after it. */
  after?: BlockId;
}

/**
 * Argument tuple of `insertBlock`: attrs are required exactly when the type
 * has attrs (see AttrsFor); `at` is optional.
 */
type InsertBlockArgs<T extends BlockType> =
  undefined extends AttrsFor<T>
    ? [type: T, attrs?: AttrsFor<T>, at?: InsertBlockPosition]
    : [type: T, attrs: AttrsFor<T>, at?: InsertBlockPosition];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Writes a fresh block, creating only the fields its type has per the registry. */
function writeNewBlock(blocks: Y.Map<unknown>, id: string, type: BlockType, attrs: unknown): void {
  const spec = BLOCK_REGISTRY[type];
  const yblock = new Y.Map<unknown>();
  yblock.set("type", type);

  if (spec.attrs !== undefined && isPlainObject(attrs)) {
    const attrEntries = Object.entries(attrs).filter(([, value]) => value !== undefined);
    if (attrEntries.length > 0) {
      const attrsMap = new Y.Map<unknown>();
      for (const [key, value] of attrEntries) writeAttrValue(attrsMap, key, value);
      yblock.set("attrs", attrsMap);
    }
  }

  if (spec.content) yblock.set("content", new Y.Array<Y.Map<unknown>>());
  if (spec.children) yblock.set("children", new Y.Array<string>());
  if (spec.rows) {
    yblock.set("rows", new Y.Map<unknown>());
    yblock.set("rowOrder", new Y.Array<string>());
  }
  blocks.set(id, yblock);
}

/** Inserts a new block under `at.parent` (default: root) after `at.after` (default: appended). */
function insertBlock(
  ydoc: Y.Doc,
  generateId: () => string,
  type: BlockType,
  attrs: unknown,
  at?: InsertBlockPosition
): BlockId {
  if (!(type in BLOCK_REGISTRY)) throw new UnknownBlockTypeError(`Unknown block type "${String(type)}".`);
  if (type === "root") throw new InvalidOperationError("The root block already exists and cannot be inserted.");
  const attrErrors = validateBlockAttrs(type, attrs);
  if (attrErrors.length > 0) {
    throw new InvalidAttrsError(`Invalid attrs for block type "${type}": ${formatValidationErrors(attrErrors)}`);
  }

  // The canvas's block-level attrs invariants (the points tuples, the
  // connector refs) are checked on the post-insert attrs (the registry
  // attrs spec expresses only the per-attr rules).
  if (type === "shape" || type === "connector") {
    const canvasErrors: ValidationError[] = [];
    validateCanvasBlock(type, { type, attrs }, "blocks.new", canvasErrors);
    if (canvasErrors.length > 0) {
      throw new InvalidAttrsError(`Invalid attrs for block type "${type}": ${formatValidationErrors(canvasErrors)}`);
    }
  }

  const parentId = at?.parent ?? readMeta(ydoc).id;
  const parentType = blockTypeOf(ydoc, parentId);
  if (parentType === null) throw new UnknownBlockError(`Unknown block "${parentId}".`);
  const parentSpec = BLOCK_REGISTRY[parentType];
  if (!parentSpec.children) {
    // The remodeled page types used to carry children (the legacy form) — a
    // typed rejection: the nesting is the flat sequence's indent attr.
    if (parentSpec.legacyChildrenTypes !== undefined) {
      throw new InvalidOperationError(
        `Block "${parentId}" (type "${parentType}") no longer carries children: page content is a flat sequence — insert after it in the page sequence (the nesting is the indent attr).`
      );
    }
    throw new InvalidChildError(`Block type "${type}" is not allowed as a child of "${parentType}".`);
  }
  if (!parentSpec.childrenTypes?.includes(type)) {
    throw new InvalidChildError(`Block type "${type}" is not allowed as a child of "${parentType}".`);
  }

  const children = childrenOf(ydoc, parentId);
  if (children === null) {
    throw new InvalidOperationError(`Block "${parentId}" (type "${parentType}") has no children.`);
  }
  const childIds = children.toArray();
  let index = childIds.length;
  if (at?.after !== undefined) {
    const afterIndex = childIds.indexOf(at.after);
    if (afterIndex === -1) throw new DetachedBlockError(`Block "${at.after}" is not a child of "${parentId}".`);
    index = afterIndex + 1;
  }

  // The flat page model: the new block's indent must keep the
  // sequence's jump rule at its landing position.
  if (parentSpec.sequence) {
    const newIndent =
      attrs !== undefined && isPlainObject(attrs) && typeof attrs.indent === "number" ? attrs.indent : 0;
    const violation = indentJumpViolation(ydoc, childIds, index, newIndent);
    if (violation !== null) {
      throw new InvalidAttrsError(`Invalid attrs for block type "${type}": ${violation}.`);
    }
  }

  // A row stays full: a new cell is allowed only while the row holds fewer
  // cells than the table's `cols` (completing a row under construction).
  if (type === "table-cell") {
    const cellCount = childIds.length;
    const tableId = findParent(ydoc, parentId);
    const cols = tableId !== null ? readCols(ydoc, tableId) : null;
    if (cols === null) {
      throw new InvalidOperationError(`Row "${parentId}" is not a child of a table with a valid "cols" attribute.`);
    }
    if (cellCount >= cols) {
      throw new InvalidOperationError(`Row "${parentId}" already has ${cellCount} of ${cols} cells; the row is full.`);
    }
  }

  // The database's type-dependent column rules (the options presence, the
  // duplicate ids) are block-level invariants, not per-attribute rules: they
  // run on the post-insert block (an empty rows / rowOrder).
  if (type === "database") {
    assertValidDatabaseInsert(attrs);
  }

  const id = generateId();
  localTransact(ydoc, () => {
    writeNewBlock(getBlocks(ydoc), id, type, attrs);
    children.insert(index, [id]);
  });
  return id;
}

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
  if (parentSpec.sequence) {
    const post = toChildren.toArray().filter((child) => child !== id);
    post.splice(insertAt, 0, id);
    const violation = indentJumpViolation(ydoc, post, insertAt, indentOfBlock(ydoc, id));
    if (violation !== null) {
      throw new InvalidOperationError(`Block "${id}" cannot move to position ${insertAt}: ${violation}.`);
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
  // (The open-transaction marker is the Yjs `_transaction` slot: set while
  // any transaction on the doc is in flight, null otherwise.)
  const inBatch = (ydoc as unknown as { _transaction?: unknown })._transaction !== null;
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

  // Table invariants: a cell reorders only within its own row; a row moves
  // only into a table whose `cols` match its current cell count.
  if (type === "table-cell" && toParent !== fromParent) {
    const cellCount = fromChildren.toArray().length;
    const tableId = findParent(ydoc, fromParent);
    const cols = tableId !== null ? readCols(ydoc, tableId) : null;
    throw new InvalidOperationError(
      `Cell "${id}" cannot move between rows: row "${fromParent}" has ${cellCount} cells, the table has ${cols ?? "?"} columns.`
    );
  }
  if (type === "table-row") {
    const rowCells = childrenOf(ydoc, id);
    const cellCount = rowCells !== null ? rowCells.toArray().length : 0;
    const cols = readCols(ydoc, toParent);
    if (cols === null) {
      throw new InvalidOperationError(`Table "${toParent}" has no valid "cols" attribute.`);
    }
    if (cellCount !== cols) {
      throw new InvalidOperationError(
        `Row "${id}" has ${cellCount} cells, but table "${toParent}" has ${cols} columns.`
      );
    }
  }

  localTransact(ydoc, () => {
    fromChildren.delete(fromIndex, 1);
    toChildren.insert(insertAt, [id]);
  });
}

/** Removes a block and its whole subtree from the blocks map and parents. */
function removeBlock(ydoc: Y.Doc, id: string): void {
  const type = blockTypeOf(ydoc, id);
  if (type === null) throw new UnknownBlockError(`Unknown block "${id}".`);
  if (type === "root") throw new InvalidOperationError("The root block cannot be removed.");

  const parentId = findParent(ydoc, id);

  // The flat page model: a page block's subtree is its derived segment —
  // the contiguous stretch to the first block with an indent <= its own —
  // removed with the block, like structural children. Extended BEFORE the
  // structural walk so the segment members' own structural descendants
  // (a table's rows/cells, a frame's page) are collected too.
  const segment: string[] = [];
  if (parentId !== null && isPageSequence(ydoc, parentId)) {
    const seq = childrenOf(ydoc, parentId);
    if (seq !== null) {
      const childIds = seq.toArray();
      const startIndex = childIds.indexOf(id);
      const ownIndent = indentOfBlock(ydoc, id);
      for (let i = startIndex + 1; i < childIds.length; i++) {
        const next = childIds[i];
        if (next === undefined || indentOfBlock(ydoc, next) <= ownIndent) break;
        segment.push(next);
      }
    }
  }

  const subtree: string[] = [id, ...segment];
  const stack = [id, ...segment];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const children = childrenOf(ydoc, current);
    if (children === null) continue;
    for (const child of children.toArray()) {
      subtree.push(child);
      stack.push(child);
    }
  }

  const parentChildren = parentId === null ? null : childrenOf(ydoc, parentId);

  // A full row cannot drop a cell (it would leave a valid doc invalid); an
  // incomplete row may be repaired.
  if (type === "table-cell" && parentChildren !== null) {
    const cellCount = parentChildren.toArray().length;
    const tableId = parentId !== null ? findParent(ydoc, parentId) : null;
    const cols = tableId !== null ? readCols(ydoc, tableId) : null;
    if (cols !== null && cellCount === cols) {
      throw new InvalidOperationError(
        `Row "${parentId}" has ${cellCount} of ${cols} cells; a full row cannot drop a cell.`
      );
    }
  }

  localTransact(ydoc, () => {
    if (parentChildren !== null) {
      // Every subtree entry the parent's sequence holds — the direct id for
      // structural parents, the whole derived segment for a page sequence —
      // is removed from the array (tail-first, so the lower indices stay).
      const current = parentChildren.toArray();
      const indices = subtree
        .map((blockId) => current.indexOf(blockId))
        .filter((index) => index !== -1)
        .sort((x, y) => y - x);
      for (const index of indices) parentChildren.delete(index, 1);
    }
    const blocks = getBlocks(ydoc);
    for (const blockId of subtree) blocks.delete(blockId);
  });
}

export { blockTypeOf, childrenOf, findParent, getBlockMap, insertBlock, moveBlock, removeBlock };
export type { InsertBlockArgs, InsertBlockPosition };
