/**
 * The Doc's materialization: the state behind the construction entry
 * points — the fresh doc (create), the CRDT snapshot restore (load), and
 * the schema-JSON build (fromJSON). The boundary validation's typed errors
 * stand here; the facade's constructor wires the returned state.
 */
import * as Y from "yjs";

import {
  attributeOrderNormalized,
  flattenDoc,
  isReservedId,
  normalizeMerges,
  normalizeZOrder,
  validateDoc,
} from "@docblocks-core/schema";
import type { DocJSON } from "@docblocks-core/schema";

import { assertAttributeKey, assertAttributeValue } from "../commands";
import { InvalidOperationError, InvalidSnapshotError, formatValidationErrors } from "../errors";
import { layoutDoc, loadOriginOf, writeDocument } from "../layout";
import { toDocJSON } from "../read";
import type { CreateDocOptions } from "./models";

const randomId = (): string => crypto.randomUUID();

/** The materialized doc state: the ready Y.Doc + the new-id generator. */
interface DocInit {
  ydoc: Y.Doc;
  generateId: () => string;
}

/**
 * The fresh doc's state (the `createDoc` entry): the boundary validation
 * (the reserved id and the attributes' forms) over the empty-page layout.
 */
function materializeCreate(options: CreateDocOptions = {}): DocInit {
  const generateId = options.generateId ?? randomId;
  const id = options.id ?? generateId();
  // The doc id is the root block's id: a reserved key would be lost on the
  // JSON export (the id-keyed-map trap), so reject it at the boundary.
  if (isReservedId(id)) {
    throw new InvalidOperationError(
      `The document id "${id}" is reserved (it collides with Object.prototype) and cannot be used.`
    );
  }
  const title = options.title ?? "";
  const createdAt = options.createdAt ?? new Date().toISOString();
  // The doc-attributes record: the boundary validation (the
  // reserved keys and the value forms stand the typed errors before the
  // layout write).
  if (options.attributes !== undefined) {
    for (const [key, value] of Object.entries(options.attributes)) {
      assertAttributeKey(key);
      assertAttributeValue(key, value);
    }
  }
  return { ydoc: layoutDoc(id, title, createdAt, undefined, options.attributes), generateId };
}

/**
 * The CRDT snapshot restore's state (the `loadDoc` entry): the schema
 * major's check over the RAW binary, the full-snapshot validation (the
 * lenient cross-minor posture), and the legacy nesting's eager
 * normalization (a flat snapshot loads as-is).
 */
function materializeLoad(bytes: Uint8Array): DocInit {
  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, bytes, loadOriginOf(ydoc));
  } catch (error) {
    throw new InvalidSnapshotError(
      `loadDoc: malformed update bytes: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  // The schema major (meta.v) stands checked on the RAW binary before any
  // conversion: the snapshot read stands the reader's own major, so a
  // stored v: 2 would pass the validator unseen and be read silently as
  // v1 — a reader of major N must never silently read N+1 data (the
  // breaking-major stand). A missing or non-numeric v is not valid v1
  // data either.
  const schemaMajor = ydoc.getMap("meta").get("v");
  if (schemaMajor !== 1) {
    throw new InvalidSnapshotError(
      typeof schemaMajor === "number"
        ? `loadDoc: unsupported schema version ${schemaMajor} (this reader stands v1; a v${schemaMajor} document requires the corresponding migrator)`
        : `loadDoc: missing or malformed schema version ${JSON.stringify(schemaMajor)} (expected the number 1)`
    );
  }
  // A full snapshot is the only loadable state: an incremental delta applied
  // to an empty doc yields a partial document, so validate it loudly. The
  // cross-minor load is the LENIENT posture (a reader of major 1 opening a
  // newer minor's v1 data): the additive unknowns (an unknown block type,
  // an unknown attr, an unknown mark) are preserved as opaque data, not
  // rejected; the structural invariants and the known-data value checks
  // stand. The strict validator is the writer's stand (the public
  // validateDoc, the command paths).
  const json = toDocJSON(ydoc);
  // The table spans are a derived stand like the canvas z-order: a racing
  // merge can leave a span past the table's edge, and the read-path
  // normalization re-derives what fits BEFORE the snapshot is validated.
  const normalized = normalizeMerges(json);
  const errors = validateDoc(normalized, true);
  if (errors.length > 0) {
    throw new InvalidSnapshotError(
      `loadDoc expects a full document snapshot; got an incomplete or invalid state: ${formatValidationErrors(errors)}`
    );
  }
  // Eager normalization of the legacy nesting form: the live document is
  // always flat, so a legacy snapshot is rewritten (depth -> indent) as a
  // fresh load step; a flat snapshot loads as-is (byte-identical state). The
  // table spans re-derive the same way (a concurrent merge's stale span).
  const flat = flattenDoc(normalized);
  if (JSON.stringify(flat) !== JSON.stringify(json)) {
    const normalized = new Y.Doc();
    writeDocument(normalized, flat);
    return { ydoc: normalized, generateId: randomId };
  }
  return { ydoc, generateId: randomId };
}

/**
 * The schema-JSON build's state (the `fromJSON` entry): the z-order
 * mirror's re-derivation + the lenient validation, over the flat-form
 * layout write (the legacy nesting is normalized on load).
 */
function materializeFromJSON(json: DocJSON): DocInit {
  // The z-order mirror (the canvas elements' dense `zIndex`) can be stale
  // in a saved snapshot after a concurrent merge; re-derive it from the
  // children order before validation (the single source of the z-order).
  const normalized = normalizeMerges(attributeOrderNormalized(normalizeZOrder(json)));
  // The JSON import is a reader boundary like the snapshot load: the
  // cross-minor (lenient) posture tolerates the additive unknowns (the
  // structural invariants and the known-data checks stand).
  const errors = validateDoc(normalized, true);
  if (errors.length > 0) {
    throw new InvalidSnapshotError(
      `Doc.fromJSON expects a valid v1 document; got invalid data: ${formatValidationErrors(errors)}`
    );
  }
  // The legacy nesting form is valid v1 input: normalize it to the flat
  // form on load, so the live document is always flat (and toJSON flat).
  const ydoc = new Y.Doc();
  writeDocument(ydoc, flattenDoc(normalized));
  return { ydoc, generateId: randomId };
}

export { materializeCreate, materializeFromJSON, materializeLoad };
