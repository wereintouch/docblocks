/** The layout's write path: the attr value write, the block write (the
 *  registry's fields), the parents' write, the full-document write, and the
 *  opaque block write (the cross-minor stand). */
import * as Y from "yjs";

import { BLOCK_REGISTRY } from "@docblocks-core/schema";
import type { Block, DocJSON, OpaqueBlock, TextRun } from "@docblocks-core/schema";

import { markSetToAttrs } from "../text-model";
import { getBlocks, rootOrderOf, writeMeta } from "./layout";
import type { AnyMap, WritableBlock } from "./models";
import { loadOriginOf } from "./origins";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

  // The attrs map is kept by reference: an unattached Y.Map cannot be read
  // back through yblock.get (the read lands before the attach), so the
  // type-specific branches below extend the local map instead.
  let attrs: Y.Map<unknown> | undefined;
  if (spec.attrs !== undefined && isPlainObject(block.attrs)) {
    // Count present attrs here (not via Y.Map size): a not-yet-integrated map
    // reports size 0 until it is attached to the doc.
    const attrEntries = Object.entries(block.attrs).filter(([, value]) => value !== undefined);
    if (attrEntries.length > 0) {
      attrs = new Y.Map<unknown>();
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

  // Table: the column identities + order (the single source of the column set,
  // like the database's rowOrder). The tokens are the column ids (stable, in
  // the JSON), so the structure converges on sync.
  if (spec.columnOrder) {
    const columnOrder = new Y.Array<string>();
    for (const columnId of block.columnOrder ?? []) columnOrder.push([columnId]);
    yblock.set("columnOrder", columnOrder);

    // The columnWidths are stored identity-keyed (a Y.Map of columnId →
    // width): an element-level LWW op per column, so concurrent column
    // moves / removes / inserts converge per key (a positional array's
    // element ops would not — a concurrent set + move over one slot would
    // leave a third entry). The positional number[] in the JSON is derived
    // from this map and the columnOrder at read time (an absent key stands
    // the default width) — the JSON↔Yjs image is a documented derivation,
    // the same shape as the canvas zIndex (the stored form is the identity
    // map, the read form is positional).
    const given = isPlainObject(block.attrs) ? (block.attrs as Record<string, unknown>).columnWidths : undefined;
    if (Array.isArray(given)) {
      // Count the plain entries, not the map's size: an unattached Y.Map
      // reports size 0 until it is integrated into the doc.
      const entries: Array<[string, number]> = [];
      (block.columnOrder ?? []).forEach((columnId, i) => {
        const value = given[i];
        if (typeof value === "number" && Number.isFinite(value)) entries.push([columnId, value]);
      });
      if (entries.length > 0) {
        const widths = new Y.Map<unknown>();
        for (const [columnId, value] of entries) widths.set(columnId, value);
        if (attrs instanceof Y.Map) attrs.set("columnWidths", widths);
        else {
          const fresh = new Y.Map<unknown>();
          fresh.set("columnWidths", widths);
          yblock.set("attrs", fresh);
        }
      }
    }
  }

  blocks.set(id, yblock);
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
  // The cross-minor stand: an unknown-type (opaque) block is threaded like a
  // container (its children ids stand the owner field of its descendants).
  const childIdsOf = (block: Block | OpaqueBlock): readonly string[] =>
    (block as { children?: readonly string[] }).children ?? [];
  const setUnder = (parentId: string, block: Block | OpaqueBlock): void => {
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
      // The cross-minor stand: a known type stands the registry writer; an
      // unknown type (a future minor's data, the lenient load) is written as
      // opaque data (the fields as-is), so a save keeps it intact.
      if (writable.type in BLOCK_REGISTRY) writeBlock(blocks, id, writable);
      else writeOpaqueBlock(blocks, id, block as OpaqueBlock);
    }
    setParents(json, blocks);
  }, loadOriginOf(ydoc));
}

/**
 * Write an unknown-type block as opaque data (the cross-minor stand): the
 * fields present in the data (attrs, geometry, content, children) are
 * written as-is, with no registry gating, so a save keeps the data the
 * engine does not know. The read path (readOpaqueBlock) keeps it intact too.
 * The type-specific fields (rows / rowOrder / columnOrder) belong to the
 * known types and are never written here.
 */
function writeOpaqueBlock(blocks: AnyMap, id: string, block: OpaqueBlock): void {
  const yblock = new Y.Map<unknown>();
  yblock.set("type", block.type);

  if (isPlainObject(block.attrs)) {
    const attrEntries = Object.entries(block.attrs).filter(([, value]) => value !== undefined);
    if (attrEntries.length > 0) {
      const attrs = new Y.Map<unknown>();
      for (const [key, value] of attrEntries) writeAttrValue(attrs, key, value);
      yblock.set("attrs", attrs);
    }
  }

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

  if (Array.isArray(block.content)) {
    const text = new Y.Text();
    const delta = block.content
      .filter((run) => isPlainObject(run) && typeof run.text === "string" && run.text !== "")
      .map((run) => {
        const attrs = markSetToAttrs((run as TextRun).marks ?? {});
        return Object.keys(attrs).length > 0 ? { insert: run.text, attributes: attrs } : { insert: run.text };
      });
    if (delta.length > 0) text.applyDelta(delta);
    yblock.set("content", text);
  }

  if (Array.isArray(block.children)) {
    const children = new Y.Array<string>();
    for (const childId of block.children) if (typeof childId === "string") children.push([childId]);
    yblock.set("children", children);
  }

  blocks.set(id, yblock);
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

export { layoutDoc, writeAttrValue, writeBlock, writeDocument, writeOpaqueBlock };
