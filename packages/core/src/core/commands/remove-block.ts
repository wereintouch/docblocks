/**
 * The block structure remove command: removeBlock. A command validates
 * first (typed errors, no silent no-ops) and then mutates in one
 * transaction with the local origin.
 */
import * as Y from "yjs";

import { InvalidOperationError, UnknownBlockError } from "../errors";
import { localTransact } from "../layout";
import { blockTypeOf, childrenOf, findParent, getBlocks, indentOfBlock, isPageSequence, readCols } from "./structure";
import { refreshSurfaceZIndex } from "./z-order";

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
  // (a table's rows/cells) are collected too.
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
      // A concurrent move can leave a phantom (the id in `current`'s array,
      // owned by another container per the parent field) — it is not part
      // of `current`'s subtree and must not be deleted with it.
      if (findParent(ydoc, child) !== current) continue;
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
    // The canvas z-order mirror: a surface removal leaves a gap in the dense
    // zIndex — re-densify the remaining canvas elements (1..N, no gaps).
    if (parentId !== null && blockTypeOf(ydoc, parentId) === "surface") {
      refreshSurfaceZIndex(ydoc, parentId);
    }
    const blocks = getBlocks(ydoc);
    for (const blockId of subtree) blocks.delete(blockId);
  });
}

export { removeBlock };
