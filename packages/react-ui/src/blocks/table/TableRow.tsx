/** The table's row renderer: the cell ids come from the row's own
 * snapshot; the row / column drag transforms apply over the row's cells
 * (the `<tr>` is not a CSS transformable element — the row's drag's dy is
 * the per-cell transform's part). */
import { memo } from "react";

import type { BlockId } from "docblocks-core";

import { useBlock } from "../../hooks";
import { BlockContext, useBlockContextValue } from "../../shared/providers/block-context";
import { TableCell } from "./TableCell";
import { EMPTY_IDS } from "./constants";

/** One row: the cell ids come from the row's own snapshot. */
const TableRow = memo(function TableRow({
  id,
  rowTransform,
  columnTransforms,
  dimmed,
}: {
  id: BlockId;
  rowTransform: { dy: number; shifted: boolean };
  columnTransforms: Array<{ dx: number; shifted: boolean }>;
  dimmed: boolean;
}) {
  const row = useBlock(id);
  const cells = row !== undefined && row.type === "table-row" ? (row.children ?? EMPTY_IDS) : EMPTY_IDS;
  const contextValue = useBlockContextValue(id, cells, "table-row");
  if (row === undefined || row.type !== "table-row") return null;
  return (
    <tr data-block-id={id} style={dimmed ? { opacity: 0.4 } : undefined}>
      <BlockContext.Provider value={contextValue}>
        {cells.map((cellId, cellIndex) => (
          <TableCell
            key={cellId}
            id={cellId}
            dragX={columnTransforms[cellIndex]?.dx ?? 0}
            dragShifted={columnTransforms[cellIndex]?.shifted ?? false}
            rowDy={rowTransform.dy}
            rowShifted={rowTransform.shifted}
          />
        ))}
      </BlockContext.Provider>
    </tr>
  );
});

export { TableRow };
