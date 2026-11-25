/**
 * The doc-level table grid: the read path's resolver over `readBlock` (the
 * same snapshot reader the store projects through), so the placement follows
 * the document's converged state.
 *
 * A merged region is one anchor cell (its `colspan`/`rowspan` attrs) at its
 * top-left grid coordinate; the cells it covers are absent from their rows.
 * Every consumer that needs a cell by coordinate (the merge/split commands,
 * the renderer, the structural guards) reads the grid here instead of
 * counting cells.
 */
import type * as Y from "yjs";

import { buildTableGrid } from "@docblocks-core/schema";
import type { GridCellInput, TableGrid } from "@docblocks-core/schema";

import { readBlock } from "./read-blocks";

/** The cell's grid input over the cell's snapshot (the spans default to 1). */
function gridCellOf(ydoc: Y.Doc, cellId: string): GridCellInput | null {
  const cell = readBlock(ydoc, cellId);
  if (cell === null || cell.type !== "table-cell") return null;
  const attrs = cell.attrs;
  return {
    id: cellId,
    columnId: attrs?.columnId ?? null,
    colspan: attrs?.colspan ?? 1,
    rowspan: attrs?.rowspan ?? 1,
  };
}

/**
 * The table's grid (the anchors' placements + the coordinate lookups), or
 * null when `tableId` is not a table.
 */
function resolveTableGrid(ydoc: Y.Doc, tableId: string): TableGrid | null {
  const table = readBlock(ydoc, tableId);
  if (table === null || table.type !== "table") return null;
  const rows: GridCellInput[][] = (table.children ?? []).map((rowId) => {
    const row = readBlock(ydoc, rowId);
    if (row === null || row.type !== "table-row") return [];
    return (row.children ?? []).flatMap((cellId) => {
      const cell = gridCellOf(ydoc, cellId);
      return cell === null ? [] : [cell];
    });
  });
  return buildTableGrid(table.columnOrder, rows).grid;
}

export { resolveTableGrid };
