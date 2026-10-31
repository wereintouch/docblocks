/** The row / column handle's chip + the portaled menu content (the
 * background palette with the conditional remove, the insert / move /
 * duplicate / clear / delete items). */
import { useStore } from "zustand";

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, PointerEvent as ReactPointerEvent } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";
import { Button, cn } from "../../shared/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../shared/ui/DropdownMenu";
import { resolveColorToHex } from "../../shared/ui/color-utils";
import { Ellipsis, EllipsisVertical } from "../../shared/ui/icons";
import { EMPTY_IDS, HANDLE_DRAG_TRANSITION } from "./constants";
import type { HandleAction, HandleKind } from "./models";
import { handleClasses } from "./utils";

/**
 * One handle: the chip (the pointer-session element + the menu trigger)
 * and the portaled menu content. The chip stays mounted (and visible)
 * while the menu is open — the trigger anchors the content — even after
 * the hover left the table.
 */
function HandleMenu({
  kind,
  index,
  visible,
  left,
  top,
  open,
  onOpenChange,
  dragging,
  dragDx,
  dragDy,
  dragTransition,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onOpen,
  children,
}: {
  kind: HandleKind;
  index: number;
  visible: boolean;
  left: number;
  top: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dragging: boolean;
  dragDx: number;
  dragDy: number;
  /** A stationary chip of an in-flight drag (the parting shift's transition). */
  dragTransition?: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
  /** The keyboard's open (the Enter / Space on the focused handle): the
   * controlled menu's state stand — the pointer's open stands the drag
   * hook's release. */
  onOpen: () => void;
  children: ReactNode;
}) {
  // The keyboard's open: the controlled state stand (Radix's trigger's
  // toggle is a no-op against the controlled open — the pointer's open
  // stands the drag hook's release, so the press itself opens nothing).
  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") onOpen();
  };
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          data-slot={kind === "column" ? "docblocks/table-col-handle" : "docblocks/table-row-handle"}
          data-index={index}
          aria-label={kind === "column" ? `Column ${index + 1} options` : `Row ${index + 1} options`}
          className={cn(handleClasses(visible, dragging), "p-0")}
          style={{
            left: left + dragDx,
            top: top + dragDy,
            ...(dragTransition !== undefined ? { transition: HANDLE_DRAG_TRANSITION } : {}),
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onKeyDown={onTriggerKeyDown}
        >
          {kind === "column" ? <Ellipsis className="size-3.5" /> : <EllipsisVertical className="size-3.5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-slot={kind === "column" ? "docblocks/table-col-menu" : "docblocks/table-row-menu"}
        aria-label={kind === "column" ? "Column options" : "Row options"}
        sideOffset={6}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
/** The handle's menu items (in the fixed order: the background palette with
 * the conditional remove, the insert / move / duplicate / clear / delete
 * items; the edge moves are disabled). The background
 * color is read from the store (a primitive selector: the menu re-renders
 * when the row/column's cells gain or lose the color — a cell color change
 * does not touch the table block, so the block's own subscription does not
 * fire). */
function HandleMenuItems({
  tableId,
  kind,
  index,
  palette,
  atStart,
  atEnd,
  onAction,
  onColor,
}: {
  tableId: BlockId;
  kind: HandleKind;
  index: number;
  palette: readonly string[];
  atStart: boolean;
  atEnd: boolean;
  onAction: (action: HandleAction) => void;
  onColor: (color: string | null) => void;
}) {
  const { store } = useEditorContext();
  // The color is stored in the row/column's cell attrs (not the table or the
  // row block): the row scans its own cells, the column scans the column's
  // cell across the rows.
  const color = useStore(store, (state) => {
    const table = state.blocks[tableId];
    if (table === undefined || table.type !== "table") return undefined;
    const rowIds = table.children ?? EMPTY_IDS;
    if (kind === "row") {
      const rowId = rowIds[index];
      const row = rowId === undefined ? undefined : state.blocks[rowId];
      if (row === undefined || row.type !== "table-row") return undefined;
      const rowCells = row.children ?? EMPTY_IDS;
      for (const cellId of rowCells) {
        const cell = state.blocks[cellId];
        if (cell !== undefined && cell.type === "table-cell" && cell.attrs?.rowColor !== undefined) {
          return cell.attrs.rowColor;
        }
      }
      return undefined;
    }
    for (const rowId of rowIds) {
      const row = state.blocks[rowId];
      if (row === undefined || row.type !== "table-row") continue;
      const cells = row.children ?? EMPTY_IDS;
      const cellId = cells[index];
      const cell = cellId === undefined ? undefined : state.blocks[cellId];
      if (cell !== undefined && cell.type === "table-cell" && cell.attrs?.columnColor !== undefined) {
        return cell.attrs.columnColor;
      }
    }
    return undefined;
  });
  const selectInsertAfter = () => onAction("insert-after");
  const selectInsertBefore = () => onAction("insert-before");
  const selectMoveNext = () => onAction("move-next");
  const selectMovePrev = () => onAction("move-prev");
  const selectDuplicate = () => onAction("duplicate");
  const selectClear = () => onAction("clear");
  const selectRemove = () => onAction("remove");
  const clearColor = () => onColor(null);
  // The palette entry is a theme token (or a consumer hex); the cell attr
  // holds a hex, so the press resolves it first.
  const selectSwatch = (swatch: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
    const hex = resolveColorToHex(swatch, event.currentTarget);
    if (hex !== null) onColor(hex);
  };

  const column = kind === "column";
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <span
            className="size-3.5 shrink-0 rounded-sm border border-border"
            style={{ background: color ?? "transparent" }}
          />
          Background
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="grid w-max grid-cols-3 gap-1 p-2">
          {palette.map((swatch) => (
            <Button
              key={swatch}
              type="button"
              variant="outline"
              size="icon"
              data-slot="docblocks/table-swatch"
              data-color={swatch}
              aria-label={`Background ${swatch}`}
              title={swatch}
              className="size-6"
              style={{ background: swatch }}
              onClick={selectSwatch(swatch)}
            />
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {color !== undefined && (
        <DropdownMenuItem data-slot="docblocks/table-remove-color" onSelect={clearColor}>
          Remove background
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={selectInsertAfter}>{column ? "Insert right" : "Insert below"}</DropdownMenuItem>
      <DropdownMenuItem onSelect={selectInsertBefore}>{column ? "Insert left" : "Insert above"}</DropdownMenuItem>
      <DropdownMenuItem disabled={atEnd} onSelect={selectMoveNext}>
        {column ? "Move right" : "Move down"}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={atStart} onSelect={selectMovePrev}>
        {column ? "Move left" : "Move up"}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={selectDuplicate}>Duplicate</DropdownMenuItem>
      <DropdownMenuItem onSelect={selectClear}>Clear content</DropdownMenuItem>
      <DropdownMenuItem onSelect={selectRemove}>Delete</DropdownMenuItem>
    </>
  );
}

export { HandleMenu, HandleMenuItems };
