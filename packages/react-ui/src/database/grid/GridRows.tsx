/**
 * The grid's data rows: the cell's map (the draft session's pin, the
 * selection's stand, the column drag's parting preview), the row's menu
 * (the move / the remove — the read-only's stand is the empty's track),
 * the load-more's continuation, and the empty's stand (the filter's
 * none-filtered's text). The cell commits stand the read-only's gate +
 * the rejection's no-rethrow (the cell's commit has no caller to handle
 * it).
 */
import { useTranslation } from "react-i18next";

import { Fragment, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { DatabaseFilterPayload } from "docblocks-core";

import { Button } from "../../shared/ui/Button";
import { cn } from "../../shared/ui/cn";
import type { BridgeColumn } from "../bridge";
import { useDatabaseTable } from "../use-database-table";
import type { DatabaseTableRow } from "../use-database-table/models";
import { DatabaseCell, RowMenuCell } from "./cells";
import { GRID_CHROME_FRAME } from "./constants";
import type { RefTableDataMap } from "./use-ref-tables";
import { refEntryKey } from "./use-ref-tables";
import { cellKeyOf } from "./utils";

/** The column drag's live preview (the hook's stand — the dragged
 *  column's dx + the drop's index + the press's width). */
interface GridColumnDragPreview {
  id: string;
  dx: number;
  toIndex: number | null;
  startWidth: number;
}

interface GridRowsProps {
  rows: DatabaseTableRow[];
  columns: BridgeColumn[];
  data: ReturnType<typeof useDatabaseTable>;
  selectedCells: Set<string>;
  editingCell: string | null;
  setEditingCell: (key: string | null) => void;
  onCellPointerDown: (
    rowId: string,
    columnId: string,
    rowIndex: number,
    colIndex: number
  ) => (event: ReactPointerEvent<HTMLDivElement>) => void;
  booleanPressRef: { current: { armed: boolean; toggledTs: number } };
  drag: GridColumnDragPreview | null;
  dragShiftOf: (index: number) => number;
  pendingRowId: string | null;
  refTableData: RefTableDataMap;
  filter?: DatabaseFilterPayload;
  readOnly?: boolean;
}

function GridRows({
  rows,
  columns,
  data,
  selectedCells,
  editingCell,
  setEditingCell,
  onCellPointerDown,
  booleanPressRef,
  drag,
  dragShiftOf,
  pendingRowId,
  refTableData,
  filter,
  readOnly = false,
}: GridRowsProps) {
  const { t } = useTranslation("database");
  const [rowMenu, setRowMenu] = useState<string | null>(null);

  const lastRowId = rows.length > 0 ? rows[rows.length - 1]!.rowId : null;

  const cellChange = (row: DatabaseTableRow, column: BridgeColumn) => (value: unknown, expectedRevision?: string) => {
    // Every cell commit crosses this gate, including immediate boolean toggles.
    if (readOnly) return;
    // The rejection's stand: the error stands the hook's state (the
    // rollback + the refetch apply over it) — the rethrow is the caller's
    // contract, not the grid's (the cell's commit has no caller to
    // handle it).
    void data.updateRow(row.rowId, { [column.id]: value }, expectedRevision).catch(() => undefined);
  };
  const cellEditStart = (cellKey: string) => () => {
    // The read-only stand (view / published): the edit's session's entry is
    // off (the double press stands no stand).
    if (readOnly) return;
    setEditingCell(cellKey);
  };
  const cellEditEnd = () => setEditingCell(null);
  const rowMoveUp = (row: DatabaseTableRow) => () => {
    const index = rows.indexOf(row);
    if (index > 0) void data.moveRow(row.rowId, rows[index - 1]!.rowId).catch(() => undefined);
  };
  const rowMoveDown = (row: DatabaseTableRow) => () => {
    const index = rows.indexOf(row);
    if (index < rows.length - 1)
      void data.moveRow(row.rowId, index + 2 < rows.length ? rows[index + 2]!.rowId : null).catch(() => undefined);
  };
  const rowRemove = (row: DatabaseTableRow) => () => void data.removeRow(row.rowId).catch(() => undefined);

  return (
    <>
      {rows.map((row, rowIndex) => (
        <Fragment key={row.rowId}>
          {columns.map((column, index) => {
            const key = cellKeyOf(row.rowId, column.id);
            // The row's live revision (the cell's draft session pins
            // it at the open — the mid-session's refetch re-baselines
            // it over the peer's commit).
            return (
              <DatabaseCell
                key={column.id}
                rowId={row.rowId}
                column={column}
                value={row.cells[column.id]}
                revision={data.revisionOf(row.rowId)}
                rowIndex={rowIndex}
                colIndex={index}
                first={index === 0}
                lastRow={row.rowId === lastRowId}
                filterPending={row.rowId === pendingRowId}
                dragDx={drag !== null && drag.id === column.id ? drag.dx : dragShiftOf(index)}
                dragShifted={drag !== null && drag.id !== column.id}
                selected={selectedCells.has(key)}
                singleSelected={selectedCells.has(key) && selectedCells.size === 1}
                editing={editingCell === key}
                onChange={cellChange(row, column)}
                onPointerDown={onCellPointerDown(row.rowId, column.id, rowIndex, index)}
                onEditStart={cellEditStart(key)}
                refTableData={
                  column.refTableId !== undefined
                    ? refTableData[refEntryKey({ tableId: column.refTableId, displayColumn: column.refDisplayColumn })]
                    : undefined
                }
                onEditEnd={cellEditEnd}
                booleanPress={booleanPressRef}
              />
            );
          })}
          {readOnly ? (
            // The read-only stand (view / published): the row's menu's
            // stand is off (the track stands the empty's stand).
            <div
              data-slot="docblocks/database-row-menu"
              data-filter-pending={row.rowId === pendingRowId ? "true" : undefined}
              className={cn(
                `
                  flex w-10 items-center justify-center border-l-(length:--docblocks-table-border-width)
                  border-(--docblocks-table-border-color)
                `,
                row.rowId !== lastRowId && "border-b-(length:--docblocks-table-border-width)",
                row.rowId === lastRowId && "rounded-br-(--docblocks-radius)"
              )}
            />
          ) : (
            <RowMenuCell
              row={row}
              rowMenu={rowMenu}
              setRowMenu={setRowMenu}
              canMoveUp={row.rowId !== pendingRowId && rows.indexOf(row) > 0}
              canMoveDown={
                row.rowId !== pendingRowId &&
                rows.indexOf(row) < rows.length - 1 &&
                rows[rows.indexOf(row) + 1]?.rowId !== pendingRowId
              }
              onMoveUp={rowMoveUp(row)}
              onMoveDown={rowMoveDown(row)}
              onRemove={rowRemove(row)}
              lastRow={row.rowId === lastRowId}
              filterPending={row.rowId === pendingRowId}
            />
          )}
        </Fragment>
      ))}

      {data.nextCursor !== null && (
        <div
          data-slot="docblocks/database-load-more-row"
          className="flex items-center justify-center"
          style={{ gridColumn: "1 / -1" }}
        >
          <Button
            data-slot="docblocks/database-load-more"
            variant="outline"
            size="sm"
            className={cn(
              GRID_CHROME_FRAME,
              `h-auto cursor-pointer px-2 py-1 text-(length:--docblocks-font-size) font-normal shadow-none select-none`,
              "text-(--docblocks-placeholder-color) hover:bg-transparent",
              "hover:text-(--docblocks-text-color) dark:hover:bg-transparent"
            )}
            onClick={() => void data.loadMore().catch(() => undefined)}
          >
            {t("rows.loadMore")}
          </Button>
        </div>
      )}

      {rows.length === 0 && (
        <div
          data-slot="docblocks/database-empty"
          className="
            px-(--docblocks-table-cell-padding) py-(--docblocks-block-spacing) text-(length:--docblocks-font-size)
            text-(--docblocks-placeholder-color) select-none
          "
        >
          {filter !== undefined ? t("rows.noneFiltered") : t("rows.none")}
        </div>
      )}
    </>
  );
}

export { GridRows };
export type { GridRowsProps };
