/**
 * Shared table layout primitives: the Yjs accessors (typed errors on a
 * corrupt layout), the value checks, the `columnWidths`/`cols`/color writes,
 * and the subtree-copy helpers. They run inside the caller's transaction;
 * none of them opens a transaction of its own.
 */
import * as Y from "yjs";

import { validateBlockAttrs } from "@docblocks-core/schema";
import type { Block } from "@docblocks-core/schema";

import {
  DetachedBlockError,
  InvalidAttrsError,
  InvalidOperationError,
  InvalidRangeError,
  UnknownBlockError,
  formatValidationErrors,
} from "../../errors";
import { writeAttrValue, writeBlock } from "../../layout";
import type { WritableBlock } from "../../layout";
import { readBlock } from "../../read";
import { blockTypeOf, childrenOf, getBlockMap, getBlocks } from "../structure";
import { changeBlockType } from "../types";

/** The default width of a column without a `columnWidths` entry. */
const DEFAULT_TABLE_COLUMN_WIDTH = 100;

/** The minimum column width (the validator's `columnWidths` item min). */
const MIN_COLUMN_WIDTH = 50;

/** The table block's Y.Map; typed errors when the id is missing or not a table. */
function tableOf(ydoc: Y.Doc, tableId: string): Y.Map<unknown> {
  const type = blockTypeOf(ydoc, tableId);
  if (type === null) throw new UnknownBlockError(`Unknown block "${tableId}".`);
  if (type !== "table") throw new InvalidOperationError(`Block "${tableId}" is a ${type}, not a table.`);
  const block = getBlockMap(ydoc, tableId);
  if (block === null) throw new UnknownBlockError(`Unknown block "${tableId}".`);
  return block;
}

/** The table's row sequence; typed error on a corrupt layout. */
function rowsOf(table: Y.Map<unknown>, tableId: string): Y.Array<string> {
  const rows = table.get("children");
  if (!(rows instanceof Y.Array)) {
    throw new InvalidOperationError(`Table "${tableId}" has no row sequence (corrupt layout).`);
  }
  return rows as Y.Array<string>;
}

/** The row by id; typed error when the id is not a child of the table. */
function rowOf(ydoc: Y.Doc, tableId: string, table: Y.Map<unknown>, rowId: string): Y.Map<unknown> {
  const rows = rowsOf(table, tableId).toArray();
  if (!rows.includes(rowId)) throw new DetachedBlockError(`Row "${rowId}" is not a child of table "${tableId}".`);
  const row = getBlockMap(ydoc, rowId);
  if (row === null) throw new UnknownBlockError(`Unknown row "${rowId}" of table "${tableId}".`);
  return row;
}

