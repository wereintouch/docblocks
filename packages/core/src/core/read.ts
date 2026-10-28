import * as Y from "yjs";

import { BLOCK_REGISTRY } from "@docblocks-core/schema";
import type { Block, BlockId, BlockType, DocJSON, DocMeta, TextRun } from "@docblocks-core/schema";

import { derivedZIndex } from "./commands/z-order";
import { rootBlockIdOf, rootOrderOf } from "./layout";
import { normalizeRuns } from "./normalize";
import { attrsToMarkSet } from "./text-model";
import type { TextDeltaOp } from "./text-model";

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
  const avatar = meta.get("avatar");
  const createdAt = meta.get("createdAt");
  return {
    v: 1,
    id: typeof id === "string" ? id : "",
    // Yjs-only `updatedAt` is deliberately excluded from the JSON meta.
    title: title instanceof Y.Text ? title.toString() : typeof title === "string" ? title : "",
    // The avatar is optional: absent or empty means none (the field stands off).
    ...(typeof avatar === "string" && avatar !== "" ? { avatar } : {}),
    createdAt: typeof createdAt === "string" ? createdAt : "",
  };
}

/** Normalized runs of a text block; [] for non-text types or missing blocks. */
function readRuns(ydoc: Y.Doc, blockId: string): TextRun[] {
  const yblock = getBlockMap(ydoc, blockId);
  if (!yblock) return [];
  const type = yblock.get("type");
  if (!isKnownBlockType(type) || !BLOCK_REGISTRY[type].content) return [];
  const content = yblock.get("content");
  if (!(content instanceof Y.Text)) return [];
  // The runs stand the Y.Text's delta: each insert op is a span carrying its
  // marks as the character attributes.
  const raw: TextRun[] = [];
  for (const op of content.toDelta() as TextDeltaOp[]) {
    if (typeof op.insert !== "string") continue;
    raw.push({ text: op.insert, marks: attrsToMarkSet(op.attributes) });
  }
  return normalizeRuns(raw);
}

/** Ordered child ids; [] for non-containers or missing blocks. */
/**
 * Read-side dedupe of an order array: duplicate entries can only arise from
 * merging the same deterministic insert (re-seeding a persistent sync room
 * with the same id generator); a well-formed writer never writes them.
 * The first occurrence wins, so every read sees a well-formed order.
 */
function dedupeOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function readChildren(ydoc: Y.Doc, id: string): BlockId[] {
  const yblock = getBlockMap(ydoc, id);
  if (!yblock) return [];
  const type = yblock.get("type");
  if (!isKnownBlockType(type) || !BLOCK_REGISTRY[type].children) return [];
  // A concurrent move + remove of the same block can converge to a
  // re-inserted order id with no block entry (the move's delete + reinsert
  // and the remove's delete race on the same array element). The lenient
  // reader drops the dangling id (the raw Yjs layer keeps it — doc.raw is
  // the escape hatch); the strict validator still rejects it in JSON.
  const present = (childId: string) => getBlockMap(ydoc, childId) !== null;
  // The owner filter: a concurrent move can leave the id in two containers'
  // arrays; the block's `parent` field (set by insert/move/load) is the
  // single owner. Only the owner's array lists the block in the snapshot —
  // the non-owner containers' arrays drop the phantom. Legacy blocks (no
  // field) keep the array membership stand.
  const ownedBySelf = (childId: string): boolean => {
    const childMap = getBlockMap(ydoc, childId);
    if (childMap === null) return false;
    const parent = childMap.get("parent");
    if (typeof parent === "string" && parent !== "") return parent === id;
    return true;
  };
  // The root block's order lives in the registered rootOrder array.
  if (id === rootBlockIdOf(ydoc)) {
    return dedupeOrder(
      rootOrderOf(ydoc)
        .toArray()
        .filter((childId): childId is string => typeof childId === "string" && present(childId) && ownedBySelf(childId))
    );
  }
  const children = yblock.get("children");
  if (!(children instanceof Y.Array)) return [];
  return dedupeOrder(
    children
      .toArray()
      .filter((childId): childId is string => typeof childId === "string" && present(childId) && ownedBySelf(childId))
  );
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

  // The connector's legacy boolean arrowStart (pre-release migration: the
  // attr was a boolean that copied the end arrowhead's figure; it is now
  // an independent figure enum). The lenient read maps the legacy value so
  // no reader sees the boolean: true -> "arrow", false/absent -> absent
  // (the key is dropped). The strict validator rejects the boolean; the
  // writer never emits it, and the raw Yjs layer keeps it (doc.raw is the
  // escape hatch).
  if (blockType === "connector" && block.attrs !== undefined) {
    const record = block.attrs as Record<string, unknown>;
    if (typeof record.arrowStart === "boolean") {
      if (record.arrowStart) record.arrowStart = "arrow";
      else delete record.arrowStart;
    }
  }

  // The canvas element's z-order index (dense 1..N, the children order's
  // derived mirror): a concurrent merge can leave the stored `zIndex` stale
  // (each peer wrote its own local position), so the read path derives it
  // from the (converged) children order — the single source of the z-order.
  const zIndex = derivedZIndex(ydoc, id);
  if (zIndex !== null) {
    const record = block.attrs !== undefined ? (block.attrs as Record<string, unknown>) : {};
    record.zIndex = zIndex;
    block.attrs = record;
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
    const hasCells = (rowId: string) => rowsMap instanceof Y.Map && rowsMap.has(rowId);
    block.rows = rows;
    // A concurrent moveRow + removeRow of the same row can converge to a
    // re-inserted order id with no cells entry (the move's delete +
    // reinsert races the remove's delete on the same array element). The
    // lenient reader drops the dangling id; the strict validator still
    // rejects it in JSON.
    block.rowOrder =
      rowOrder instanceof Y.Array
        ? rowOrder.toArray().filter((rowId): rowId is string => typeof rowId === "string" && hasCells(rowId))
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
