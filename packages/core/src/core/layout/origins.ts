/** The layout's per-doc origins: the local + the load origin symbols (the
 *  transaction's origin stand, the undo/redo's local-guard key). */
import * as Y from "yjs";

const localOrigins = new WeakMap<Y.Doc, symbol>();
const loadOrigins = new WeakMap<Y.Doc, symbol>();

/**
 * Origin of semantic mutations (commands). Kept distinct from remote
 * updates so undo tracking and origin guards can tell local edits apart.
 */
function localOriginOf(ydoc: Y.Doc): symbol {
  let origin = localOrigins.get(ydoc);
  if (origin === undefined) {
    origin = Symbol("docblocks:local");
    localOrigins.set(ydoc, origin);
  }
  return origin;
}

/**
 * Origin of initial-state loading (createDoc / loadDoc / fromJSON). Such
 * updates must never enter the undo history.
 */
function loadOriginOf(ydoc: Y.Doc): symbol {
  let origin = loadOrigins.get(ydoc);
  if (origin === undefined) {
    origin = Symbol("docblocks:load");
    loadOrigins.set(ydoc, origin);
  }
  return origin;
}

export { loadOriginOf, localOriginOf };
