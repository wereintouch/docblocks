/** The grid's row-menu track (the trailing grid column: the move / the
 *  delete row affordances). */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../shared/ui/DropdownMenu";
import { cn } from "../../../shared/ui/cn";
import { Ellipsis } from "../../../shared/ui/icons";
import type { DatabaseTableRow } from "../../use-database-table";

interface RowMenuCellProps {
  row: DatabaseTableRow;
  rowMenu: string | null;
  setRowMenu: (value: string | null) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  lastRow: boolean;
}
/** The row's menu track (the trailing grid column). */
function RowMenuCell({
  row,
  rowMenu,
  setRowMenu,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
  lastRow,
}: RowMenuCellProps) {
  return (
    <div
      data-slot="docblocks/database-row-menu"
      className={cn(
        `
          flex w-10 items-center justify-center border-l-(length:--docblocks-table-border-width)
          border-(--docblocks-table-border-color)
        `,
        !lastRow && "border-b-(length:--docblocks-table-border-width)"
      )}
    >
      <DropdownMenu
        modal={false}
        open={rowMenu === row.rowId}
        onOpenChange={(open) => setRowMenu(open ? row.rowId : null)}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-slot="docblocks/database-row-menu-trigger"
            className="
              cursor-pointer rounded-(--docblocks-radius) p-0.5 text-(--docblocks-placeholder-color) outline-none
              hover:text-(--docblocks-text-color)
            "
          >
            <Ellipsis className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-32">
          <DropdownMenuItem disabled={!canMoveUp} onClick={onMoveUp}>
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canMoveDown} onClick={onMoveDown}>
            Move down
          </DropdownMenuItem>
          <DropdownMenuItem data-destructive onClick={onRemove}>
            Delete row
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export { RowMenuCell };
