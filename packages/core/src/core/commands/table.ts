/**
 * Table row/column commands: insertTableRow, removeTableRow,
 * moveTableRow, duplicateTableRow, clearTableRow, setTableRowColor, and
 * the column-side counterparts (insertTableColumn, removeTableColumn,
 * moveTableColumn, duplicateTableColumn, clearTableColumn,
 * setTableColumnColor, setTableColumnWidth). Rows and cells are blocks
 * (unlike the database's data rows), so the commands compose the layout
 * primitives inside one local transaction: one command is one update and
 * one undo step.
 *
 * Column identity: `columnWidths` and the per-cell colors follow the
 * column (a move reorders the entries, a duplicate copies them), so a
 * reordered column keeps its width and colors.
 *
 * Removing the LAST row or column converts the table into a plain
 * paragraph in place (the children are gone by then; the indent attr
 * stands).
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
} from "../errors";
import { localTransact, writeAttrValue, writeBlock } from "../layout";
import type { WritableBlock } from "../layout";
import { readBlock } from "../read";
import { removeBlock } from "./blocks";
import { blockTypeOf, childrenOf, getBlockMap, getBlocks, readCols } from "./structure";
import { changeBlockType } from "./types";

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

/**
 * Appends an empty row (cells without content blocks — an empty cell has
 * no data until a paragraph is placed in it) and returns the row id. With
 * `afterRowId`, the row lands right after it.
 */
function insertTableRow(ydoc: Y.Doc, generateId: () => string, tableId: string, afterRowId?: string): string {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const cols = readCols(ydoc, tableId);
  if (cols === null) {
    throw new InvalidOperationError(`Table "${tableId}" has no valid "cols" attribute.`);
  }
  const rowIds = rows.toArray();
  let index = rowIds.length;
  if (afterRowId !== undefined) {
    const afterIndex = rowIds.indexOf(afterRowId);
    if (afterIndex === -1) {
      throw new DetachedBlockError(`Row "${afterRowId}" is not a child of table "${tableId}".`);
    }
    index = afterIndex + 1;
  }
  const rowId = generateId();
  const cellIds = Array.from({ length: cols }, () => generateId());
  localTransact(ydoc, () => {
    const blocks = getBlocks(ydoc);
    cellIds.forEach((cellId) => writeBlock(blocks, cellId, { type: "table-cell" }));
    writeBlock(blocks, rowId, { type: "table-row", children: cellIds });
    rows.insert(index, [rowId]);
  });
  return rowId;
}

/**
 * Removes a row and its cells. The LAST row converts the table into a
 * plain paragraph (the block id and the indent stand).
 */
function removeTableRow(ydoc: Y.Doc, tableId: string, rowId: string): void {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const rowIds = rows.toArray();
  const index = rowIds.indexOf(rowId);
  if (index === -1) throw new DetachedBlockError(`Row "${rowId}" is not a child of table "${tableId}".`);
  localTransact(ydoc, () => {
    removeBlock(ydoc, rowId);
    if (rowsOf(table, tableId).toArray().length === 0) convertToParagraph(ydoc, tableId);
  });
}

/**
 * Moves a row to `toIndex` (pre-move index semantics, like moveRow):
 * `toIndex` is the index in the PRE-move order; the end index appends.
 */
function moveTableRow(ydoc: Y.Doc, tableId: string, rowId: string, toIndex: number): void {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const ids = rows.toArray();
  const fromIndex = ids.indexOf(rowId);
  if (fromIndex === -1) throw new DetachedBlockError(`Row "${rowId}" is not a child of table "${tableId}".`);
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > ids.length) {
    throw new InvalidRangeError(`toIndex must be an integer in [0, ${ids.length}] (got ${toIndex}).`);
  }
  localTransact(ydoc, () => {
    rows.delete(fromIndex, 1);
    // Pre-move indices: the removal shifts a later target left by one.
    const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
    rows.insert(insertAt, [rowId]);
  });
}

