import { memo } from "react";

import type { BlockId, TableBlock as TableBlockType } from "docblocks-core";

import { useBlock } from "../hooks";
import { BlockView } from "./BlockView";

/**
 * A table: one <tr> per row block, one <td> per cell; each cell renders
 * its leaf children recursively through BlockView, so a paragraph cell is
 * editable via the text block path. Rendering only: structure editing
 * (adding or removing rows and cells) is not a v1 feature.
 */
function TableBlock({ id, block }: { id: BlockId; block: TableBlockType }) {
  const rows = block.children ?? [];
  return (
    <table data-slot="docblocks/table" data-block-type="table" data-block-id={id}>
      <tbody>
        {rows.map((rowId) => (
          <TableRow key={rowId} id={rowId} />
        ))}
      </tbody>
    </table>
  );
}

/** One row: the cell ids come from the row's own snapshot. */
const TableRow = memo(function TableRow({ id }: { id: BlockId }) {
  const row = useBlock(id);
  if (row === undefined || row.type !== "table-row") return null;
  const cells = row.children ?? [];
  return (
    <tr data-block-id={id}>
      {cells.map((cellId) => (
        <TableCell key={cellId} id={cellId} />
      ))}
    </tr>
  );
});

/** One cell: its leaf children render through BlockView. */
const TableCell = memo(function TableCell({ id }: { id: BlockId }) {
  const cell = useBlock(id);
  if (cell === undefined || cell.type !== "table-cell") return null;
  const children = cell.children ?? [];
  return (
    <td data-slot="docblocks/table-cell" data-block-id={id}>
      {children.map((childId) => (
        <BlockView key={childId} id={childId} />
      ))}
    </td>
  );
});

export { TableBlock };
