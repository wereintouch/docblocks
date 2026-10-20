import type { BlockId, DatabaseBlock as DatabaseBlockType } from "docblocks-core";

import { DatabaseGrid } from "../database/DatabaseGrid";
import { Badge } from "../shared/ui/Badge";
import { Card, CardContent } from "../shared/ui/Card";

/**
 * A database: the inline form stands the placeholder card (the column
 * names header line + a live row count). The external form (the
 * `tableId` reference, 2026-10-19) renders the live grid over the bridge
 * (`DatabaseGrid` — the schema + the rows + the live events; the rows
 * and the schema live in the consumer's relational table). The block is
 * not text-editable: no contenteditable, no gutter.
 */
function DatabaseBlock({ id, block }: { id: BlockId; block: DatabaseBlockType }) {
  const { columns, tableId } = block.attrs;
  if (tableId !== undefined) {
    return <DatabaseGrid id={id} block={block} />;
  }
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
          {columns !== undefined &&
            columns.map((column) => (
              <span key={column.id} data-slot="docblocks/database-column" data-column-type={column.type}>
                {column.name}
              </span>
            ))}
        </div>
        <Badge data-slot="docblocks/database-count" variant="secondary" className="mt-(--docblocks-block-spacing)">
          {rowCount} {rowCount === 1 ? "row" : "rows"}
        </Badge>
      </CardContent>
    </Card>
  );
}

export { DatabaseBlock };