/** The row's cell sequence; typed error on a corrupt layout. */
function cellsOf(row: Y.Map<unknown>, tableId: string, rowId: string): Y.Array<string> {
  const cells = row.get("children");
  if (!(cells instanceof Y.Array)) {
    throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence (corrupt layout).`);
  }
  return cells as Y.Array<string>;
}

/** The column index bounds check (inclusive start, exclusive end). */
function assertIndex(index: number, cols: number, what: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= cols) {
    throw new InvalidRangeError(`${what} index must be an integer in [0, ${cols - 1}] (got ${index}).`);
  }
}

/** The insert position check (inclusive both ends: 0 = first, count = append). */
function assertInsertIndex(index: number, count: number, what: string): void {
  if (!Number.isInteger(index) || index < 0 || index > count) {
    throw new InvalidRangeError(`${what} position must be an integer in [0, ${count}] (got ${index}).`);
  }
}

/** The width value check (the validator's item rule, no silent clamp). */
function assertWidth(width: number, tableId: string): void {
  if (typeof width !== "number" || !Number.isFinite(width) || width < MIN_COLUMN_WIDTH) {
    throw new InvalidAttrsError(
      `Invalid column width for table "${tableId}": a finite number >= ${MIN_COLUMN_WIDTH} (got ${width}).`
    );
  }
}

/** The cell color value check (the table-cell spec's hex rule). */
function assertCellColor(key: "columnColor" | "rowColor", color: string, tableId: string): void {
  const errors = validateBlockAttrs("table-cell", { [key]: color });
  if (errors.length > 0) {
    throw new InvalidAttrsError(`Invalid ${key} for table "${tableId}": ${formatValidationErrors(errors)}`);
  }
}

/** The table's `columnWidths` sequence (null when absent — the defaults stand). */
function widthsArray(table: Y.Map<unknown>): Y.Array<unknown> | null {
  const attrs = table.get("attrs");
  if (!(attrs instanceof Y.Map)) return null;
  const widths = (attrs as Y.Map<unknown>).get("columnWidths");
  // writeAttrValue stores plain arrays as Y.Array — read the live sequence.
  return widths instanceof Y.Array ? (widths as Y.Array<unknown>) : null;
}

/** The table's column widths as a plain copy (null when absent or corrupt — the defaults stand). */
function readWidths(table: Y.Map<unknown>): number[] | null {
  const widths = widthsArray(table);
  if (widths === null) return null;
  const values = widths.toArray();
  const numbers = values.filter((width): width is number => typeof width === "number");
  return numbers.length === values.length ? numbers : null;
}

/** Writes the table's `columnWidths` attr (creates the attrs map when absent). */
function writeWidths(table: Y.Map<unknown>, widths: number[]): void {
  let attrs = table.get("attrs");
  if (!(attrs instanceof Y.Map)) {
    attrs = new Y.Map<unknown>();
    table.set("attrs", attrs);
  }
  writeAttrValue(attrs as Y.Map<unknown>, "columnWidths", widths);
}

/** Writes the table's `cols` attr (creates the attrs map when absent). */
function writeCols(table: Y.Map<unknown>, cols: number): void {
  let attrs = table.get("attrs");
  if (!(attrs instanceof Y.Map)) {
    attrs = new Y.Map<unknown>();
    table.set("attrs", attrs);
  }
  writeAttrValue(attrs as Y.Map<unknown>, "cols", cols);
}

/** Sets (or removes) one color attr on a cell inside the caller's transaction. */
function setCellColor(ydoc: Y.Doc, cellId: string, key: "columnColor" | "rowColor", color: string | null): void {
  const cell = getBlockMap(ydoc, cellId);
  if (cell === null) return;
  const attrs = cell.get("attrs");
  if (color === null) {
    if (attrs instanceof Y.Map) (attrs as Y.Map<unknown>).delete(key);
    return;
  }
  if (attrs instanceof Y.Map) {
    writeAttrValue(attrs as Y.Map<unknown>, key, color);
    return;
  }
  const fresh = new Y.Map<unknown>();
  writeAttrValue(fresh, key, color);
  cell.set("attrs", fresh);
}

/** The block's subtree (itself first, descendants in BFS order). */
function collectSubtree(ydoc: Y.Doc, id: string): string[] {
  const result = [id];
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const children = childrenOf(ydoc, current);
    if (children === null) continue;
    for (const child of children.toArray()) {
      result.push(child);
      stack.push(child);
    }
  }
  return result;
}

/** Removes a block's descendants (the block itself stays) inside the caller's transaction. */
function clearBlockChildren(ydoc: Y.Doc, blockId: string): void {
  const cell = getBlockMap(ydoc, blockId);
  if (cell === null) return;
  const blocks = getBlocks(ydoc);
  for (const id of collectSubtree(ydoc, blockId).slice(1)) blocks.delete(id);
  const children = cell.get("children");
  if (children instanceof Y.Array) (children as Y.Array<string>).delete(0, children.length);
  // The legacy cell content (pre the child-paragraph form) is dropped too.
  const content = cell.get("content");
  if (content instanceof Y.Array) (content as Y.Array<unknown>).delete(0, content.length);
}

/**
 * Converts a rowless table into a paragraph in place (the caller runs it
 * after the last row is gone, inside its own transaction): the type
 * change drops the table-only attrs (cols/columnWidths) and keeps the
 * indent; the content array starts empty.
 */
function convertToParagraph(ydoc: Y.Doc, tableId: string): void {
  changeBlockType(ydoc, tableId, "paragraph", undefined);
}

/** Reads one color attr of a cell (null when absent or invalid). */
function readCellColor(ydoc: Y.Doc, cellId: string, key: "rowColor" | "columnColor"): string | null {
  const cell = getBlockMap(ydoc, cellId);
  if (cell === null) return null;
  const attrs = cell.get("attrs");
  if (!(attrs instanceof Y.Map)) return null;
  const value = (attrs as Y.Map<unknown>).get(key);
  return typeof value === "string" ? value : null;
}

/**
 * The snapshot phase of a subtree copy (pure reads, outside any
 * transaction): the source ids + their JSON snapshots + the fresh ids.
 */
function snapshotSubtree(
  ydoc: Y.Doc,
  generateId: () => string,
  rootId: string
): { ids: string[]; jsons: (Block | null)[]; newIds: string[]; idMap: Map<string, string> } {
  const ids = collectSubtree(ydoc, rootId);
  const jsons = ids.map((id) => readBlock(ydoc, id));
  const newIds = ids.map(() => generateId());
  const idMap = new Map(ids.map((oldId, i) => [oldId, newIds[i]!]));
  return { ids, jsons, newIds, idMap };
}

/**
 * The write phase of a subtree copy (the caller runs it inside its own
 * transaction): writes the remapped block entries with the fresh ids and
 * returns the new root id.
 */
function writeSubtreeCopy(
  ydoc: Y.Doc,
  snap: { ids: string[]; jsons: (Block | null)[]; newIds: string[]; idMap: Map<string, string> }
): string {
  const { ids, jsons, newIds, idMap } = snap;
  const blocks = getBlocks(ydoc);
  ids.forEach((oldId, i) => {
    const json = jsons[i]!;
    if (json === null) throw new UnknownBlockError(`Block "${oldId}" vanished while copying (corrupt layout).`);
    const entry: WritableBlock = { type: json.type };
    if ("attrs" in json && json.attrs !== undefined) entry.attrs = json.attrs;
    if ("geometry" in json && json.geometry !== undefined) entry.geometry = json.geometry;
    if ("content" in json && json.content !== undefined) entry.content = json.content;
    if ("children" in json && json.children !== undefined) {
      entry.children = json.children.map((childId) => idMap.get(childId) ?? childId);
    }
    writeBlock(blocks, newIds[i]!, entry);
  });
  return newIds[0]!;
}

export {
  DEFAULT_TABLE_COLUMN_WIDTH,
  assertCellColor,
  assertIndex,
  assertInsertIndex,
  assertWidth,
  cellsOf,
  clearBlockChildren,
  collectSubtree,
  convertToParagraph,
  readCellColor,
  readWidths,
  rowOf,
  rowsOf,
  setCellColor,
  snapshotSubtree,
  tableOf,
  widthsArray,
  writeCols,
  writeSubtreeCopy,
  writeWidths,
};
