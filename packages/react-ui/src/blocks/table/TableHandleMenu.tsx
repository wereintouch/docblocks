/** The row / column handle's chip + the portaled menu content (the
 * background palette with the conditional remove, the insert / move /
 * duplicate / clear / delete items). */
import { useStore } from "zustand";

import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../../EditorProvider";
import { Button } from "../../shared/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../shared/ui/DropdownMenu";
import { Ellipsis, EllipsisVertical } from "../../shared/ui/icons";
import { EMPTY_IDS } from "./models";
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
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <div
          data-slot={kind === "column" ? "docblocks/table-col-handle" : "docblocks/table-row-handle"}
          data-index={index}
          className={handleClasses(visible, dragging)}
          style={{
            left: left + dragDx,
            top: top + dragDy,
            ...(dragTransition !== undefined ? { transition: "left 120ms ease-out, top 120ms ease-out" } : {}),
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          {kind === "column" ? <Ellipsis className="size-3.5" /> : <EllipsisVertical className="size-3.5" />}
        </div>
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
              onClick={() => onColor(swatch)}
            />
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {color !== undefined && (
        <DropdownMenuItem data-slot="docblocks/table-remove-color" onSelect={() => onColor(null)}>
          Remove background
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={() => onAction("insert-after")}>
        {column ? "Insert right" : "Insert below"}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onAction("insert-before")}>
        {column ? "Insert left" : "Insert above"}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={atEnd} onSelect={() => onAction("move-next")}>
        {column ? "Move right" : "Move down"}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={atStart} onSelect={() => onAction("move-prev")}>
        {column ? "Move left" : "Move up"}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onAction("duplicate")}>Duplicate</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onAction("clear")}>Clear content</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onAction("remove")}>Delete</DropdownMenuItem>
    </>
  );
}

export { HandleMenu, HandleMenuItems };
