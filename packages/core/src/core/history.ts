import * as Y from "yjs";

import { localOriginOf } from "./layout";

/**
 * Undo/redo history: one UndoManager per Y.Doc, kept package-internally
 * (not exposed on the Doc public surface).
 *
 * Only local-origin transactions are tracked (remote updates carry no
 * origin; the load origin is never tracked), so undo never reverts
 * remote or loaded state. `captureTimeout: 0`: every local transaction
 * is its own undo step; batching happens only through `Doc.transact`
 * (nested transactions join the outer one).
 */

const managers = new WeakMap<Y.Doc, Y.UndoManager>();

function createManager(ydoc: Y.Doc): Y.UndoManager {
  const manager = new Y.UndoManager(ydoc, {
    // A Set, not an array: the manager registers itself in the set.
    trackedOrigins: new Set([localOriginOf(ydoc)]),
    captureTimeout: 0,
    // Skip no-change commits so they do not become undo steps.
    captureTransaction: (transaction) => transaction.changedParentTypes.size > 0,
  });
  managers.set(ydoc, manager);
  return manager;
}

/** The UndoManager of a doc (created on first access). */
function undoManagerOf(ydoc: Y.Doc): Y.UndoManager {
  let manager = managers.get(ydoc);
  if (manager === undefined) {
    manager = createManager(ydoc);
  }
  return manager;
}

export { undoManagerOf };
