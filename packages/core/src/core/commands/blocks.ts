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
import { blockTypeOf, childrenOf, findParent, getBlockMap, getBlocks, isDescendant, readCols } from "./structure";

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
  if (!parentSpec.children || !parentSpec.childrenTypes?.includes(type)) {
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
  if (!parentSpec.children || !parentSpec.childrenTypes?.includes(type)) {
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
    // Same-parent move: pre-move indices, so removal shifts the target left.
    const insertAt = fromChildren === toChildren && fromIndex < toIndex ? toIndex - 1 : toIndex;
    toChildren.insert(insertAt, [id]);
  });
}

/** Removes a block and its whole subtree from the blocks map and parents. */
function removeBlock(ydoc: Y.Doc, id: string): void {
  const type = blockTypeOf(ydoc, id);
  if (type === null) throw new UnknownBlockError(`Unknown block "${id}".`);
  if (type === "root") throw new InvalidOperationError("The root block cannot be removed.");

  const subtree: string[] = [id];
  const stack = [id];
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

  const parentId = findParent(ydoc, id);
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
      const index = parentChildren.toArray().indexOf(id);
      if (index !== -1) parentChildren.delete(index, 1);
    }
    const blocks = getBlocks(ydoc);
    for (const blockId of subtree) blocks.delete(blockId);
  });
}

export { blockTypeOf, childrenOf, findParent, getBlockMap, insertBlock, moveBlock, removeBlock };
export type { InsertBlockArgs, InsertBlockPosition };
