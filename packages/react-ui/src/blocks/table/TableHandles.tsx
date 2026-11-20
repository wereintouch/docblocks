/** The table's handle layers: the column handles (above the columns) and
 * the row handles (left of the rows) — the chips + the portaled menu
 * content, the drag preview's transforms (the dragged chip's live
 * translation, the stationary chips' parting shift). */
import type { PointerEvent as ReactPointerEvent } from "react";

import type { BlockId } from "docblocks-core";

import { HandleMenu, HandleMenuItems } from "./HandleMenu";
import { HANDLE_SIZE, HANDLE_ZONE } from "./constants";
import type { HandleAction, HandleKind, TableDragPreview } from "./models";
import { columnDragTransformOf, isTablePreview, rowDragTransformOf } from "./table-drag-transforms";

interface TableHandlesProps {
  tableId: BlockId;
  widths: number[];
  rows: string[];
  rowMetrics: { top: number; height: number }[];
  hover: { row: number; col: number } | null;
  menu: { kind: HandleKind; index: number } | null;
  preview: TableDragPreview | null;
  columnCenters: number[];
  onHandlePointerDown: (kind: HandleKind, index: number) => (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onHandlePointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onHandlePointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onHandlePointerCancel: () => void;
  openHandleMenu: (kind: HandleKind) => (index: number) => () => void;
  onMenuOpenChange: (open: boolean) => void;
  onColumnHandleAction: (index: number) => (action: HandleAction) => void;
  onRowHandleAction: (index: number) => (action: HandleAction) => void;
  onColumnHandleColor: (index: number) => (color: string | null) => void;
  onRowHandleColor: (index: number) => (color: string | null) => void;
  palette: readonly string[];
}

function TableHandles({
  tableId,
  widths,
  rows,
  rowMetrics,
  hover,
  menu,
  preview,
  columnCenters,
  onHandlePointerDown,
  onHandlePointerMove,
  onHandlePointerUp,
  onHandlePointerCancel,
  openHandleMenu,
  onMenuOpenChange,
  onColumnHandleAction,
  onRowHandleAction,
  onColumnHandleColor,
  onRowHandleColor,
  palette,
}: TableHandlesProps) {
  return (
    <>
      {widths.map((_, index) => (
        <HandleMenu
          key={`col-${index}`}
          kind="column"
          index={index}
          visible={
            isTablePreview(preview, "column", index) ||
            hover?.col === index ||
            (menu !== null && menu.kind === "column" && menu.index === index)
          }
          left={columnCenters[index]! - HANDLE_SIZE / 2}
          top={0}
          open={menu !== null && menu.kind === "column" && menu.index === index}
          onOpenChange={onMenuOpenChange}
          dragging={isTablePreview(preview, "column", index)}
          dragDx={columnDragTransformOf(preview, index).dx}
          dragTransition={columnDragTransformOf(preview, index).shifted}
          dragDy={0}
          onPointerDown={onHandlePointerDown("column", index)}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerCancel}
          onOpen={openHandleMenu("column")(index)}
        >
          <HandleMenuItems
            tableId={tableId}
            kind="column"
            index={index}
            palette={palette}
            atStart={index === 0}
            atEnd={index === widths.length - 1}
            onAction={onColumnHandleAction(index)}
            onColor={onColumnHandleColor(index)}
          />
        </HandleMenu>
      ))}
      {rows.map((rowId, rowIndex) => (
        <HandleMenu
          key={`row-${rowId}`}
          kind="row"
          index={rowIndex}
          visible={
            isTablePreview(preview, "row", rowIndex) ||
            hover?.row === rowIndex ||
            (menu !== null && menu.kind === "row" && menu.index === rowIndex)
          }
          left={0}
          top={
            HANDLE_ZONE + (rowMetrics[rowIndex]?.top ?? 0) + (rowMetrics[rowIndex]?.height ?? 0) / 2 - HANDLE_SIZE / 2
          }
          open={menu !== null && menu.kind === "row" && menu.index === rowIndex}
          onOpenChange={onMenuOpenChange}
          dragging={isTablePreview(preview, "row", rowIndex)}
          dragDx={0}
          dragDy={rowDragTransformOf(preview, rowIndex).dy}
          dragTransition={rowDragTransformOf(preview, rowIndex).shifted}
          onPointerDown={onHandlePointerDown("row", rowIndex)}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerCancel}
          onOpen={openHandleMenu("row")(rowIndex)}
        >
          <HandleMenuItems
            tableId={tableId}
            kind="row"
            index={rowIndex}
            palette={palette}
            atStart={rowIndex === 0}
            atEnd={rowIndex === rows.length - 1}
            onAction={onRowHandleAction(rowIndex)}
            onColor={onRowHandleColor(rowIndex)}
          />
        </HandleMenu>
      ))}
    </>
  );
}

export { TableHandles };
export type { TableHandlesProps };
