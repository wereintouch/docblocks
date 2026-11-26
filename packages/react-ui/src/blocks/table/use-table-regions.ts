/**
 * The table's merged regions over the renderer's chrome: no reorder handle
 * for a column / row the region spans (a reorder through a region would shift
 * its rectangle; the core rejects it, and the chrome simply offers nothing).
 * The region's column seams stand unblocked — a covered column resizes on its
 * own seam, and the region's width follows the columns' sum (the core's
 * width set has no region guard).
 */
import { useStore } from "zustand";

import { useMemo } from "react";

import { resolveTableGrid } from "docblocks-core";
import type { BlockId, Doc } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";

interface UseTableRegionsArgs {
  doc: Doc;
  tableId: BlockId;
}

interface TableRegionStands {
  /** The columns a region spans (their handles offer no reorder). */
  lockedColumns: ReadonlySet<number>;
  /** The rows a region spans (their handles offer no reorder). */
  lockedRows: ReadonlySet<number>;
}

/**
 * The region-derived chrome stands. The chrome stamp re-reads the grid over
 * any structural change: a merge moves the cells' attrs and the rows'
 * children, not the table's own block, so the table's snapshot alone would
 * not re-render this.
 */
function useTableRegions({ doc, tableId }: UseTableRegionsArgs): TableRegionStands {
  const { store } = useEditorContext();
  const chromeStamp = useStore(store, (state) => state.chromeStamp);
  return useMemo(() => {
    const grid = resolveTableGrid(doc.raw, tableId);
    const lockedColumns = new Set<number>();
    const lockedRows = new Set<number>();
    for (const anchor of grid?.rows.flat() ?? []) {
      if (anchor.colspan > 1) {
        for (let col = anchor.col; col < anchor.col + anchor.colspan; col += 1) lockedColumns.add(col);
      }
      if (anchor.rowspan > 1) {
        for (let row = anchor.row; row < anchor.row + anchor.rowspan; row += 1) lockedRows.add(row);
      }
    }
    return { lockedColumns, lockedRows };
  }, [doc, tableId, chromeStamp]);
}

export { useTableRegions };
export type { TableRegionStands };
