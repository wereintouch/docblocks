/** The Doc's construction entry points: the fresh doc, the CRDT snapshot
 *  restore, and the schema-JSON build. */
import type { DocJSON } from "@docblocks-core/schema";

import { Doc } from "./doc";
import type { CreateDocOptions } from "./models";

/**
 * Create a new document. Initial state: only the root block (empty page),
 * whose id equals the document id. No auto first paragraph.
 */
function createDoc(options: CreateDocOptions = {}): Doc {
  return Doc.create(options);
}

/**
 * Restore a document from a CRDT snapshot.
 *
 * Expects a FULL snapshot state and throws InvalidSnapshotError otherwise
 * (e.g. on an incremental diff): a delta applied to an empty doc is a silent
 * partial document, so the state is validated on load. The consumer pattern
 * for a base + diffs is `loadDoc(base)` followed by `applyUpdate(diff)`.
 */
function loadDoc(bytes: Uint8Array): Doc {
  return Doc.load(bytes);
}

/**
 * Build a document from schema JSON. Validates first and throws the
 * ValidationError list as-is on violations. The legacy nesting form is
 * valid input and is normalized to the flat form on load. Runs are written
 * as given.
 */
function fromJSON(json: DocJSON): Doc {
  return Doc.fromJSON(json);
}

export { createDoc, fromJSON, loadDoc };
