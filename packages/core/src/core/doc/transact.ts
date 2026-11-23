/**
 * The Doc's local transaction mechanics: `fn` runs as one Yjs update and
 * one undo step, and a failed batch is rolled back over the undo manager.
 */
import type * as Y from "yjs";

import { undoManagerOf } from "../history";
import { localTransact } from "../layout";

function transactDoc(ydoc: Y.Doc, fn: () => void): void {
  const manager = undoManagerOf(ydoc);
  const undoDepth = manager.undoStack.length;
  try {
    localTransact(ydoc, fn);
  } catch (error) {
    // Y.Doc has no transaction abort: a mid-batch throw leaves the batch's
    // changes committed. They were captured as an undo step; undoing it
    // restores the pre-batch state. A delta of exactly one means no other
    // transaction ran in the meantime (e.g. from a listener); otherwise
    // rolling back would also revert unrelated edits.
    const captured = manager.undoStack.length - undoDepth;
    if (captured === 1) {
      // The rollback's undo() puts the batch's inverse step on the redo
      // stack; drop it so redo cannot resurrect the failed batch. Pre-
      // existing redo entries are already gone: capturing the failed batch
      // invalidated them.
      manager.undo();
      manager.clear(false, true);
    }
    throw error;
  }
}

export { transactDoc };
