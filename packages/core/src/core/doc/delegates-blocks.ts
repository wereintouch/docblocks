/**
 * The Doc facade's block-level delegates: the command calls behind the
 * class's block structure, geometry, and z-order methods.
 */
import type * as Y from "yjs";

import type { BlockAttrsPatch, BlockId, BlockType, Geometry } from "@docblocks-core/schema";

import {
  changeBlockType as changeBlockTypeCommand,
  insertBlock as insertBlockCommand,
  moveBlock as moveBlockCommand,
  removeBlockAttr as removeBlockAttrCommand,
  removeBlock as removeBlockCommand,
  setGeometry as setGeometryCommand,
  setZOrder as setZOrderCommand,
  updateBlock as updateBlockCommand,
} from "../commands";
import type { ChangeBlockTypeArgs, InsertBlockArgs, ZOrderAction } from "../commands";

/** Inserts a new block and returns its id (typed attrs per block type). */
function insertBlock<T extends BlockType>(ydoc: Y.Doc, generateId: () => string, ...args: InsertBlockArgs<T>): BlockId {
  const [type, attrs, at] = args;
  return insertBlockCommand(ydoc, generateId, type, attrs, at);
}

/** Sets or overwrites the given attrs of a block. */
function updateBlock(ydoc: Y.Doc, id: BlockId, patch: BlockAttrsPatch): void {
  updateBlockCommand(ydoc, id, patch);
}

/**
 * Removes one block attr (one transaction — one undo step, one wire
 * update). An absent key is a no-op; the post-removal attrs must keep
 * the registry's invariants (the required attr's removal is a typed
 * rejection); an unknown block throws the typed UnknownBlockError, a
 * block type without attrs the typed InvalidAttrsError.
 */
function removeBlockAttr(ydoc: Y.Doc, id: BlockId, key: string): void {
  removeBlockAttrCommand(ydoc, id, key);
}

/** Moves a block to `toIndex` under `toParent` (pre-move index semantics). */
function moveBlock(ydoc: Y.Doc, id: BlockId, toParent: BlockId, toIndex: number): void {
  moveBlockCommand(ydoc, id, toParent, toIndex);
}

/**
 * Changes a block's type. The content must survive (both types carry
 * it), the children must fit the target's children rules, the new type
 * must fit the block's parent, and the target's required attrs must be
 * satisfied: the current attrs the target also declares are carried
 * over, `attrs` overrides them, and type-specific attrs are dropped.
 */
function changeBlockType<T extends BlockType>(
  ydoc: Y.Doc,
  generateId: () => string,
  ...args: ChangeBlockTypeArgs<T>
): void {
  const [id, type, attrs] = args;
  changeBlockTypeCommand(ydoc, generateId, id, type, attrs);
}

/** Removes a block and its whole subtree. */
function removeBlock(ydoc: Y.Doc, id: BlockId): void {
  removeBlockCommand(ydoc, id);
}

/**
 * Sets the canvas geometry of a block: a partial patch merges with the
 * existing geometry (the result must be complete — x/y/w/h present),
 * `null` removes the geometry. InvalidGeometryError on a bad value or an
 * incomplete merge; an equal-value set is a no-op.
 */
function setGeometry(ydoc: Y.Doc, id: BlockId, geometry: Partial<Geometry> | null): void {
  setGeometryCommand(ydoc, id, geometry);
}

/**
 * Reorders a surface's canvas element (shape / connector / canvas-text /
 * group) by the z-order action and rewrites the dense `zIndex` (one
 * transaction — one undo step, one wire update). A step at the top / bottom
 * edge is a no-op.
 */
function setZOrder(ydoc: Y.Doc, id: BlockId, action: ZOrderAction): void {
  setZOrderCommand(ydoc, id, action);
}

export { changeBlockType, insertBlock, moveBlock, removeBlock, removeBlockAttr, setGeometry, setZOrder, updateBlock };
