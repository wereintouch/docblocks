/**
 * The grid's table: the column tracks (the header cells — the menu / the
 * rename / the options' / the hide / show / the delete, the drag's
 * session, the seam's resize), the add-column's chip (the type's menu +
 * the create form), and the data rows over the grid's shared pointer
 * model (the cell / column selection — the native text selection over the
 * drag is suppressed).
 */
import { useTranslation } from "react-i18next";

import { useState } from "react";
import type { ClipboardEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import type { DatabaseFilterPayload } from "docblocks-core";

import { Button } from "../../shared/ui/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../shared/ui/DropdownMenu";
import { cn } from "../../shared/ui/cn";
import { Plus } from "../../shared/ui/icons";
import type { BridgeColumn } from "../bridge";
import { useDatabaseTable } from "../use-database-table";
import type { DatabaseTableRow } from "../use-database-table/models";
import { AddColumnForm } from "./AddColumnForm";
import { GridRows } from "./GridRows";
import { HeaderCell } from "./HeaderCell";
import { columnTypeIcon } from "./column-type-icon";
import { ADD_COLUMN_TYPES, GRID_CHROME_FRAME } from "./constants";
import type { useColumnForm } from "./use-column-form";
import { useGridColumnDrag } from "./use-grid-column-drag";
import { useGridSeamResize } from "./use-grid-seam-resize";
import type { RefTableDataMap } from "./use-ref-tables";

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
  tableRef,
  onTableKeyDown,
  onTablePaste,
  onTableBlur,
  form,
  OptionsEditor,
}: GridTableProps) {
  const { t } = useTranslation("database");
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
      tabIndex={0}
      // The grid's pointer model stands the cell / column selection —
      // the native text selection over the drag is suppressed (the
      // editable inputs stand the explicit `select-text`).
      className="grid w-full outline-none select-none"
      onKeyDown={onTableKeyDown}
      onPaste={onTablePaste}
      onBlur={onTableBlur}
      // The fixed row track (the standard row height): every row —
      // over any column type mix — stands the one height (the header
      // stands its own auto row; the enum's trigger fits the content
      // box, so a new enum column grows no row). The multi-line's
      // editor stands the portaled layer (no track's shift).
      style={{
        gridTemplateRows: "auto",
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
      <div
        data-slot="docblocks/database-add-column"
        className="
          relative flex items-center justify-center border-b-(length:--docblocks-table-border-width)
          border-(--docblocks-table-border-color)
        "
      >
        {!readOnly && (
          <DropdownMenu modal={false} open={form.addingColumn} onOpenChange={form.setAddingColumn}>
            <DropdownMenuTrigger asChild>
              <Button
                data-slot="docblocks/database-add-column-trigger"
                variant="ghost"
                size="icon"
                className={cn(
                  GRID_CHROME_FRAME,
                  "size-6 cursor-pointer p-1 text-(--docblocks-placeholder-color) hover:bg-transparent",
                  "hover:text-(--docblocks-text-color) dark:hover:bg-transparent"
                )}
              >
                <Plus className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-32">
              {ADD_COLUMN_TYPES.map((entry) => {
                const EntryIcon = columnTypeIcon(entry.type, entry.refKind, entry.refMany);
                return (
                  <DropdownMenuItem
                    key={entry.key}
                    data-column-entry={entry.key}
                    onClick={() => form.openCreateForm(entry)}
                  >
                    <EntryIcon className="size-4 shrink-0 text-muted-foreground" />
                    {t(entry.labelKey)}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <AddColumnForm
          open={form.columnFormOpen}
          onOpenChange={form.onColumnFormOpenChange}
          form={form.columnForm}
          formNumber={form.columnFormNumber}
          formRef={form.columnFormRef}
          bridgeTables={form.bridgeTables}
          OptionsEditor={OptionsEditor}
          onCommit={form.commitColumnForm}
          onNameChange={form.onColumnNameChange}
          onDecimalsChange={form.onColumnDecimalsChange}
          onThousandsChange={form.onColumnThousandsChange}
          onPrefixChange={form.onColumnPrefixChange}
          onSuffixChange={form.onColumnSuffixChange}
          onAllowNegativeChange={form.onColumnAllowNegativeChange}
          onEnumOptionsChange={form.onColumnEnumOptionsChange}
          onRefPickChange={form.onColumnRefPickChange}
          onNewTableNameChange={form.onColumnNewTableNameChange}
        />
      </div>
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
