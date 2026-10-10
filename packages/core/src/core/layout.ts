import * as Y from "yjs";

import { BLOCK_REGISTRY } from "@docblocks-core/schema";
import type { BlockType, DocJSON, TextRun } from "@docblocks-core/schema";

/**
 * Yjs layout: the isomorphic image of the schema JSON.
 *
 * ```
 * Y.Doc
 * ├─ "meta":      Y.Map { v, id, title: Y.Text, createdAt, updatedAt }
 * ├─ "blocks":    Y.Map<blockId, Y.Map>
 * │  └─ { "type": string }
 * │     "attrs":    Y.Map of primitives (only for types with attrs, when non-empty)
 * │     "content":  Y.Array of run Y.Maps { text: Y.Text, marks: Y.Map } (text types only)
 * │     "children": Y.Array<string> (container types only, except root)
 * └─ "rootOrder": Y.Array<string> — the root block's children (top-level order)
 * ```
 *
 * The shared skeleton (meta, blocks, rootOrder) is registered on the doc by
 * name, so peers that create the same document independently merge
 * item-by-item on sync instead of replacing each other's state. Every type
 * nested inside a block entry is created only by the block's author. The
 * root block entry lives in `blocks` keyed by the doc id and carries no
 * `children` field — its order is the registered `rootOrder` array.
 *
 * `meta.updatedAt` is a Yjs-only bookkeeping field: it is not part of the
 * JSON format. It starts at `createdAt` and is maintained by local transactions.
 */

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

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Y.Map holding layout values: primitives or nested Y types. */
type AnyMap = Y.Map<unknown>;

/** The registered blocks map (throws on a broken layout). */
function getBlocks(ydoc: Y.Doc): AnyMap {
  const blocks = ydoc.getMap("blocks");
  if (!(blocks instanceof Y.Map)) {
    throw new Error("docblocks: broken Yjs layout (blocks map missing)");
  }
  return blocks;
}

/** The registered root-order array: the root block's children (throws on a broken layout). */
function rootOrderOf(ydoc: Y.Doc): Y.Array<string> {
  const rootOrder = ydoc.getArray("rootOrder");
  if (!(rootOrder instanceof Y.Array)) {
    throw new Error("docblocks: broken Yjs layout (rootOrder array missing)");
  }
  return rootOrder as Y.Array<string>;
}

/** The root block's id: the document id, which keys the root entry in `blocks`. */
function rootBlockIdOf(ydoc: Y.Doc): string {
  const id = ydoc.getMap("meta").get("id");
  if (typeof id !== "string") {
    throw new Error("docblocks: broken Yjs layout (meta.id missing)");
  }
  return id;
}

/** Write the registered meta map on a fresh doc. */
function writeMeta(ydoc: Y.Doc, id: string, title: string, createdAt: string): void {
  const meta = ydoc.getMap("meta");
  meta.set("v", 1);
  meta.set("id", id);
  meta.set("title", new Y.Text(title));
  meta.set("createdAt", createdAt);
  meta.set("updatedAt", createdAt);
}

/** Primitive attr values are stored directly; plain objects become nested Y.Maps. */
function writeAttrValue(target: AnyMap, key: string, value: unknown): void {
  if (value === undefined) return;
  if (isPlainObject(value)) {
    const nested = new Y.Map<unknown>();
    for (const [nestedKey, nestedValue] of Object.entries(value)) writeAttrValue(nested, nestedKey, nestedValue);
    target.set(key, nested);
  } else {
    target.set(key, value);
  }
}

function writeRun(runs: Y.Array<AnyMap>, run: TextRun): void {
  const runMap = new Y.Map<unknown>();
  runMap.set("text", new Y.Text(run.text));
  const marks = new Y.Map<unknown>();
  for (const [name, value] of Object.entries(run.marks)) {
    if (value === undefined) continue;
    if (isPlainObject(value)) {
      const attrs = new Y.Map<unknown>();
      for (const [attrKey, attrValue] of Object.entries(value)) {
        if (attrValue !== undefined) attrs.set(attrKey, attrValue);
      }
      marks.set(name, attrs);
    } else {
      marks.set(name, value);
    }
  }
  runMap.set("marks", marks);
  runs.push([runMap]);
}

