/**
 * The table's merged regions over the renderer: the interior column
 * boundaries of a region (the seam there has no resize to offer, and its
 * pointer band would intercept presses over the region — the region's edges
 * are the resizable seams).
 */
import { useMemo } from "react";
import { useStore } from "zustand";

import { resolveTableGrid } from "docblocks-core";
import type { BlockId, Doc } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";

interface UseBlockedSeamsArgs {
  doc: Doc;
  tableId: BlockId;
}

/**
 * The column indices (the seam's left-edge column) standing strictly inside
 * a region. The chrome stamp re-reads the grid over any structural change: a
 * merge moves the cells' attrs and the rows' children, not the table's own
 * block, so the table's snapshot alone would not re-render this.
 */
function useBlockedSeams({ doc, tableId }: UseBlockedSeamsArgs): ReadonlySet<number> {
  const { store } = useEditorContext();
  const chromeStamp = useStore(store, (state) => state.chromeStamp);
  return useMemo(() => {
    const grid = resolveTableGrid(doc.raw, tableId);
    const blocked = new Set<number>();
    for (const anchor of grid?.rows.flat() ?? []) {
      for (let col = anchor.col + 1; col < anchor.col + anchor.colspan; col += 1) blocked.add(col);
    }
    return blocked;
  }, [doc, tableId, chromeStamp]);
}

export { useBlockedSeams };
