import { memo } from "react";

import type { BlockId, TableBlock as TableBlockType } from "docblocks-core";

import { useBlock } from "../hooks";
import { BlockGroups } from "./BlockView";
import { BlockContext, useBlockContextValue } from "./block-context";

const EMPTY_IDS: BlockId[] = [];

/**
 * A table: one <tr> per row block, one <td> per cell; each cell renders
 * its flat content sequence (a page context: the `indent` attr carries
 * the nesting) through the flat sequence renderer, so a paragraph cell is
 * editable via the text block path. The block context is provided at each
 * level (rows under the table, cells under the row, contents under the
 * cell). Rendering only: structure editing (adding or removing rows and
 * cells) is not a v1 feature.
 */
function TableBlock({ id, block }: { id: BlockId; block: TableBlockType }) {
  const rows = block.children ?? EMPTY_IDS;
  const contextValue = useBlockContextValue(id, rows);
  return (
    <table
      data-slot="docblocks/table"
      data-block-type="table"
      data-block-id={id}
      className="mx-0 my-(--docblocks-block-spacing) border-collapse"
    >
      <tbody>
        <BlockContext.Provider value={contextValue}>
          {rows.map((rowId) => (
            <TableRow key={rowId} id={rowId} />
          ))}
        </BlockContext.Provider>
      </tbody>
    </table>
  );
}

/** One row: the cell ids come from the row's own snapshot. */
const TableRow = memo(function TableRow({ id }: { id: BlockId }) {
  const row = useBlock(id);
  const cells = row !== undefined && row.type === "table-row" ? (row.children ?? EMPTY_IDS) : EMPTY_IDS;
  const contextValue = useBlockContextValue(id, cells);
  if (row === undefined || row.type !== "table-row") return null;
  return (
    <tr data-block-id={id}>
      <BlockContext.Provider value={contextValue}>
        {cells.map((cellId) => (
          <TableCell key={cellId} id={cellId} />
        ))}
      </BlockContext.Provider>
    </tr>
  );
});

/** One cell: its flat content sequence renders through the flat sequence renderer. */
const TableCell = memo(function TableCell({ id }: { id: BlockId }) {
  const cell = useBlock(id);
  const children = cell !== undefined && cell.type === "table-cell" ? (cell.children ?? EMPTY_IDS) : EMPTY_IDS;
  const contextValue = useBlockContextValue(id, children);
  if (cell === undefined || cell.type !== "table-cell") return null;
  return (
    <td
      data-slot="docblocks/table-cell"
      data-block-id={id}
      className="
        border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color)
        p-(--docblocks-table-cell-padding) align-top
      "
    >
      <BlockContext.Provider value={contextValue}>
        <BlockGroups ids={children} />
      </BlockContext.Provider>
    </td>
  );
});

export { TableBlock };
