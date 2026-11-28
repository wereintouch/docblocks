/**
 * The grid's table: the column tracks (the header cells — the menu / the
 * rename / the options' / the hide / show / the delete, the drag's
 * session, the seam's resize), the add-column's chip (the type's menu +
 * the create form), and the data rows over the grid's shared pointer
 * model (the cell / column selection — the native text selection over the
 * drag is suppressed).
 */
import { useState } from "react";
import type { ClipboardEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import type { DatabaseFilterPayload } from "docblocks-core";

import { cn } from "../../shared/ui/cn";
import type { BridgeColumn } from "../bridge";
import { useDatabaseTable } from "../use-database-table";
import type { DatabaseTableRow } from "../use-database-table/models";
import { AddColumnCell } from "./AddColumnCell";
import { GridRows } from "./GridRows";
import { HeaderCell } from "./HeaderCell";
import { HeaderResizeHandle } from "./HeaderResizeHandle";
import { GRID_CHROME_FRAME } from "./constants";
import type { useColumnForm } from "./use-column-form";
import { useGridColumnDrag } from "./use-grid-column-drag";
import { useGridHeaderResize } from "./use-grid-header-resize";
import { useGridSeamResize } from "./use-grid-seam-resize";
import type { RefTableDataMap } from "./use-ref-tables";
import { useSingleLineHeaderHeight } from "./use-single-line-header-height";

interface GridTableProps {
  columns: BridgeColumn[];
  /** The full column set (the drag's order's stand includes hidden). */
  allColumns: BridgeColumn[];
  columnOrder?: string[];
  hiddenColumns?: string[];
  columnWidths?: number[];
  onViewChange: (patch: Record<string, unknown>) => void;
  data: ReturnType<typeof useDatabaseTable>;
  rows: DatabaseTableRow[];
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
  pendingRowId: string | null;
  refTableData: RefTableDataMap;
  filter?: DatabaseFilterPayload;
  readOnly?: boolean;
  /** The resolved header-row height (the block's attr over the table
   *  section's value); undefined = the auto height. */
  headerHeight?: number;
  /** The header resize's release commit (the block attr / the section
   *  value — the caller's write stand). */
  onHeaderHeightChange?: (height: number) => void;
  /** The header's double-click's reset commit (the default height's
   *  return — the block attr's removal / the section value's clear).
   *  Absent = no reset stand (the read-only's parity). */
  onHeaderHeightReset?: () => void;
  tableRef: { current: HTMLDivElement | null };
  onTableKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onTablePaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  onTableBlur: (event: React.FocusEvent<HTMLDivElement>) => void;
  /** The add-column form's session (the create / the edit's stand). */
  form: ReturnType<typeof useColumnForm>;
  OptionsEditor: React.ComponentType<{
    options: import("./models").EnumOptionDraft[];
    onChange: (next: import("./models").EnumOptionDraft[]) => void;
  }>;
}

function GridTable({
  columns,
  allColumns,
  columnOrder,
  hiddenColumns,
  columnWidths,
  onViewChange,
  data,
  rows,
  selectedCells,
  editingCell,
  setEditingCell,
  onCellPointerDown,
  booleanPressRef,
  pendingRowId,
  refTableData,
  filter,
  readOnly = false,
  headerHeight,
  onHeaderHeightChange,
  onHeaderHeightReset,
  tableRef,
  onTableKeyDown,
  onTablePaste,
  onTableBlur,
  form,
  OptionsEditor,
}: GridTableProps) {
  const [columnMenu, setColumnMenu] = useState<string | null>(null);

  const { resizePreview, onSeamPointerDown, onSeamPointerMove, onSeamPointerUp, onSeamPointerCancel } =
    useGridSeamResize({ columns, columnWidths, updateView: onViewChange });

  const { drag, onColumnPointerDown, onColumnPointerMove, onColumnPointerUp } = useGridColumnDrag({
    columns,
    allColumns,
    columnOrder,
    hiddenColumns,
    columnWidths,
    updateView: onViewChange,
    tableRef,
  });

  const commitHeaderHeight = onHeaderHeightChange ?? (() => undefined);
  const { headerPreview, onHeaderPointerDown, onHeaderPointerMove, onHeaderPointerUp, onHeaderPointerCancel } =
    useGridHeaderResize({ tableRef, headerHeight, onCommit: commitHeaderHeight });
  const headerRowHeight = headerPreview ?? headerHeight;
  // The stretch's stand: the name's wrap over the height's stand (the
  // single-line's auto height is the floor — no wrap over it). The
  // natural's stand is the live measurement's single-line's value
  // (the current's wrap's suppression over the read).
  const naturalHeaderHeight = useSingleLineHeaderHeight(tableRef);
  const headerWrap = headerRowHeight !== undefined && headerRowHeight > naturalHeaderHeight;
  // The double-click's reset (the default height's return): the editable's
  // stand only (the read-only's modes' write path stands off).
  const resetHeaderHeight = (): void => {
    onHeaderHeightReset?.();
  };

  // The parting preview: the stationary columns' shift (px) over the live
  // drop index (the dragged column's own cells stand the pointer's dx).
  const dragFrom = drag === null ? -1 : columns.findIndex((entry) => entry.id === drag.id);
  const dragShiftOf = (index: number): number => {
    if (drag === null || drag.toIndex === null || index === dragFrom) return 0;
    const to = drag.toIndex;
    const shift = index < dragFrom ? (index >= to ? 1 : 0) : index - 1 < to ? -1 : 0;
    return shift * drag.startWidth;
  };

  // The header's per-column handlers stand the column / the seam's index
  // over the grid's shared pointer handlers (the map's per-item stand).
  const columnMenuChange = (column: BridgeColumn) => (open: boolean) => setColumnMenu(open ? column.id : null);
  const columnRename = (column: BridgeColumn) => (renameName: string) =>
    void data.renameColumn(column.id, renameName).catch(() => undefined);
  const columnEditOptions = (column: BridgeColumn) =>
    column.refKind === "enum" && column.refTableId !== undefined ? () => form.openColumnFormEdit(column) : undefined;
  const columnHide = (column: BridgeColumn) => () => {
    if (columns.length <= 1) return;
    onViewChange({ hiddenColumns: [...(hiddenColumns ?? []), column.id] });
  };
  const columnShow = (column: BridgeColumn) => () =>
    onViewChange({ hiddenColumns: (hiddenColumns ?? []).filter((entryId) => entryId !== column.id) });
  const columnDelete = (column: BridgeColumn) => () => void data.deleteColumn(column.id).catch(() => undefined);
  const columnPointerDown = (column: BridgeColumn) => (event: Parameters<typeof onColumnPointerDown>[1]) => {
    // The read-only stand (view / published): the column's drag's session is
    // off (the order's write stands no write).
    if (readOnly) return;
    onColumnPointerDown(column, event);
  };
  const seamPointerDownAt = (seamIndex: number) => (event: Parameters<ReturnType<typeof onSeamPointerDown>>[0]) => {
    // The read-only stand (view / published): the seam's resize's session is
    // off (the width's write stands no write).
    if (readOnly) return;
    onSeamPointerDown(seamIndex)(event);
  };
  const columnPointerUp = (column: BridgeColumn) => (event: Parameters<typeof onColumnPointerUp>[1]) =>
    onColumnPointerUp(column, event);

  return (
    <div
      ref={tableRef}
      data-slot="docblocks/database-table"
      data-header-wrap={headerWrap ? "true" : undefined}
      tabIndex={0}
      // The grid's pointer model stands the cell / column selection —
      // the native text selection over the drag is suppressed (the
      // editable inputs stand the explicit `select-text`).
      className={cn(GRID_CHROME_FRAME, "grid w-full overflow-hidden outline-none select-none")}
      onKeyDown={onTableKeyDown}
      onPaste={onTablePaste}
      onBlur={onTableBlur}
      // The fixed row track (the standard row height): every row —
      // over any column type mix — stands the one height (the header
      // stands its own row: the auto height, or the resized / the
      // committed one; the enum's trigger fits the content box, so a new
      // enum column grows no row). The multi-line's editor stands the
      // portaled layer (no track's shift).
      style={{
        gridTemplateRows: headerRowHeight !== undefined ? `${headerRowHeight}px` : "auto",
        gridAutoRows: "var(--docblocks-database-row-height)",
        gridTemplateColumns: `${columns
          .map((_, index) => {
            // The session's locked width (every column — the flexible
            // ones' live shrink is kept off) over the committed / the
            // flexible track.
            const preview = resizePreview !== null ? resizePreview.widths[index] : undefined;
            const width = preview ?? columnWidths?.[index];
            return width !== undefined ? `${width}px` : "minmax(7rem, 1fr)";
          })
          .join(" ")} 2.5rem`,
      }}
    >
      {columns.map((column, index) => (
        <HeaderCell
          key={column.id}
          readOnly={readOnly}
          column={column}
          colIndex={index}
          first={index === 0}
          resizing={resizePreview !== null && resizePreview.col === index}
          dragDx={drag !== null && drag.id === column.id ? drag.dx : dragShiftOf(index)}
          dragShifted={drag !== null && drag.id !== column.id}
          menuOpen={columnMenu === column.id}
          // The double-click's reset (the default height's return) — the
          // editable's stand (the block's attr / the section's value's
          // write target's parity over the handle's render's stand).
          onDoubleClickReset={!readOnly && onHeaderHeightReset !== undefined ? resetHeaderHeight : undefined}
          // The read-only stand (view / published): the column's menu
          // stands locked off (the rename / the options' / the
          // hide / show / the delete's paths stand no write).
          onMenuChange={readOnly ? () => undefined : columnMenuChange(column)}
          onRename={columnRename(column)}
          onEditOptions={columnEditOptions(column)}
          onHide={columnHide(column)}
          onShow={columnShow(column)}
          onDelete={columnDelete(column)}
          hidden={(hiddenColumns ?? []).includes(column.id)}
          onPointerDown={columnPointerDown(column)}
          onResizePointerDown={seamPointerDownAt(index)}
          onResizePointerMove={onSeamPointerMove}
          onResizePointerUp={onSeamPointerUp}
          onResizePointerCancel={onSeamPointerCancel}
          onPointerMove={onColumnPointerMove}
          onPointerUp={columnPointerUp(column)}
        />
      ))}
      {/* The handle stands only where a write target exists (the block's
          attr / the section's settings) — the read-only modes' height
          still applies. */}
      {!readOnly && onHeaderHeightChange !== undefined && (
        <HeaderResizeHandle
          resizing={headerPreview !== null}
          onDoubleClickReset={!readOnly && onHeaderHeightReset !== undefined ? resetHeaderHeight : undefined}
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerCancel}
        />
      )}
      <AddColumnCell gridColumn={columns.length + 1} readOnly={readOnly} form={form} OptionsEditor={OptionsEditor} />
      <GridRows
        rows={rows}
        columns={columns}
        data={data}
        selectedCells={selectedCells}
        editingCell={editingCell}
        setEditingCell={setEditingCell}
        onCellPointerDown={onCellPointerDown}
        booleanPressRef={booleanPressRef}
        drag={drag}
        dragShiftOf={dragShiftOf}
        pendingRowId={pendingRowId}
        refTableData={refTableData}
        filter={filter}
        readOnly={readOnly}
      />
    </div>
  );
}

export { GridTable };
export type { GridTableProps };
