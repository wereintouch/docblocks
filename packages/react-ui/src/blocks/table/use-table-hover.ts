/**
 * The table's pointer hover: the grid coordinate of the cell under the
 * pointer (the handle zones read it — the row / column highlight and the
 * hover-revealed affordances). The coordinate comes from the grid resolver,
 * not the DOM: a merged cell stands one `<td>` over several columns, so
 * `cellIndex` would count the drawn cells instead of the grid's columns.
 */
import { useCallback, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { resolveTableGrid } from "docblocks-core";
import type { BlockId, Doc } from "docblocks-core";

interface UseTableHoverArgs {
  doc: Doc;
  tableId: BlockId;
}

function useTableHover({ doc, tableId }: UseTableHoverArgs) {
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);

  /** The hovered cell under the pointer (a pointer over the chrome keeps the current hover). */
  const onContentPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      const cell = target.closest<HTMLTableCellElement>("td[data-block-id]");
      if (cell === null) return;
      const row = cell.closest<HTMLTableRowElement>("tr[data-block-id]");
      if (row === null) return;
      const cellId = cell.dataset.blockId;
      const grid = cellId === undefined ? null : resolveTableGrid(doc.raw, tableId);
      const anchor =
        grid === null || cellId === undefined
          ? null
          : (grid.rows.flat().find((candidate) => candidate.id === cellId) ?? null);
      const next = anchor !== null ? { row: anchor.row, col: anchor.col } : { row: row.rowIndex, col: cell.cellIndex };
      setHover((prev) => (prev !== null && prev.row === next.row && prev.col === next.col ? prev : next));
    },
    [doc, tableId]
  );

  return { hover, onContentPointerMove, setHover };
}

export { useTableHover };
