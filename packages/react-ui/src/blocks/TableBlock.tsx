import { memo } from "react";

import type { BlockId, TableBlock as TableBlockType } from "docblocks-core";

import { useBlock } from "../hooks";
import { BlockView } from "./BlockView";
import { BlockContext, useBlockContextValue } from "./block-context";

const EMPTY_IDS: BlockId[] = [];

/**
 * A table: one <tr> per row block, one <td> per cell; each cell renders
 * its leaf children recursively through BlockView, so a paragraph cell is
 * editable via the text block path. The block context is provided at each
 * level (rows under the table, cells under the row, leaves under the
 * cell). Rendering only: structure editing (adding or removing rows and
 * cells) is not a v1 feature.
 */
function TableBlock({ id, block }: { id: BlockId; block: TableBlockType }) {
  const rows = block.children ?? EMPTY_IDS;
  const contextValue = useBlockContextValue(id, rows);
  return (
    <table data-slot="docblocks/table" data-block-type="table" data-block-id={id}>
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

/** One cell: its leaf children render through BlockView. */
const TableCell = memo(function TableCell({ id }: { id: BlockId }) {
  const cell = useBlock(id);
  const children = cell !== undefined && cell.type === "table-cell" ? (cell.children ?? EMPTY_IDS) : EMPTY_IDS;
  const contextValue = useBlockContextValue(id, children);
  if (cell === undefined || cell.type !== "table-cell") return null;
  return (
    <td data-slot="docblocks/table-cell" data-block-id={id}>
      <BlockContext.Provider value={contextValue}>
        {children.map((childId) => (
          <BlockView key={childId} id={childId} />
        ))}
      </BlockContext.Provider>
    </td>
  );
});

export { TableBlock };
