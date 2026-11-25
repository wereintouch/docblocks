/**
 * The table cell merge / split commands. A merged region is one ANCHOR cell
 * (its `colspan`/`rowspan` attrs) standing at the region's top-left grid
 * coordinate; the cells the region covers are deleted from their rows (their
 * content is discarded — the region shows the anchor's content). A split
 * restores single cells over the region: the anchor keeps its content and
 * drops its spans, the restored cells stand empty.
 *
 * Both commands read the grid (`resolveTableGrid`) instead of counting cells:
 * a row is legitimately shorter than the column set once a region covers its
 * cells. One command is one transaction (one undo step, one wire update).
 */
import * as Y from "yjs";

import { isMergeableRect } from "@docblocks-core/schema";

import { InvalidOperationError } from "../../errors";
import { localTransact, writeBlock } from "../../layout";
import { resolveTableGrid } from "../../read/table-grid";
import { getBlockMap, getBlocks } from "../structure";
import { cellsOf, collectSubtree, columnOrderOf, rowsOf, tableOf } from "./common";

/** The grid coordinate of a cell's corner. */
interface TableGridPoint {
  /** The grid row (0 = the first row). */
  row: number;
  /** The grid column (0 = the first column of the column order). */
  col: number;
}

/** The anchor's span writes: a span of 1 is the absent key (the default stand). */
function writeSpan(ydoc: Y.Doc, cellId: string, colspan: number, rowspan: number): void {
  const cell = getBlocks(ydoc).get(cellId);
  if (!(cell instanceof Y.Map)) throw new InvalidOperationError(`Unknown cell "${cellId}" of the table.`);
  let attrs = cell.get("attrs");
  if (!(attrs instanceof Y.Map)) {
    attrs = new Y.Map<unknown>();
    cell.set("attrs", attrs);
  }
  const map = attrs as Y.Map<unknown>;
  if (colspan === 1) map.delete("colspan");
  else map.set("colspan", colspan);
  if (rowspan === 1) map.delete("rowspan");
  else map.set("rowspan", rowspan);
}

/** The caret-independent removal of a cell subtree from its row and the block map. */
function dropCell(ydoc: Y.Doc, rowId: string, cellId: string): void {
  const blocks = getBlocks(ydoc);
  const cell = blocks.get(cellId);
  if (!(cell instanceof Y.Map)) return;
  const row = blocks.get(rowId);
  const cells = row instanceof Y.Map ? row.get("children") : null;
  if (cells instanceof Y.Array) {
    const position = (cells as Y.Array<string>).toArray().indexOf(cellId);
    if (position !== -1) (cells as Y.Array<string>).delete(position, 1);
  }
  for (const id of collectSubtree(ydoc, cellId)) blocks.delete(id);
}

/**
 * Merges the rectangle between the two grid corners into its top-left cell:
 * the rectangle must hold at least two whole cells, stand inside the table,
 * cover only existing cells, and every region it touches must lie entirely
 * inside it (the `isMergeableRect` predicate — the editor's menu reads the
 * same stand, so an offered merge is an applied merge).
 */
function mergeTableCells(ydoc: Y.Doc, tableId: string, first: TableGridPoint, second: TableGridPoint): void {
  const grid = resolveTableGrid(ydoc, tableId);
  if (grid === null) throw new InvalidOperationError(`Block "${tableId}" is not a table.`);
  const top = Math.min(first.row, second.row);
  const bottom = Math.max(first.row, second.row);
  const left = Math.min(first.col, second.col);
  const right = Math.max(first.col, second.col);
  if (!Number.isInteger(top) || !Number.isInteger(left) || !Number.isInteger(bottom) || !Number.isInteger(right)) {
    throw new InvalidOperationError("The merged region's corners must be integer grid coordinates.");
  }
  if (!isMergeableRect(grid, { top, left, bottom, right })) {
    throw new InvalidOperationError(
      "The rectangle is not mergeable: it must hold at least two whole cells inside the table's grid, " +
        "with no gap under it, and every merged region it touches must lie entirely inside it."
    );
  }
  const anchor = grid.cellAt(top, left);
  if (anchor === null) throw new InvalidOperationError("The rectangle's top-left coordinate stands no cell.");
  const covered = grid.anchorsIn(top, left, bottom, right);
  for (const region of covered) {
    const inside =
      region.row >= top &&
      region.col >= left &&
      region.row + region.rowspan - 1 <= bottom &&
      region.col + region.colspan - 1 <= right;
    if (!inside) {
      throw new InvalidOperationError(
        "The merge crosses a part of an existing merged region (the regions merge whole)."
      );
    }
  }
  const table = tableOf(ydoc, tableId);
  const rowIds = rowsOf(table, tableId).toArray();
  const rowIdByGridRow = (row: number): string => {
    const rowId = rowIds[row];
    if (rowId === undefined) throw new InvalidOperationError(`The table has no row ${row}.`);
    return rowId;
  };
  localTransact(ydoc, () => {
    for (const region of covered) {
      if (region.id === anchor.id) continue;
      dropCell(ydoc, rowIdByGridRow(region.row), region.id);
    }
    writeSpan(ydoc, anchor.id, right - left + 1, bottom - top + 1);
  });
}