/**
 * Duplicates a row right below it: the cells are deep-copied (the child
 * paragraphs with their runs and attrs, the cell attrs incl. the colors).
 * Returns the new row id.
 */
function duplicateTableRow(ydoc: Y.Doc, generateId: () => string, tableId: string, rowId: string): string {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const rowIds = rows.toArray();
  const fromIndex = rowIds.indexOf(rowId);
  if (fromIndex === -1) throw new DetachedBlockError(`Row "${rowId}" is not a child of table "${tableId}".`);
  const snap = snapshotSubtree(ydoc, generateId, rowId);
  let newRowId = "";
  localTransact(ydoc, () => {
    newRowId = writeSubtreeCopy(ydoc, snap);
    rows.insert(fromIndex + 1, [newRowId]);
  });
  return newRowId;
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

/** Clears the cell content of every cell in a row (the cells stay, empty). */
function clearTableRow(ydoc: Y.Doc, tableId: string, rowId: string): void {
  const table = tableOf(ydoc, tableId);
  const row = rowOf(ydoc, tableId, table, rowId);
  const cellIds = cellsOf(row, tableId, rowId).toArray();
  localTransact(ydoc, () => {
    for (const cellId of cellIds) clearBlockChildren(ydoc, cellId);
  });
}

/** Sets (or removes, `null`) the row color on every cell of a row. */
function setTableRowColor(ydoc: Y.Doc, tableId: string, rowId: string, color: string | null): void {
  const table = tableOf(ydoc, tableId);
  const row = rowOf(ydoc, tableId, table, rowId);
  const cellIds = cellsOf(row, tableId, rowId).toArray();
  if (color !== null) assertCellColor("rowColor", color, tableId);
  localTransact(ydoc, () => {
    for (const cellId of cellIds) setCellColor(ydoc, cellId, "rowColor", color);
  });
}

/**
 * Inserts an empty column (100 px wide, cells without content blocks)
 * after `afterIndex` (appended when omitted) and keeps `cols` and
 * `columnWidths` in sync.
 */
function insertTableColumn(ydoc: Y.Doc, generateId: () => string, tableId: string, afterIndex?: number): void {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const cols = readCols(ydoc, tableId);
  if (cols === null) throw new InvalidOperationError(`Table "${tableId}" has no valid "cols" attribute.`);
  const index = afterIndex === undefined ? cols : afterIndex + 1;
  if (afterIndex !== undefined) assertIndex(afterIndex, cols, "Column");
  const rowIds = rows.toArray();
  const cellIds = rowIds.map(() => generateId());
  localTransact(ydoc, () => {
    const blocks = getBlocks(ydoc);
    rowIds.forEach((rowId, i) => {
      const row = getBlockMap(ydoc, rowId);
      const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : undefined;
      if (row === null || !(cells instanceof Y.Array)) {
        throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence.`);
      }
      const cellId = cellIds[i]!;
      writeBlock(blocks, cellId, { type: "table-cell" });
      cells.insert(index, [cellId]);
    });
    writeCols(table, cols + 1);
    // Element-level insert: the width follows the column position. When the
    // array is absent it materializes as all defaults (value set).
    const live = widthsArray(table);
    if (live !== null) live.insert(index, [DEFAULT_TABLE_COLUMN_WIDTH]);
    else {
      const current = Array.from({ length: cols }, () => DEFAULT_TABLE_COLUMN_WIDTH);
      current.splice(index, 0, DEFAULT_TABLE_COLUMN_WIDTH);
      writeWidths(table, current);
    }
  });
}

/**
 * Removes the column at `index` (the cells and their content, in every
 * row). The LAST column converts the table into a plain paragraph (the
 * block id and the indent stand).
 */
function removeTableColumn(ydoc: Y.Doc, tableId: string, index: number): void {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const cols = readCols(ydoc, tableId);
  if (cols === null) throw new InvalidOperationError(`Table "${tableId}" has no valid "cols" attribute.`);
  assertIndex(index, cols, "Column");
  const rowIds = rows.toArray();
  localTransact(ydoc, () => {
    const blocks = getBlocks(ydoc);
    for (const rowId of rowIds) {
      const row = getBlockMap(ydoc, rowId);
      const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : undefined;
      if (row === null || !(cells instanceof Y.Array)) {
        throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence.`);
      }
      const cellId = cells.toArray()[index]!;
      for (const id of collectSubtree(ydoc, cellId)) blocks.delete(id);
      cells.delete(index, 1);
    }
    if (cols === 1) {
      // The last column: the rows are gone — convert the table in place.
      for (const rowId of rowIds) blocks.delete(rowId);
      rows.delete(0, rows.length);
      convertToParagraph(ydoc, tableId);
    } else {
      writeCols(table, cols - 1);
      const live = widthsArray(table);
      if (live !== null) live.delete(index, 1);
    }
  });
}

/**
 * Moves the column from `fromIndex` to `toIndex` (pre-move index
 * semantics, like moveRow): the cells of EVERY row move together with the
 * width entry (the colors ride the cells).
 */
function moveTableColumn(ydoc: Y.Doc, tableId: string, fromIndex: number, toIndex: number): void {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const cols = readCols(ydoc, tableId);
  if (cols === null) throw new InvalidOperationError(`Table "${tableId}" has no valid "cols" attribute.`);
  assertIndex(fromIndex, cols, "Column");
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > cols) {
    throw new InvalidRangeError(`toIndex must be an integer in [0, ${cols}] (got ${toIndex}).`);
  }
  const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
  const rowIds = rows.toArray();
  localTransact(ydoc, () => {
    for (const rowId of rowIds) {
      const row = getBlockMap(ydoc, rowId);
      const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : undefined;
      if (row === null || !(cells instanceof Y.Array)) {
        throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence.`);
      }
      const cellId = cells.toArray()[fromIndex]!;
      cells.delete(fromIndex, 1);
      cells.insert(insertAt, [cellId]);
    }
    // The width entry follows the column (element-level move).
    const live = widthsArray(table);
    if (live !== null) {
      const width = live.toArray()[fromIndex];
      live.delete(fromIndex, 1);
      live.insert(insertAt, [width]);
    }
  });
}

/**
 * Duplicates the column at `index` right of it: the cells are deep-copied
 * (content + colors) and the width entry is copied; `cols` grows.
 */
function duplicateTableColumn(ydoc: Y.Doc, generateId: () => string, tableId: string, index: number): void {
  const table = tableOf(ydoc, tableId);
  const rows = rowsOf(table, tableId);
  const cols = readCols(ydoc, tableId);
  if (cols === null) throw new InvalidOperationError(`Table "${tableId}" has no valid "cols" attribute.`);
  assertIndex(index, cols, "Column");
  const rowIds = rows.toArray();
  const snaps = rowIds.map((rowId) => {
    const row = getBlockMap(ydoc, rowId);
    const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : null;
    if (row === null || cells === null || !(cells instanceof Y.Array)) {
      throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence.`);
    }
    return snapshotSubtree(ydoc, generateId, cells.toArray()[index]!);
  });
  const width = readWidths(table)?.[index] ?? DEFAULT_TABLE_COLUMN_WIDTH;
  localTransact(ydoc, () => {
    rowIds.forEach((rowId, i) => {
      const row = getBlockMap(ydoc, rowId);
      const cells = row !== null ? (row.get("children") as Y.Array<string> | undefined) : undefined;
      if (row === null || !(cells instanceof Y.Array)) {
        throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence.`);
      }
      cells.insert(index + 1, [writeSubtreeCopy(ydoc, snaps[i]!)]);
    });
    writeCols(table, cols + 1);
    // The width entry is copied (element-level insert; absent array
    // materializes as all defaults).
    const live = widthsArray(table);
    if (live !== null) {
      live.insert(index + 1, [width]);
    } else {
      const widths = Array.from({ length: cols }, () => DEFAULT_TABLE_COLUMN_WIDTH);
      widths.splice(index + 1, 0, width);
      writeWidths(table, widths);
    }
  });
}

/** The cell id of the column at `index` in every row; typed error on a corrupt row. */
function columnCellIds(ydoc: Y.Doc, table: Y.Map<unknown>, tableId: string, index: number): string[] {
  const cellIds: string[] = [];
  for (const rowId of rowsOf(table, tableId).toArray()) {
    const row = getBlockMap(ydoc, rowId);
    const cells = row !== null ? row.get("children") : null;
    if (row === null || !(cells instanceof Y.Array)) {
      throw new InvalidOperationError(`Row "${rowId}" of table "${tableId}" has no cell sequence (corrupt layout).`);
    }
    const cellId = (cells as Y.Array<string>).toArray()[index];
    if (cellId === undefined) {
      throw new InvalidOperationError(
        `Row "${rowId}" of table "${tableId}" has fewer than ${index + 1} cell(s) (corrupt layout).`
      );
    }
    cellIds.push(cellId);
  }
  return cellIds;
}

/** Clears the cell content of every cell in a column (the cells stay, empty). */
function clearTableColumn(ydoc: Y.Doc, tableId: string, index: number): void {
  const table = tableOf(ydoc, tableId);
  const cols = readCols(ydoc, tableId);
  if (cols === null) throw new InvalidOperationError(`Table "${tableId}" has no valid "cols" attribute.`);
  assertIndex(index, cols, "Column");
  const cellIds = columnCellIds(ydoc, table, tableId, index);
  localTransact(ydoc, () => {
    for (const cellId of cellIds) clearBlockChildren(ydoc, cellId);
  });
}

/** Sets (or removes, `null`) the column color on every cell of a column. */
function setTableColumnColor(ydoc: Y.Doc, tableId: string, index: number, color: string | null): void {
  const table = tableOf(ydoc, tableId);
  const cols = readCols(ydoc, tableId);
  if (cols === null) throw new InvalidOperationError(`Table "${tableId}" has no valid "cols" attribute.`);
  assertIndex(index, cols, "Column");
  if (color !== null) assertCellColor("columnColor", color, tableId);
  const cellIds = columnCellIds(ydoc, table, tableId, index);
  localTransact(ydoc, () => {
    for (const cellId of cellIds) setCellColor(ydoc, cellId, "columnColor", color);
  });
}

/**
 * Sets the width of the column at `index` (>= 50; no silent clamp). An
 * absent `columnWidths` starts as all defaults (only the changed entry
 * stands non-default). An equal-value set is a zero-byte no-op: the
 * comparison runs BEFORE the transaction (a transaction always stamps
 * meta.updatedAt, so the no-op must skip the transaction, not the write).
 */
function setTableColumnWidth(ydoc: Y.Doc, tableId: string, index: number, width: number): void {
  const table = tableOf(ydoc, tableId);
  const cols = readCols(ydoc, tableId);
  if (cols === null) throw new InvalidOperationError(`Table "${tableId}" has no valid "cols" attribute.`);
  assertIndex(index, cols, "Column");
  assertWidth(width, tableId);
  const current = readWidths(table) ?? Array.from({ length: cols }, () => DEFAULT_TABLE_COLUMN_WIDTH);
  if (current[index] === width) return;
  const live = widthsArray(table);
  localTransact(ydoc, () => {
    if (live !== null) {
      // Y.Array has no element set: replace via delete + insert.
      live.delete(index, 1);
      live.insert(index, [width]);
    } else {
      const widths = current.slice();
      widths[index] = width;
      writeWidths(table, widths);
    }
  });
}

export {
  DEFAULT_TABLE_COLUMN_WIDTH,
  clearTableColumn,
  clearTableRow,
  duplicateTableColumn,
  duplicateTableRow,
  insertTableColumn,
  insertTableRow,
  moveTableColumn,
  moveTableRow,
  removeTableColumn,
  removeTableRow,
  setTableColumnColor,
  setTableColumnWidth,
  setTableRowColor,
};
