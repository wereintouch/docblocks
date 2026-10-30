/**
 * Snapshot readers: plain objects per the schema, never live Yjs types.
 * Mutating a returned snapshot does nothing. Runs are normalized lazily
 * (merge adjacent equal-mark runs, drop empty-text runs).
 */
import * as Y from "yjs";

import { BLOCK_REGISTRY, DEFAULT_TABLE_COLUMN_WIDTH } from "@docblocks-core/schema";
import type { Block, BlockId, DocJSON, DocMeta, OpaqueBlock, TextRun } from "@docblocks-core/schema";

import { derivedZIndex } from "../commands";
import { rootBlockIdOf, rootOrderOf } from "../layout";
import { normalizeRuns } from "../normalize";
import { attrsToMarkSet } from "../text-model";
import type { TextDeltaOp } from "../text-model";
import type { BlockDraft } from "./models";
import { dedupeOrder, isKnownBlockType, readPlainValue } from "./values";

function getBlockMap(ydoc: Y.Doc, id: string): Y.Map<unknown> | null {
  const blocks = ydoc.getMap("blocks");
  const block = blocks.get(id);
  return block instanceof Y.Map ? block : null;
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
 * The cross-minor opaque read of an unknown-type block (a future minor's
 * data): the entry's fields as plain data, as-is. The reader/renderer stand
 * a placeholder (and the text without the unknown marks); the data is not
 * lost on save (the writer's opaque stand). The strict validator rejects it.
 */
function readOpaqueBlock(yblock: Y.Map<unknown>, type: unknown): OpaqueBlock {
  const block: OpaqueBlock = { type: typeof type === "string" ? type : "unknown" };

  const attrs = yblock.get("attrs");
  if (attrs instanceof Y.Map && attrs.size > 0) {
    // Sorted keys: the Y.Map iteration order is process-dependent, so
    // without normalization the toJSON() bytes would depend on the peer.
    const entries: Array<[string, unknown]> = [];
    attrs.forEach((value, key) => entries.push([key, readPlainValue(value)]));
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const plain: Record<string, unknown> = {};
    for (const [key, value] of entries) plain[key] = value;
    block.attrs = plain;
  }

  const geometry = yblock.get("geometry");
  if (geometry instanceof Y.Map && geometry.size > 0)
    block.geometry = readPlainValue(geometry) as Record<string, number>;

  const content = yblock.get("content");
  if (content instanceof Y.Text) {
    const raw: TextRun[] = [];
    for (const op of content.toDelta() as TextDeltaOp[]) {
      if (typeof op.insert !== "string") continue;
      raw.push({ text: op.insert, marks: attrsToMarkSet(op.attributes) });
    }
    const runs = normalizeRuns(raw);
    if (runs.length > 0) block.content = runs;
  }

  const children = yblock.get("children");
  if (children instanceof Y.Array) {
    const ids = children.toArray().filter((childId): childId is string => typeof childId === "string");
    if (ids.length > 0) block.children = ids;
  }

  return block;
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
  // The typed accessor: an unknown type (a future minor's data) is not a
  // Block the reader can type, so it returns null (the full export —
  // readBlockSnapshot — preserves it as opaque data; the cross-minor stand).
  if (!isKnownBlockType(type)) return null;
  const blockType = type;
  const spec = BLOCK_REGISTRY[blockType];
  const block: BlockDraft = { type: blockType };

  if (spec.attrs) {
    const attrs = yblock.get("attrs");
    if (attrs instanceof Y.Map && attrs.size > 0) {
      // Sorted keys: the Y.Map iteration order is process-dependent (the
      // order in which updates were applied), so without normalization the
      // toJSON() bytes would depend on the peer.
      const entries: Array<[string, unknown]> = [];
      attrs.forEach((value, key) => {
        // The table's columnWidths are stored identity-keyed (columnId →
        // width); the positional array is derived from the columnOrder
        // below, not read positionally.
        if (key === "columnWidths" && value instanceof Y.Map) return;
        entries.push([key, readPlainValue(value)]);
      });
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const plain: Record<string, unknown> = {};
      for (const [key, value] of entries) plain[key] = value;
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
    // Two concurrent moveRows of the same row leave both re-inserts in the
    // raw array (the deletes coalesce, the inserts accumulate); a concurrent
    // moveRow + removeRow can converge to a re-inserted order id with no
    // cells entry. The lenient reader drops the dangling id and deduplicates
    // the rest (first occurrence — the raw CRDT order is deterministic on
    // every peer, so all peers converge on the same single position); the
    // strict validator still rejects either residue in JSON.
    block.rowOrder =
      rowOrder instanceof Y.Array
        ? dedupeOrder(
            rowOrder.toArray().filter((rowId): rowId is string => typeof rowId === "string" && hasCells(rowId))
          )
        : [];
  }

  // Table: the column identities + order (the single source of the column set,
  // like the database's rowOrder). Always emitted for table blocks (possibly
  // empty). The tokens are the column ids (stable); a dangling id (no cells)
  // is kept (the column exists even if a race dropped its cells — the strict
  // validator flags it, the lenient reader stands the set).
  if (spec.columnOrder) {
    const columnOrder = yblock.get("columnOrder");
    block.columnOrder =
      columnOrder instanceof Y.Array
        ? columnOrder.toArray().filter((columnId): columnId is string => typeof columnId === "string")
        : [];

    // The columnWidths stand positional in the JSON, derived from the
    // identity-keyed storage (a Y.Map of columnId → width) in the
    // columnOrder order; an absent key stands the default width. The
    // derivation makes the read always the full array (the validator's
    // length rule stands).
    const storedWidths = yblock.get("attrs");
    const widthsMap = storedWidths instanceof Y.Map ? storedWidths.get("columnWidths") : undefined;
    const derived = block.columnOrder.map((columnId) => {
      const value = widthsMap instanceof Y.Map ? widthsMap.get(columnId) : undefined;
      return typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_TABLE_COLUMN_WIDTH;
    });
    block.attrs = { ...(block.attrs ?? {}), columnWidths: derived };
  }

  return block as Block;
}

/**
 * The full snapshot read (the cross-minor stand): a known type yields its
 * typed `Block`; an unknown type (a future minor's data) yields the opaque
 * snapshot (the data preserved as-is). `toDocJSON` / the export path use this
 * so an unknown block is never lost on save; the typed `getBlock` accessor
 * uses `readBlock` (null for the unknown type).
 */
function readBlockSnapshot(ydoc: Y.Doc, id: string): Block | OpaqueBlock | null {
  const yblock = getBlockMap(ydoc, id);
  if (!yblock) return null;
  const type = yblock.get("type");
  if (!isKnownBlockType(type)) return readOpaqueBlock(yblock, type);
  return readBlock(ydoc, id);
}

/** The whole document as plain schema JSON (all export normalization applied). */
function toDocJSON(ydoc: Y.Doc): DocJSON {
  const meta = readMeta(ydoc);
  const blocks: Record<string, Block | OpaqueBlock> = {};
  const blocksMap = ydoc.getMap("blocks");
  blocksMap.forEach((_, id) => {
    const block = readBlockSnapshot(ydoc, id);
    if (block) blocks[id] = block;
  });
  return { ...meta, blocks };
}

export { readBlock, readBlockSnapshot, readChildren, readMeta, readRuns, readText, toDocJSON };