/** Shape of a block as written into the layout (fields per the registry spec). */
interface WritableBlock {
  type: BlockType;
  attrs?: unknown;
  content?: readonly TextRun[];
  children?: readonly string[];
}

/**
 * Write one block, creating only the fields its type has per the registry:
 * `attrs` when the type has attrs and at least one is set, `content` for
 * text types, `children` for container types (except root: its order is the
 * registered rootOrder array). Runs are written as given (no normalization
 * on write).
 */
function writeBlock(blocks: AnyMap, id: string, block: WritableBlock): void {
  const spec = BLOCK_REGISTRY[block.type];
  const yblock = new Y.Map<unknown>();
  yblock.set("type", block.type);

  if (spec.attrs !== undefined && isPlainObject(block.attrs)) {
    // Count present attrs here (not via Y.Map size): a not-yet-integrated map
    // reports size 0 until it is attached to the doc.
    const attrEntries = Object.entries(block.attrs).filter(([, value]) => value !== undefined);
    if (attrEntries.length > 0) {
      const attrs = new Y.Map<unknown>();
      for (const [key, value] of attrEntries) writeAttrValue(attrs, key, value);
      yblock.set("attrs", attrs);
    }
  }

  if (spec.content) {
    const runs = new Y.Array<AnyMap>();
    for (const run of block.content ?? []) writeRun(runs, run);
    yblock.set("content", runs);
  }

  // The root's order lives in the registered rootOrder array, so the root
  // entry carries no children field (entries stay single-authored).
  if (spec.children && block.type !== "root") {
    const children = new Y.Array<string>();
    for (const childId of block.children ?? []) children.push([childId]);
    yblock.set("children", children);
  }

  blocks.set(id, yblock);
}

/**
 * Run `fn` in a local transaction and refresh the Yjs-only `meta.updatedAt`
 * bookkeeping field (every local transaction counts as a document change).
 * Nested calls join the outer transaction.
 */
function localTransact(ydoc: Y.Doc, fn: () => void): void {
  ydoc.transact(() => {
    ydoc.getMap("meta").set("updatedAt", new Date().toISOString());
    fn();
  }, localOriginOf(ydoc));
}

/** Build a fresh doc holding only meta and the root block (empty page). */
function layoutDoc(id: string, title: string, createdAt: string): Y.Doc {
  const ydoc = new Y.Doc();
  ydoc.transact(() => {
    writeMeta(ydoc, id, title, createdAt);
    writeBlock(getBlocks(ydoc), id, { type: "root" });
    // Create the registered (empty) root-order array in the same load step.
    rootOrderOf(ydoc);
  }, loadOriginOf(ydoc));
  return ydoc;
}

/** Write a validated JSON document into a fresh doc (used by fromJSON). */
function writeDocument(ydoc: Y.Doc, json: DocJSON): void {
  ydoc.transact(() => {
    writeMeta(ydoc, json.id, json.title, json.createdAt);
    const blocks = getBlocks(ydoc);
    const rootOrder = rootOrderOf(ydoc);
    for (const [id, block] of Object.entries(json.blocks)) {
      const writable = block as WritableBlock;
      if (writable.type !== "root") {
        writeBlock(blocks, id, writable);
        continue;
      }
      // The root entry is keyed by the doc id; its children go to the
      // registered rootOrder array, not to the entry.
      writeBlock(blocks, json.id, { type: "root" });
      for (const childId of writable.children ?? []) rootOrder.push([childId]);
    }
  }, loadOriginOf(ydoc));
}

export {
  layoutDoc,
  loadOriginOf,
  localOriginOf,
  localTransact,
  rootBlockIdOf,
  rootOrderOf,
  writeAttrValue,
  writeDocument,
};