/**
 * Splits the merged region containing the coordinate back into single cells:
 * the anchor keeps its content and drops its spans, the restored cells stand
 * empty with their column bindings (they land at their columns' positions).
 */
function splitTableCells(ydoc: Y.Doc, generateId: () => string, tableId: string, row: number, col: number): void {
  const grid = resolveTableGrid(ydoc, tableId);
  if (grid === null) throw new InvalidOperationError(`Block "${tableId}" is not a table.`);
  const anchor = grid.cellAt(row, col);
  if (anchor === null) {
    throw new InvalidOperationError(`No cell stands at row ${row}, column ${col}.`);
  }
  if (anchor.colspan === 1 && anchor.rowspan === 1) return; // a single cell: nothing to split
  const table = tableOf(ydoc, tableId);
  const columnIds = columnOrderOf(table, tableId).toArray();
  const rowIds = rowsOf(table, tableId).toArray();
  localTransact(ydoc, () => {
    writeSpan(ydoc, anchor.id, 1, 1);
    const blocks = getBlocks(ydoc);
    for (let gridRow = anchor.row; gridRow < anchor.row + anchor.rowspan; gridRow += 1) {
      const rowId = rowIds[gridRow];
      if (rowId === undefined) continue;
      const cells = cellsOf(rowMapOf(ydoc, rowId), tableId, rowId);
      for (let gridCol = anchor.col; gridCol < anchor.col + anchor.colspan; gridCol += 1) {
        if (gridRow === anchor.row && gridCol === anchor.col) continue;
        const columnId = columnIds[gridCol];
        if (columnId === undefined) continue;
        const cellId = generateId();
        writeBlock(blocks, cellId, { type: "table-cell", attrs: { columnId } });
        const cellMap = blocks.get(cellId);
        if (cellMap instanceof Y.Map) cellMap.set("parent", rowId);
        // The cells stand in the column order: the fresh cell lands before
        // the first cell of a later column.
        const position = cells
          .toArray()
          .findIndex((existingId) => columnIndexOf(ydoc, existingId, columnIds) > gridCol);
        cells.insert(position === -1 ? cells.length : position, [cellId]);
      }
    }
  });
}

/** The row's block map; a typed error when the layout lost it. */
function rowMapOf(ydoc: Y.Doc, rowId: string): Y.Map<unknown> {
  const row = getBlockMap(ydoc, rowId);
  if (row === null) throw new InvalidOperationError(`Unknown row "${rowId}" of the table.`);
  return row;
}

/** The cell's column position by its binding (the legacy unbound cell falls back to its row position). */
function columnIndexOf(ydoc: Y.Doc, cellId: string, columnIds: readonly string[]): number {
  const cell = getBlocks(ydoc).get(cellId);
  const attrs = cell instanceof Y.Map ? cell.get("attrs") : null;
  const columnId = attrs instanceof Y.Map ? attrs.get("columnId") : undefined;
  return typeof columnId === "string" ? columnIds.indexOf(columnId) : -1;
}

/** True when the row carries a merged region or a region from above reaches into it. */
function standsInMergedRegion(ydoc: Y.Doc, tableId: string, rowId: string): boolean {
  const grid = resolveTableGrid(ydoc, tableId);
  if (grid === null) return false;
  const table = getBlockMap(ydoc, tableId);
  const rows = table !== null ? table.get("children") : null;
  const rowIndex = rows instanceof Y.Array ? (rows as Y.Array<string>).toArray().indexOf(rowId) : -1;
  if (rowIndex === -1) return false;
  const own = grid.rows[rowIndex] ?? [];
  if (own.some((anchor) => anchor.colspan > 1 || anchor.rowspan > 1)) return true;
  return grid.rows
    .slice(0, rowIndex)
    .some((anchors) => anchors.some((anchor) => anchor.row + anchor.rowspan - 1 >= rowIndex));
}

export { mergeTableCells, splitTableCells, standsInMergedRegion };
export type { TableGridPoint };
