/** The grid's body: the toolbar (the display name, the count, the
 * undo/redo, the filter popover), the column tracks (the header cells,
 * the add-column chip + the create form (the name input + the
 * type-specific attributes)), the data rows and the cell selection / the
 * column drag / the column resize sessions. The sessions' stands: the
 * form's state over `use-column-form` (+ the create / edit commits), the
 * toolbar over `GridToolbar`, the table over `GridTable` (+ `GridRows`),
 * the pending row's lifecycle over `use-grid-pending-row`, the state's
 * surfaces over `GridStateCards`. */
import { useMemo, useRef } from "react";

import type { BlockId, DatabaseFilterPayload } from "docblocks-core";

import { Card, CardContent } from "../../shared/ui/Card";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import type { DatabaseBridge } from "../bridge";
import { useDatabaseTable } from "../use-database-table";
import { DatabaseResizeHandle } from "./DatabaseResizeHandle";
import { EnumOptionsEditor } from "./EnumOptionsEditor";
import { GridEmptyState } from "./GridEmptyState";
import { GridBrokenCard, GridLoadingCard } from "./GridStateCards";
import { GridTable } from "./GridTable";
import { GridToolbar } from "./GridToolbar";
import { resolveDatabaseHeaderHeight } from "./header-height";
import { useColumnForm } from "./use-column-form";
import { useDatabaseBlockHeight } from "./use-database-block-height";
import { useEnumOptionsMotion } from "./use-enum-options-motion";
import { useGridCellInteraction } from "./use-grid-cell-interaction";
import { useGridPendingRow } from "./use-grid-pending-row";
import { refEntryKey, useRefTables } from "./use-ref-tables";
import type { RefTableEntry } from "./use-ref-tables";
import { visibleColumns } from "./utils";

