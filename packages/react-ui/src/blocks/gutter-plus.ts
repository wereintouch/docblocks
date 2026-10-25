/**
 * The gutter's quick insert: the empty paragraph under the item. The doc
 * write is one transact (one undo step, one wire update); the caret seat
 * is the DOM-only effect scheduled for the next frame.
 */
import { DetachedBlockError, InvalidAttrsError, InvalidOperationError } from "docblocks-core";
import type { BlockId, Doc } from "docblocks-core";

import { focusCaretIn } from "../editing/block-commands";

/**
 * Inserts an empty paragraph right after `after` in its sequence (under
 * `parent`), carrying `after`'s indent (the new paragraph stands in the
 * same column) and seats the caret at its start. Returns the new block's
 * id; null (nothing written) when the core rejects the position (a
 * concurrent peer moved or removed the block between the render and the
 * click).
 */
function insertParagraphAfter(
  doc: Doc,
  after: BlockId,
  parent: BlockId,
  indent: number,
  scope: ParentNode
): BlockId | null {
  try {
    const newId = doc.insertBlock("paragraph", indent !== 0 ? { indent } : undefined, { parent, after });
    focusCaretIn(newId, 0, scope);
    return newId;
  } catch (error) {
    if (
      error instanceof InvalidAttrsError ||
      error instanceof InvalidOperationError ||
      error instanceof DetachedBlockError
    ) {
      return null;
    }
    throw error;
  }
}

export { insertParagraphAfter };
