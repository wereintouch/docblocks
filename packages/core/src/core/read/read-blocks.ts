/**
 * The per-block snapshot reads: the typed block read over the registry
 * (attrs, content, children, rows/rowOrder, columnOrder/columnWidths, the
 * additive top-level fields), and the full snapshot read (the typed block
 * or the opaque stand of an unknown type).
 */
import * as Y from "yjs";

import { BLOCK_REGISTRY, DEFAULT_TABLE_COLUMN_WIDTH, setOwn } from "@docblocks-core/schema";
import type { Block, OpaqueBlock, TextRun } from "@docblocks-core/schema";

import { derivedZIndex } from "../commands";
import { LAYOUT_BLOCK_KEYS } from "../layout";
import { normalizeRuns } from "../normalize";
import { attrsToMarkSet } from "../text-model";
import type { TextDeltaOp } from "../text-model";
import type { BlockDraft } from "./models";
import { readOpaqueBlock } from "./read-opaque";
import { getBlockMap, readChildren, readRuns } from "./read-text";
import { dedupeOrder, isKnownBlockType, readPlainValue } from "./values";

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
      for (const [key, value] of entries) setOwn(plain, key, value);
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
        // readPlainValue of a Y.Map is a plain object of plain values. The
        // own write: the id key is wire data (the reader's defense in
        // depth over the id-safety boundary).
        setOwn(rows, rowId, row instanceof Y.Map ? (readPlainValue(row) as Record<string, unknown>) : {});
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
  // validator flags it, the lenient reader stands the set). Two concurrent
  // moveTableColumn calls of the same column leave both re-inserts in the raw
  // array (the same residue as the database's rowOrder above); the reader
  // deduplicates first-occurrence so `toJSON` stays valid on every peer (the
  // raw layer keeps the residue).
  if (spec.columnOrder) {
    const columnOrder = yblock.get("columnOrder");
    block.columnOrder =
      columnOrder instanceof Y.Array
        ? dedupeOrder(columnOrder.toArray().filter((columnId): columnId is string => typeof columnId === "string"))
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

  // Additive top-level fields of a future minor on a KNOWN type: preserved
  // as-is so a save never drops data the engine does not know (the
  // cross-minor stand, the opaque reader's parity). The layout's own keys
  // stand their typed reads; `parent` is the Yjs-layout-only owner field
  // and never reaches the JSON. Sorted keys: the Y.Map's iteration order is
  // process-dependent, so the JSON key order stays deterministic on every
  // peer.
  const extra: Array<[string, unknown]> = [];
  yblock.forEach((value, key) => {
    if (typeof key === "string" && !LAYOUT_BLOCK_KEYS.has(key)) extra.push([key, value]);
  });
  extra.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [key, value] of extra) {
    if (value instanceof Y.Text) {
      // A text field reads like the content: Y.Text -> runs (a plain value
      // must never leak a live Yjs type).
      const raw: TextRun[] = [];
      for (const op of value.toDelta() as TextDeltaOp[]) {
        if (typeof op.insert !== "string") continue;
        raw.push({ text: op.insert, marks: attrsToMarkSet(op.attributes) });
      }
      const runs = normalizeRuns(raw);
      if (runs.length > 0) setOwn(block, key, runs);
      continue;
    }
    // The open key comes from the CRDT (the reserved-key's stand — the
    // own data key, the prototype untouched).
    setOwn(block, key, readPlainValue(value));
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

export { readBlock, readBlockSnapshot };
