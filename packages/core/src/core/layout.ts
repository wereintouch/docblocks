import * as Y from "yjs";

import { BLOCK_REGISTRY } from "@docblocks-core/schema";
import type { Block, BlockType, DocJSON, TextRun } from "@docblocks-core/schema";

import { markSetToAttrs } from "./text-model";

/**
 * Yjs layout: the isomorphic image of the schema JSON.
 *
 * ```
 * Y.Doc
 * ├─ "meta":      Y.Map { v, id, title: Y.Text, createdAt, updatedAt }
 * ├─ "blocks":    Y.Map<blockId, Y.Map>
 * │  └─ { "type": string }
 * │     "attrs":    Y.Map of primitives (only for types with attrs, when non-empty)
 * │     "geometry": Y.Map of numbers (only on blocks that carry the canvas geometry)
 * │     "content":  a single Y.Text (text types only) — the per-character
 * │                 attributes are the marks (formatting is a pure attribute op)
 * │     "children": Y.Array<string> (container types only, except root)
 * │     "rows":     Y.Map<rowId, Y.Map<colId, value>> (database only — rows are data, not blocks)
 * │     "rowOrder": Y.Array<string> (database only — the row order)
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
function writeMeta(ydoc: Y.Doc, id: string, title: string, createdAt: string, avatar?: string): void {
  const meta = ydoc.getMap("meta");
  meta.set("v", 1);
  meta.set("id", id);
  meta.set("title", new Y.Text(title));
  meta.set("createdAt", createdAt);
  meta.set("updatedAt", createdAt);
  // The avatar is optional: it stands only for a non-empty string (absent/empty = none).
  if (avatar !== undefined && avatar !== "") meta.set("avatar", avatar);
}

/** Primitive attr values are stored directly; plain objects become nested Y.Maps, and arrays become Y.Arrays (array elements are stored as-is — the schema keeps them plain). */
function writeAttrValue(target: AnyMap, key: string, value: unknown): void {
  if (value === undefined) return;
  if (isPlainObject(value)) {
    const nested = new Y.Map<unknown>();
    for (const [nestedKey, nestedValue] of Object.entries(value)) writeAttrValue(nested, nestedKey, nestedValue);
    target.set(key, nested);
  } else if (Array.isArray(value)) {
    const array = new Y.Array<unknown>();
    // Clone the elements: a Yjs array holds plain values by reference, so
    // the caller's objects/arrays must not be aliased into the CRDT (a
    // post-call mutation would change the doc outside any transaction).
    for (const element of value) array.push([structuredClone(element)]);
    target.set(key, array);
  } else {
    target.set(key, value);
  }
}

/** Shape of a block as written into the layout (fields per the registry spec). */
interface WritableBlock {
  type: BlockType;
  attrs?: unknown;
  /** The canvas geometry: a plain object of numbers (any block type). */
  geometry?: unknown;
  content?: readonly TextRun[];
  children?: readonly string[];
  rows?: Record<string, Record<string, unknown>>;
  rowOrder?: string[];
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

  // The canvas geometry of any block: a single-authored nested Y.Map of
  // numbers, present only on blocks that carry it (the JSON object and the
  // Y.Map are isomorphic). Non-numeric entries are dropped: the layout
  // contract is numbers only.
  if (isPlainObject(block.geometry)) {
    const entries = Object.entries(block.geometry).filter(
      ([, value]) => typeof value === "number" && Number.isFinite(value)
    );
    if (entries.length > 0) {
      const geometry = new Y.Map<unknown>();
      for (const [key, value] of entries) geometry.set(key, value);
      yblock.set("geometry", geometry);
    }
  }

  // The text content is a single Y.Text written via applyDelta: each run is an
  // insert op carrying its marks as the character attributes. applyDelta (not a
  // sequential insert) avoids Yjs's attribute inheritance — a plain run after a
  // formatted one would otherwise inherit the format. Formatting never copies
  // text, so concurrent formatting/deletion keep the text intact. Empty runs are
  // skipped (a no-op insert); runs are written as given (no normalization).
  if (spec.content) {
    const text = new Y.Text();
    const delta = (block.content ?? [])
      .filter((run) => run.text !== "")
      .map((run) => {
        const attrs = markSetToAttrs(run.marks);
        return Object.keys(attrs).length > 0 ? { insert: run.text, attributes: attrs } : { insert: run.text };
      });
    if (delta.length > 0) text.applyDelta(delta);
    yblock.set("content", text);
  }

  // The root's order lives in the registered rootOrder array, so the root
  // entry carries no children field (entries stay single-authored).
  if (spec.children && block.type !== "root") {
    const children = new Y.Array<string>();
    for (const childId of block.children ?? []) children.push([childId]);
    yblock.set("children", children);
  }

  // Database: the rows (row id -> the single-authored cell map) and the
  // row order live on the block entry, like children.
  if (spec.rows) {
    const rows = new Y.Map<unknown>();
    for (const [rowId, cells] of Object.entries(block.rows ?? {})) {
      const row = new Y.Map<unknown>();
      for (const [colId, value] of Object.entries(cells)) writeAttrValue(row, colId, value);
      rows.set(rowId, row);
    }
    yblock.set("rows", rows);
    const rowOrder = new Y.Array<string>();
    for (const rowId of block.rowOrder ?? []) rowOrder.push([rowId]);
    yblock.set("rowOrder", rowOrder);
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

/**
 * Set the owner `parent` field on each non-root block, derived from the JSON
 * tree (a clean snapshot holds each block under exactly one container). The
 * field is a Yjs-layout-only owner stand (like `meta.updatedAt`): it never
 * reaches the JSON, but it is the single CRDT-resolved ownership source the
 * read and remove paths read (a concurrent move can leave the id in two
 * containers' arrays, the field keeps one owner).
 */
function setParents(json: DocJSON, blocks: Y.Map<unknown>): void {
  // `children` stands only on the container variants; read it through a
  // structural view so the discriminated union does not reject the access.
  const childIdsOf = (block: Block): readonly string[] => (block as { children?: readonly string[] }).children ?? [];
  const setUnder = (parentId: string, block: Block): void => {
    for (const childId of childIdsOf(block)) {
      const child = json.blocks[childId];
      if (child === undefined) continue; // dangling id (the lenient read drops it)
      const childMap = blocks.get(childId);
      if (childMap instanceof Y.Map) childMap.set("parent", parentId);
      setUnder(childId, child);
    }
  };
  const root = json.blocks[json.id];
  if (root !== undefined) setUnder(json.id, root);
}

/** Write a validated JSON document into a fresh doc (used by fromJSON). */
function writeDocument(ydoc: Y.Doc, json: DocJSON): void {
  ydoc.transact(() => {
    writeMeta(ydoc, json.id, json.title, json.createdAt, json.avatar);
    const blocks = getBlocks(ydoc);
    const rootOrder = rootOrderOf(ydoc);
    for (const [id, block] of Object.entries(json.blocks)) {
      const writable = block as WritableBlock;
      // The root's children go to the registered rootOrder array, not the entry.
      if (writable.type === "root") {
        for (const childId of writable.children ?? []) rootOrder.push([childId]);
      }
      writeBlock(blocks, id, writable);
    }
    setParents(json, blocks);
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
  writeBlock,
  writeDocument,
};
export type { WritableBlock };
