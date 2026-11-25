/**
 * The table's merged regions over the renderer's chrome: the stands the chrome
 * must honour — no resize seam and no reorder handle on a region's interior,
 * and no handle to drag at all for a column / row the region spans (a reorder
 * through a region would shift its rectangle; the core rejects it, and the
 * chrome simply offers nothing).
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
  /** The column boundaries standing INSIDE a region (the seam index = the boundary's left column). */
  blockedSeams: ReadonlySet<number>;
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
    const blockedSeams = new Set<number>();
    const lockedColumns = new Set<number>();
    const lockedRows = new Set<number>();
    for (const anchor of grid?.rows.flat() ?? []) {
      if (anchor.colspan > 1) {
        for (let col = anchor.col + 1; col < anchor.col + anchor.colspan; col += 1) blockedSeams.add(col);
        for (let col = anchor.col; col < anchor.col + anchor.colspan; col += 1) lockedColumns.add(col);
      }
      if (anchor.rowspan > 1) {
        for (let row = anchor.row; row < anchor.row + anchor.rowspan; row += 1) lockedRows.add(row);
      }
    }
    return { blockedSeams, lockedColumns, lockedRows };
  }, [doc, tableId, chromeStamp]);
}

export { useTableRegions };
export type { TableRegionStands };