interface GridBodyProps {
  /** The block id's structural hook (the data attribute's stand — the
   *  standalone's stand is absent, the data attribute stands off). */
  blockId?: BlockId;
  bridge: DatabaseBridge;
  tableId: string;
  filter?: DatabaseFilterPayload;
  columnOrder?: string[];
  hiddenColumns?: string[];
  columnWidths?: number[];
  /** The document block's explicit total height (px); absent = auto. */
  height?: number;
  /** The block's own header-row height (px — the document-level stand). */
  headerHeight?: number;
  /** The table section's header-row height (the consumer's per-table
   *  value): the block's own attr wins over it. */
  sectionHeaderHeight?: number;
  /** The consumer's authoritative total-row read; absent = loaded rows. */
  getRowCount?: (tableId: string) => number | undefined;
  /** The document block height's release commit. */
  onHeightChange?: (height: number) => void;
  /** The header resize's release commit (the caller's write stand: the
   *  block's attr over the document, the section's value over its own
   *  grid). */
  onHeaderHeightChange?: (height: number) => void;
  /** The header's double-click's reset commit (the default height's
   *  return — the block attr's removal / the section value's clear;
   *  absent = no reset stand). */
  onHeaderHeightReset?: () => void;
  /** The view-attrs' write stand (the block's stand: one `updateBlock` —
   *  the CRDT data, the undo step, the wire update; the standalone's
   *  stand: the internal state's merge + the consumer's `onViewChange`
   *  persistence hook). */
  onViewChange: (patch: Record<string, unknown>) => void;
  /** The current column order's read at call time (the async tail's stand
   *  — the render-time `columnOrder` prop stands stale over the await).
   *  The absent order stands the bridge's schema order (the attr's no-op). */
  readColumnOrder: () => string[] | undefined;
  /** The read-only stand (the view / published's modes): the grid's data stands rendered, every editing's path (the cells' selection / edit, the rows / columns' operations, the view's attrs, the bridge's writes) stands off. */
  readOnly?: boolean;
}
function GridBody({
  blockId,
  bridge,
  tableId,
  filter,
  columnOrder,
  hiddenColumns,
  columnWidths,
  height,
  headerHeight,
  sectionHeaderHeight,
  getRowCount,
  onHeightChange,
  onHeaderHeightChange,
  onHeaderHeightReset,
  onViewChange,
  readColumnOrder,
  readOnly = false,
}: GridBodyProps) {
  const data = useDatabaseTable(bridge, tableId, filter);
  const sectionRowCount = getRowCount?.(tableId);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // The ref tables' data (the enum's dict options / the row-link's
  // displays — the live stand over the ref tables' own events; the
  // entry's key stands the table + the column's declared display column
  // (the row-link's `refDisplayColumn`)).
  const refTableEntries = useMemo(() => {
    const map = new Map<string, RefTableEntry>();
    for (const column of data.table?.columns ?? []) {
      if (column.refTableId === undefined) continue;
      const entry: RefTableEntry = {
        tableId: column.refTableId,
        displayColumn: column.refDisplayColumn,
      };
      map.set(refEntryKey(entry), entry);
    }
    return [...map.values()];
  }, [data.table?.columns]);
  const refTableData = useRefTables(bridge, refTableEntries);

  // The motion's options' editor's variant (the framer's Reorder's stand;
  // the absent slot stands the plain editor).
  const motionEnumOptionsEditor = useEnumOptionsMotion();
  const OptionsEditor = motionEnumOptionsEditor ?? EnumOptionsEditor;

  const form = useColumnForm({ bridge, tableId, data, refTableData, readColumnOrder, onViewChange });

  const columns = visibleColumns(data.table?.columns, columnOrder, hiddenColumns);

  const resolvedHeaderHeight = resolveDatabaseHeaderHeight(headerHeight, sectionHeaderHeight);
  const blockHeight = useDatabaseBlockHeight({
    enabled: blockId !== undefined && onHeightChange !== undefined,
    ready: data.phase === "ready",
    height,
    headerHeight: resolvedHeaderHeight,
    cardRef,
    tableRef,
    scrollerRef,
    onCommit: onHeightChange,
  });

  const updateView = (patch: Record<string, unknown>) => {
    onViewChange(patch);
  };

  // The inserted row's temporary visibility (the `pendingRow` over the
  // filtered page's rows).
  const pendingRow =
    data.pendingRow !== null && !data.rows.some((row) => row.rowId === data.pendingRow?.rowId) ? data.pendingRow : null;
  const rows = pendingRow === null ? data.rows : [...data.rows, pendingRow];

  const {
    editingCell,
    setEditingCell,
    selectedCells,
    booleanPressRef,
    onCellPointerDown,
    onTableKeyDown,
    onTablePaste,
  } = useGridCellInteraction({ rows, columns, data, tableRef, readOnly });

  const { pendingRowId, onTableBlur } = useGridPendingRow({ pendingRow, data, columns, tableRef, setEditingCell });

  if (data.phase === "loading") {
    return <GridLoadingCard blockId={blockId} />;
  }

  if (data.phase === "broken" || data.table === null) {
    return <GridBrokenCard blockId={blockId} tableId={tableId} error={data.error} onRetry={() => data.retry()} />;
  }

  return (
    <Card
      ref={cardRef}
      data-slot="docblocks/block"
      data-block-type="database"
      data-block-id={blockId}
      data-state="ready"
      // The island's boundary (the span model): the grid's cell editables
      // sit behind this non-editable wrapper (the browser focuses the
      // cell's own inner, the cell's keys stand their own handlers) and
      // the chrome (the toolbar, the headers) stands no native selection
      // gesture over the shared editable.
      contentEditable={false}
      style={blockHeight.style}
      className="
        group relative my-(--docblocks-block-spacing) flex min-h-0 flex-1 flex-col rounded-(--docblocks-radius)
        border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color) outline-none
      "
    >
      <CardContent
        data-slot="docblocks/database"
        className="flex min-h-0 flex-1 flex-col gap-(--docblocks-block-spacing) p-(--docblocks-block-spacing)"
      >
        <GridToolbar
          tableId={tableId}
          table={data.table}
          data={data}
          totalRows={sectionRowCount}
          filter={filter}
          columnOrder={columnOrder}
          hiddenColumns={hiddenColumns}
          columnWidths={columnWidths}
          onViewChange={updateView}
          refTableData={refTableData}
          showName={blockId !== undefined}
          readOnly={readOnly}
        />
        {data.table.columns.length === 0 ? (
          <GridEmptyState form={form} OptionsEditor={OptionsEditor} readOnly={readOnly} />
        ) : (
          <ScrollArea ref={scrollerRef} data-slot="docblocks/database-grid" className="min-h-0 flex-1">
            <GridTable
              columns={columns}
              allColumns={data.table.columns}
              columnOrder={columnOrder}
              hiddenColumns={hiddenColumns}
              columnWidths={columnWidths}
              onViewChange={updateView}
              data={data}
              rows={rows}
              selectedCells={selectedCells}
              editingCell={editingCell}
              setEditingCell={setEditingCell}
              onCellPointerDown={onCellPointerDown}
              booleanPressRef={booleanPressRef}
              pendingRowId={pendingRowId}
              refTableData={refTableData}
              filter={filter}
              readOnly={readOnly}
              headerHeight={resolvedHeaderHeight}
              onHeaderHeightChange={onHeaderHeightChange}
              onHeaderHeightReset={onHeaderHeightReset}
              tableRef={tableRef}
              onTableKeyDown={onTableKeyDown}
              onTablePaste={onTablePaste}
              onTableBlur={onTableBlur}
              form={form}
              OptionsEditor={OptionsEditor}
            />
          </ScrollArea>
        )}
      </CardContent>
      {blockId !== undefined && onHeightChange !== undefined && !readOnly && (
        <DatabaseResizeHandle
          height={blockHeight.currentHeight}
          minHeight={blockHeight.minHeight}
          onPointerDown={blockHeight.onPointerDown}
          onPointerMove={blockHeight.onPointerMove}
          onPointerUp={blockHeight.onPointerUp}
          onPointerCancel={blockHeight.onPointerCancel}
          onKeyDown={blockHeight.onKeyDown}
        />
      )}
    </Card>
  );
}

export { GridBody };
