import * as Y from "yjs";

import { BLOCK_REGISTRY } from "@docblocks-core/schema";
import type { Block, BlockId, BlockType, DocJSON, DocMeta, MarkSet, TextRun } from "@docblocks-core/schema";

import { rootBlockIdOf, rootOrderOf } from "./layout";
import { normalizeRuns } from "./normalize";

/**
 * Snapshot readers: plain objects per the schema, never live Yjs types.
 * Mutating a returned snapshot does nothing. Runs are normalized lazily
 * (merge adjacent equal-mark runs, drop empty-text runs).
 */

function getBlockMap(ydoc: Y.Doc, id: string): Y.Map<unknown> | null {
  const blocks = ydoc.getMap("blocks");
  const block = blocks.get(id);
  return block instanceof Y.Map ? block : null;
}

function isKnownBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && value in BLOCK_REGISTRY;
}

function readMeta(ydoc: Y.Doc): DocMeta {
  const meta = ydoc.getMap("meta");
  const id = meta.get("id");
  const title = meta.get("title");
  const createdAt = meta.get("createdAt");
  return {
    v: 1,
    id: typeof id === "string" ? id : "",
    // Yjs-only `updatedAt` is deliberately excluded from the JSON meta.
    title: title instanceof Y.Text ? title.toString() : typeof title === "string" ? title : "",
    createdAt: typeof createdAt === "string" ? createdAt : "",
  };
}

function readMarks(value: unknown): MarkSet {
  const marks = {} as MarkSet;
  if (!(value instanceof Y.Map)) return marks;
  value.forEach((markValue, name) => {
    if (markValue === true) {
      (marks as Record<string, unknown>)[name] = true;
    } else if (markValue instanceof Y.Map) {
      const attrs: Record<string, string> = {};
      markValue.forEach((attrValue, attrKey) => {
        if (typeof attrValue === "string") attrs[attrKey] = attrValue;
      });
      (marks as Record<string, unknown>)[name] = attrs;
    }
  });
  return marks;
}

/** Normalized runs of a text block; [] for non-text types or missing blocks. */
function readRuns(ydoc: Y.Doc, blockId: string): TextRun[] {
  const yblock = getBlockMap(ydoc, blockId);
  if (!yblock) return [];
  const type = yblock.get("type");
  if (!isKnownBlockType(type) || !BLOCK_REGISTRY[type].content) return [];
  const content = yblock.get("content");
  if (!(content instanceof Y.Array)) return [];
  const raw: TextRun[] = [];
  content.forEach((entry) => {
    if (!(entry instanceof Y.Map)) return;
    const text = entry.get("text");
    raw.push({ text: text instanceof Y.Text ? text.toString() : "", marks: readMarks(entry.get("marks")) });
  });
  return normalizeRuns(raw);
}

/** Ordered child ids; [] for non-containers or missing blocks. */
function readChildren(ydoc: Y.Doc, id: string): BlockId[] {
  const yblock = getBlockMap(ydoc, id);
  if (!yblock) return [];
  const type = yblock.get("type");
  if (!isKnownBlockType(type) || !BLOCK_REGISTRY[type].children) return [];
  // The root block's order lives in the registered rootOrder array.
  if (id === rootBlockIdOf(ydoc)) {
    return rootOrderOf(ydoc)
      .toArray()
      .filter((childId): childId is string => typeof childId === "string");
  }
  const children = yblock.get("children");
  if (!(children instanceof Y.Array)) return [];
  return children.toArray().filter((childId): childId is string => typeof childId === "string");
}

/** Flattened run text; "" for non-text types or missing blocks. */
function readText(ydoc: Y.Doc, blockId: string): string {
  let text = "";
  for (const run of readRuns(ydoc, blockId)) text += run.text;
  return text;
}

/**
 * Plain copy of a layout value: nested Y.Map → object, Y.Array → array,
 * primitives as-is. Layout contract: attr values are primitives or nested
 * Y.Maps only (Y.Text lives in meta.title and run text), so this cannot
 * return a live Yjs type.
 */
function readPlainValue(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const plain: Record<string, unknown> = {};
    value.forEach((entry, key) => {
      plain[key] = readPlainValue(entry);
    });
    return plain;
  }
  if (value instanceof Y.Array) {
    return value.toArray().map(readPlainValue);
  }
  return value;
}

/** Intermediate shape while a block snapshot is being assembled. */
interface BlockDraft {
  type: BlockType;
  attrs?: unknown;
  /** The canvas geometry as a plain object of numbers (any block type). */
  geometry?: unknown;
  content?: TextRun[];
  children?: BlockId[];
  rows?: Record<string, Record<string, unknown>>;
  rowOrder?: string[];
}

/**
 * Snapshot of one block, or null when missing. Export normalization:
 * `attrs` is omitted when empty; `geometry` is omitted when absent (or
 * holds no numeric fields); `content` is omitted when runs normalize to
 * empty, except `table-cell` (always emits content: an empty cell);
 * `children` is omitted when empty, except `root` (always emits children);
 * `rows` / `rowOrder` are always emitted for database blocks (possibly
 * empty).
 */
function readBlock(ydoc: Y.Doc, id: string): Block | null {
  const yblock = getBlockMap(ydoc, id);
  if (!yblock) return null;
  const type = yblock.get("type");
  if (!isKnownBlockType(type)) return null;
  const blockType = type;
  const spec = BLOCK_REGISTRY[blockType];
  const block: BlockDraft = { type: blockType };

  if (spec.attrs) {
    const attrs = yblock.get("attrs");
    if (attrs instanceof Y.Map && attrs.size > 0) {
      const plain: Record<string, unknown> = {};
      attrs.forEach((value, key) => {
        plain[key] = readPlainValue(value);
      });
      block.attrs = plain;
    }
  }

  // The canvas geometry of any block: a plain copy of the nested Y.Map
  // (the plainness contract extends to it — reads never leak Yjs types).
  const geometry = yblock.get("geometry");
  if (geometry instanceof Y.Map && geometry.size > 0) {
    block.geometry = readPlainValue(geometry);
  }

  if (spec.content) {
    const runs = readRuns(ydoc, id);
    if (runs.length > 0 || blockType === "table-cell") block.content = runs;
  }

  if (spec.children) {
    const children = readChildren(ydoc, id);
    if (children.length > 0 || blockType === "root") block.children = children;
  }

  if (spec.rows) {
    const rows: Record<string, Record<string, unknown>> = {};
    const rowsMap = yblock.get("rows");
    if (rowsMap instanceof Y.Map) {
      rowsMap.forEach((row, rowId) => {
        // readPlainValue of a Y.Map is a plain object of plain values.
        rows[rowId] = row instanceof Y.Map ? (readPlainValue(row) as Record<string, unknown>) : {};
      });
    }
    const rowOrder = yblock.get("rowOrder");
    block.rows = rows;
    block.rowOrder =
      rowOrder instanceof Y.Array
        ? rowOrder.toArray().filter((rowId): rowId is string => typeof rowId === "string")
        : [];
  }

  return block as Block;
}

/** The whole document as plain schema JSON (all export normalization applied). */
function toDocJSON(ydoc: Y.Doc): DocJSON {
  const meta = readMeta(ydoc);
  const blocks: Record<string, Block> = {};
  const blocksMap = ydoc.getMap("blocks");
  blocksMap.forEach((_, id) => {
    const block = readBlock(ydoc, id);
    if (block) blocks[id] = block;
  });
  return { ...meta, blocks };
}

export { readBlock, readChildren, readMeta, readRuns, readText, toDocJSON };
