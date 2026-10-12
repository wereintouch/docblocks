import type { BlockId, DatabaseBlock as DatabaseBlockType } from "docblocks-core";

/**
 * A database (v1): the placeholder card — the column names header line
 * plus a live row count. The table UI (the virtualized grid, the cell
 * editors) is the consumer's level: the consumer builds it on the public
 * API (the row commands + the block subscription); this renderer carries
 * no contenteditable and no gutter (the block is not text-editable). The
 * row count is live: the block snapshot updates on row changes, and the
 * store re-renders the card.
 */
function DatabaseBlock({ id, block }: { id: BlockId; block: DatabaseBlockType }) {
  const { columns } = block.attrs;
  const rowCount = block.rowOrder.length;
  return (
    <div data-slot="docblocks/block" data-block-type="database" data-block-id={id}>
      <div data-slot="docblocks/database">
        <div data-slot="docblocks/database-header">
          {columns.map((column) => (
            <span key={column.id} data-slot="docblocks/database-column" data-column-type={column.type}>
              {column.name}
            </span>
          ))}
        </div>
        <div data-slot="docblocks/database-count">
          {rowCount} {rowCount === 1 ? "row" : "rows"}
        </div>
      </div>
    </div>
  );
}

export { DatabaseBlock };
