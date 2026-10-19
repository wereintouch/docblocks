import type { BlockId, DatabaseBlock as DatabaseBlockType } from "docblocks-core";

import { Badge } from "../shared/ui/Badge";
import { Card, CardContent } from "../shared/ui/Card";

/**
 * A database: the placeholder card. The inline form stands the column
 * names header line plus a live row count. The external form (the
 * `tableId` reference, 2026-10-19) stands the reference marker — the rows
 * and the schema live in the consumer's relational table, and the bridge
 * UI (the `DatabaseBridge` prop) renders the live table on top of the
 * same block. The table UI (the virtualized grid, the cell editors) is
 * the consumer's level in both forms; this renderer carries no
 * contenteditable and no gutter (the block is not text-editable).
 */
function DatabaseBlock({ id, block }: { id: BlockId; block: DatabaseBlockType }) {
  const { columns, tableId } = block.attrs;
  const rowCount = block.rowOrder.length;
  return (
    <Card
      data-slot="docblocks/block"
      data-block-type="database"
      data-block-id={id}
      className="
        my-(--docblocks-block-spacing) rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
        border-(--docblocks-table-border-color) outline-none
      "
    >
      <CardContent data-slot="docblocks/database">
        <div
          data-slot="docblocks/database-header"
          className="flex flex-wrap gap-(--docblocks-block-spacing) font-(--docblocks-heading-font-weight)"
        >
          {columns !== undefined
            ? columns.map((column) => (
                <span key={column.id} data-slot="docblocks/database-column" data-column-type={column.type}>
                  {column.name}
                </span>
              ))
            : tableId !== undefined && (
                <span data-slot="docblocks/database-external" data-table-id={tableId}>
                  External table
                </span>
              )}
        </div>
        <Badge data-slot="docblocks/database-count" variant="secondary" className="mt-(--docblocks-block-spacing)">
          {rowCount} {rowCount === 1 ? "row" : "rows"}
        </Badge>
      </CardContent>
    </Card>
  );
}

export { DatabaseBlock };
