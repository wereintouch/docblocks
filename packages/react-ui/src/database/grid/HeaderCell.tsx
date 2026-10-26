/** The grid's header cell (the column's name + the press menu + the
 * right-edge resize seam). */
import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../shared/ui/DropdownMenu";
import { Separator } from "../../shared/ui/Separator";
import { cn } from "../../shared/ui/cn";
import { Ellipsis } from "../../shared/ui/icons";
import type { BridgeColumn } from "../bridge";

interface HeaderCellProps {
  column: BridgeColumn;
  colIndex: number;
  first: boolean;
  resizing: boolean;
  dragDx: number;
  /** A stationary column of an in-flight drag (the parting shift's transition). */
  dragShifted: boolean;
  menuOpen: boolean;
  onMenuChange: (open: boolean) => void;
  onRename: (name: string) => void;
  /** The enum's options' edit (the form's edit mode's open — the enum's
   *  columns only; the absent stand stands no menu entry). */
  onEditOptions?: () => void;
  onHide: () => void;
  onShow: () => void;
  onDelete: () => void;
  hidden: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerCancel: () => void;
}
/** The header cell (the column's name; the press stands the menu, the
 *  press-drag stands the column drag). The right-edge seam resizes the
 *  column (the table block's seam idiom: the 6 px strip, the 50 px floor,
 *  the live preview, the one `updateBlock` on the release). The menu
 *  content: the editable name line (the rename commits on the blur / the
 *  Enter), the type line (read-only), and the show / hide / delete items. */
function HeaderCell({
  column,
  colIndex,
  first,
  resizing,
  dragDx,
  dragShifted,
  menuOpen,
  onMenuChange,
  onRename,
  onEditOptions,
  onHide,
  onShow,
  onDelete,
  hidden,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  onResizePointerCancel,
}: HeaderCellProps) {
  const [nameDraft, setNameDraft] = useState(column.name);
  const commitRename = () => {
    const trimmed = nameDraft.trim();
    if (trimmed !== "" && trimmed !== column.name) onRename(trimmed);
    setNameDraft(column.name);
  };
  return (
    <div
      data-slot="docblocks/database-header-cell"
      data-column-id={column.id}
      style={
        dragDx !== 0
          ? {
              transform: `translateX(${dragDx}px)`,
              position: "relative",
              zIndex: dragShifted ? undefined : 10,
              transition: dragShifted ? "transform 120ms ease-out" : undefined,
            }
          : undefined
      }
      className={cn(
        `
          relative flex min-w-0 cursor-grab items-center gap-1 border-b-(length:--docblocks-table-border-width)
          border-(--docblocks-table-border-color) bg-muted/40 px-(--docblocks-table-cell-padding) py-1 select-none
          active:cursor-grabbing
        `,
        !first && "border-l-(length:--docblocks-table-border-width)"
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <span className="min-w-0 truncate text-(length:--docblocks-font-size) font-(--docblocks-heading-font-weight)">
        {column.name}
      </span>
      <div className="ml-auto shrink-0">
        <DropdownMenu modal={false} open={menuOpen} onOpenChange={onMenuChange}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-slot="docblocks/database-column-menu"
              className="
                cursor-pointer rounded-(--docblocks-radius) p-0.5 text-(--docblocks-placeholder-color) outline-none
                hover:text-(--docblocks-text-color)
              "
            >
              <Ellipsis className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={4} className="flex w-52 flex-col gap-2 p-2">
            <div className="flex flex-col gap-1">
              <input
                data-slot="docblocks/database-rename-input"
                className="
                  w-full rounded-md border-0 bg-muted/60 px-2 py-1 text-sm text-foreground outline-none select-text
                  focus:bg-muted
                "
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onFocus={() => setNameDraft(column.name)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                  if (event.key === "Escape") {
                    setNameDraft(column.name);
                    onMenuChange(false);
                  }
                }}
              />
              <span data-slot="docblocks/database-column-type" className="px-1.5 text-xs text-muted-foreground">
                {column.type}
              </span>
            </div>
            <Separator />
            {onEditOptions !== undefined && (
              <DropdownMenuItem
                data-slot="docblocks/database-column-edit-options"
                onClick={() => {
                  onMenuChange(false);
                  onEditOptions();
                }}
              >
                Edit options
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={hidden ? onShow : onHide}>
              {hidden ? "Show column" : "Hide column"}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-destructive
              onClick={() => {
                onMenuChange(false);
                onDelete();
              }}
            >
              Delete column
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        data-slot="docblocks/database-col-resize"
        data-index={colIndex}
        className={cn(
          `absolute top-0 -right-1.5 z-10 h-full w-1.5 cursor-col-resize opacity-0 transition-opacity hover:opacity-100`,
          resizing && "opacity-100"
        )}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerCancel}
      >
        <div data-slot="docblocks/database-col-resize-line" className="h-full w-0.5 rounded bg-(--muted-foreground)" />
      </div>
    </div>
  );
}

export { HeaderCell };
