/** The grid's body: the toolbar (the display name, the count, the
 * undo/redo, the filter popover), the column tracks (the header cells,
 * the add-column chip + the create form (the name input + the
 * type-specific attributes)), the data rows and the cell selection / the
 * column drag / the column resize sessions. */
import { Fragment, useMemo, useRef, useState } from "react";

import type { BlockId, DatabaseFilterPayload } from "docblocks-core";

import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Card, CardContent } from "../../shared/ui/Card";
import { Checkbox } from "../../shared/ui/Checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../shared/ui/DropdownMenu";
import { Input } from "../../shared/ui/Input";
import { Label } from "../../shared/ui/Label";
import { Popover, PopoverContent, PopoverTrigger } from "../../shared/ui/Popover";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/Select";
import { Plus } from "../../shared/ui/icons";
import type { BridgeColumn } from "../bridge";
import { ENUM_OPTION_COLOR_COLUMN, ENUM_OPTION_NAME_COLUMN } from "../bridge";
import { FilterBuilder, emptyFilter, filterIsComplete } from "../filter-builder";
import { useDatabaseTable } from "../use-database-table";
import { EnumOptionsEditor } from "./EnumOptionsEditor";
import { HeaderCell } from "./HeaderCell";
import { DatabaseCell, RowMenuCell } from "./cells";
import { columnTypeIcon } from "./column-type-icon";
import { ADD_COLUMN_TYPES, NEW_TABLE_PICK, REF_NONE_PICK } from "./constants";
import type { AddColumnFormDraft } from "./models";
import { useBridgeTables } from "./use-bridge-tables";
import { useEnumOptionsMotion } from "./use-enum-options-motion";
import { useGridCellInteraction } from "./use-grid-cell-interaction";
import { useGridColumnDrag } from "./use-grid-column-drag";
import { useGridSeamResize } from "./use-grid-seam-resize";
import { refEntryKey, useRefTables } from "./use-ref-tables";
import type { RefTableEntry } from "./use-ref-tables";
import { emptyColumnForm } from "./utils";
import { cellKeyOf, visibleColumns } from "./utils";

// The grid's chrome frame: the --docblocks-* table's look (the border's
// width / color, the radius, the transparent's background) — the call
// site's classes merge over the primitive's stand (the call site's win);
// the dark's variant re-sits the same tokens. The portaled's content
// (the filter's popover) does not use it — the standard's tokens reach
// there.
const GRID_CHROME_FRAME =
  "rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width) " +
  "border-(--docblocks-table-border-color) bg-transparent " +
  "dark:border-(--docblocks-table-border-color) dark:bg-transparent";

// The chrome button's hover: the opacity's dim stand — the primitive's
// hover's background / text stand is suppressed (the grid's hover is the
// dim, not the accent's fill).
const GRID_BUTTON_HOVER =
  "cursor-pointer hover:opacity-70 hover:bg-transparent hover:text-inherit dark:hover:bg-transparent";

interface GridBodyProps {
  id: BlockId;
  doc: import("docblocks-core").Doc;
  blockId: BlockId;
  bridge: import("../bridge").DatabaseBridge;
  tableId: string;
  filter?: DatabaseFilterPayload;
  columnOrder?: string[];
  hiddenColumns?: string[];
  columnWidths?: number[];
}
function GridBody({
  id,
  doc,
  blockId,
  bridge,
  tableId,
  filter,
  columnOrder,
  hiddenColumns,
  columnWidths,
}: GridBodyProps) {
  const data = useDatabaseTable(bridge, tableId, filter);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<DatabaseFilterPayload | null>(filter ?? null);
  const [columnMenu, setColumnMenu] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [columnFormOpen, setColumnFormOpen] = useState(false);
  const [columnForm, setColumnForm] = useState<AddColumnFormDraft | null>(null);
  // The form's type-specific block stand (the catalog's flag — the number's
  // display attributes / the ref table's pick over the name).
  const columnFormNumber = columnForm?.numberKind !== undefined;
  const columnFormRef = columnForm?.refKind !== undefined;
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
  // The motion's options' editor's variant (the framer's Reorder's stand
  // over the `./motion`'s subpath — the null's stand stands the plain
  // editor, the base's boundary's contract).
  const motionEnumOptionsEditor = useEnumOptionsMotion();
  const OptionsEditor = motionEnumOptionsEditor ?? EnumOptionsEditor;
  // The table catalog (the ref form's pick list; the new-table creation
  // stands the fresh catalog over the refresh bump).
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const bridgeTables = useBridgeTables(bridge, catalogRefresh);

  /** The form's create commit (the button's press only): the name over the
   *  input, the type-specific block over the draft; the ref's new-table
   *  creation stands before the column's (the `createTable` → the
   *  `refTableId` data). The enum stands its own hidden system table (the
   *  options' rows over the `name` / the `color` columns — the table's
   *  name is derived over the data table + the column's name, so the
   *  two tabs' seeds share one table). */
  const commitColumnForm = () => {
    const draft = columnForm;
    if (draft === null || draft.name.trim() === "") return;
    const name = draft.name.trim();
    if (draft.editColumnId !== undefined) {
      commitColumnEdit(draft);
      return;
    }
    const commitRef = (refTableId: string | undefined) => {
      const columnSuffix = String((data.table?.columns.length ?? 0) + 1);
      const column: BridgeColumn = { id: `col${columnSuffix}`, name, type: draft.type };
      if (draft.numberKind !== undefined) {
        column.thousands = draft.thousands;
        if (draft.prefix !== "") column.prefix = draft.prefix;
        if (draft.suffix !== "") column.suffix = draft.suffix;
        column.allowNegative = draft.allowNegative;
        if (draft.numberKind === "decimal") column.decimals = draft.decimals;
      }
      if (draft.refKind !== undefined) {
        column.refKind = draft.refKind;
        if (draft.refMany) column.refMany = true;
        column.refTableId = refTableId;
      }
      void data.addColumn(column);
      // The create commit keeps the view's column order complete: the
      // block's explicit `columnOrder` (a previous drag committed it) stands
      // the visible order, so the new column is appended to its end — one
      // `updateBlock` (the view attr, CRDT / undo as the current ones). Read
      // fresh over the doc: the enum's commit runs in the async's tail, where
      // the render-time `columnOrder` prop stands stale. Without an explicit
      // order the bridge's schema order stands (the create appends to the end)
      // and the attr is left untouched.
      const block = doc.getBlock(blockId);
      const currentOrder = block !== null && block.type === "database" ? block.attrs.columnOrder : undefined;
      if (currentOrder !== undefined) {
        doc.updateBlock(blockId, { columnOrder: [...currentOrder, column.id] });
      }
      setColumnFormOpen(false);
      setColumnForm(null);
    };
    if (draft.refKind === "enum") {
      void (async () => {
        try {
          const enumTableId = await bridge.createTable(
            `${tableId}-enum-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
            { system: true }
          );
          await bridge.createColumn(enumTableId, {
            id: ENUM_OPTION_NAME_COLUMN,
            name: ENUM_OPTION_NAME_COLUMN,
            type: "text",
          });
          await bridge.createColumn(enumTableId, {
            id: ENUM_OPTION_COLOR_COLUMN,
            name: ENUM_OPTION_COLOR_COLUMN,
            type: "text",
          });
          for (const option of draft.enumOptions ?? []) {
            if (option.name.trim() === "") continue;
            const cells: Record<string, unknown> = { [ENUM_OPTION_NAME_COLUMN]: option.name.trim() };
            if (option.color !== null) cells[ENUM_OPTION_COLOR_COLUMN] = option.color;
            await bridge.insertRow(enumTableId, cells);
          }
          setCatalogRefresh((key) => key + 1);
          commitRef(enumTableId);
        } catch {
          // The system table's create failure: the form stands open (the
          // commit stands none — the retry is the form's own press).
        }
      })();
      return;
    }
    if (draft.refKind === undefined) {
      commitRef(undefined);
      return;
    }
    if (draft.refPick === NEW_TABLE_PICK) {
      const tableName = draft.newTableName.trim();
      if (tableName === "") return;
      void (async () => {
        try {
          const tableId = await bridge.createTable(tableName);
          setCatalogRefresh((key) => key + 1);
          commitRef(tableId);
        } catch {
          // The table's create failure: the form stands open (the commit
          // stands none — the retry is the form's own create press).
        }
      })();
      return;
    }
    if (draft.refPick === "") return; // the ref stand is required
    commitRef(draft.refPick);
  };

  /** The form's edit commit (the enum's options over the existing system
   *  table): the diff over the table's current rows (the matched's
   *  name / color's updates, the removed's removals, the added's inserts,
   *  the order's stand over the `moveRow`'s ops) + the column's name over
   *  the `renameColumn` (the undo entry's stand). The bridge's calls stand
   *  direct (the system table's rows keep no per-block undo — the create
   *  form's table-creation contract). */
  const commitColumnEdit = (draft: AddColumnFormDraft) => {
    const columnId = draft.editColumnId;
    const refTableId = draft.refPick;
    const column = data.table?.columns.find((entry) => entry.id === columnId);
    if (columnId === undefined || refTableId === "" || column === undefined) return;
    void (async () => {
      try {
        const page = await bridge.queryRows(refTableId, { limit: 200 });
        const current: { rowId: string; name: string; color: string | null }[] = [];
        for (const [rowId, cells] of Object.entries(page.rows)) {
          current.push({
            rowId,
            name: typeof cells[ENUM_OPTION_NAME_COLUMN] === "string" ? cells[ENUM_OPTION_NAME_COLUMN] : rowId,
            color: typeof cells[ENUM_OPTION_COLOR_COLUMN] === "string" ? cells[ENUM_OPTION_COLOR_COLUMN] : null,
          });
        }
        const draftOptions = (draft.enumOptions ?? []).filter((option) => option.name.trim() !== "");
        const keptRowIds = new Set<string>();
        const addedRowIds: string[] = [];
        for (let i = 0; i < draftOptions.length; i++) {
          const option = draftOptions[i];
          if (option === undefined) continue;
          if (option.rowId === undefined) {
            const cells: Record<string, unknown> = { [ENUM_OPTION_NAME_COLUMN]: option.name.trim() };
            if (option.color !== null) cells[ENUM_OPTION_COLOR_COLUMN] = option.color;
            addedRowIds.push(await bridge.insertRow(refTableId, cells));
            continue;
          }
          keptRowIds.add(option.rowId);
          const before = current.find((entry) => entry.rowId === option.rowId);
          if (before === undefined) continue;
          const cells: Record<string, unknown> = {};
          if (before.name !== option.name.trim()) cells[ENUM_OPTION_NAME_COLUMN] = option.name.trim();
          if (before.color !== (option.color ?? null)) {
            cells[ENUM_OPTION_COLOR_COLUMN] = option.color;
          }
          if (Object.keys(cells).length > 0) await bridge.updateRow(refTableId, option.rowId, cells);
        }
        for (const entry of current) {
          if (!keptRowIds.has(entry.rowId)) await bridge.removeRow(refTableId, entry.rowId);
        }
        const orderedIds = draftOptions.map((option, i) => option.rowId ?? addedRowIds[i]);
        for (let i = 0; i < orderedIds.length - 1; i++) {
          const rowId = orderedIds[i];
          const beforeRowId = orderedIds[i + 1];
          if (rowId === undefined || beforeRowId === undefined) continue;
          await bridge.moveRow(refTableId, rowId, beforeRowId);
        }
        if (column.name !== draft.name.trim()) await data.renameColumn(columnId, draft.name.trim());
        setColumnFormOpen(false);
        setColumnForm(null);
      } catch {
        // The commit's failure: the form stands open (the retry is the
        // form's own save press).
      }
    })();
  };

  /** The edit form's open (the enum's options over the column's system
   *  table): the draft prefills from the column + the ref table's data
   *  (the row order's stand, the `name`'s display, the `color`'s hex). */
  const openColumnFormEdit = (column: BridgeColumn) => {
    if (column.refKind !== "enum" || column.refTableId === undefined) return;
    const refData = refTableData[refEntryKey({ tableId: column.refTableId, displayColumn: column.refDisplayColumn })];
    const options = (refData?.rowIds ?? []).map((rowId) => ({
      rowId,
      name: refData?.displays[rowId] ?? rowId,
      color: refData?.colors[rowId] ?? null,
    }));
    setColumnForm({
      key: column.id,
      type: "enum",
      name: column.name,
      decimals: 0,
      thousands: false,
      prefix: "",
      suffix: "",
      allowNegative: true,
      refKind: "enum",
      refMany: column.refMany === true,
      refPick: column.refTableId,
      newTableName: "",
      enumOptions: options,
      editColumnId: column.id,
    });
    setColumnFormOpen(true);
  };
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);

  const columns = visibleColumns(data.table?.columns, columnOrder, hiddenColumns);

  const updateView = (patch: Record<string, unknown>) => {
    doc.updateBlock(blockId, patch);
  };

  const { resizePreview, onSeamPointerDown, onSeamPointerMove, onSeamPointerUp, onSeamPointerCancel } =
    useGridSeamResize({ columns, columnWidths, updateView });

  const { drag, onColumnPointerDown, onColumnPointerMove, onColumnPointerUp } = useGridColumnDrag({
    columns,
    updateView,
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

  // --- The display name: the bridge's table name (the name is the
  //     table's attribute — every block over the tableId stands it live;
  //     the block's legacy `name` attr is ignored over the display).
  const displayName = data.table?.name ?? tableId;

  const rows = data.rows;

  const { editingCell, setEditingCell, selectedCells, booleanPressRef, onCellPointerDown, onTableKeyDown } =
    useGridCellInteraction({ rows, columns, data, tableRef });

  if (data.phase === "loading") {
    return (
      <Card data-slot="docblocks/block" data-block-type="database" data-block-id={id}>
        <CardContent data-slot="docblocks/database" data-state="loading" className="p-(--docblocks-block-spacing)">
          <span className="text-(length:--docblocks-font-size) text-(--docblocks-placeholder-color)">
            Loading the table…
          </span>
        </CardContent>
      </Card>
    );
  }

  if (data.phase === "broken" || data.table === null) {
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
        <CardContent
          data-slot="docblocks/database"
          data-state="broken"
          className="flex items-center justify-between gap-(--docblocks-block-spacing) p-(--docblocks-block-spacing)"
        >
          <div className="flex flex-col">
            <span
              data-slot="docblocks/database-broken"
              className="text-(length:--docblocks-font-size) font-(--docblocks-heading-font-weight)"
            >
              Table not found
            </span>
            <span className="text-(length:--docblocks-font-size) text-(--docblocks-placeholder-color)">
              {data.error ?? `The table "${tableId}" is unknown to the bridge.`}
            </span>
          </div>
          <Button
            data-slot="docblocks/database-retry"
            variant="outline"
            size="sm"
            className={
              GRID_CHROME_FRAME +
              GRID_BUTTON_HOVER +
              " h-auto px-2 py-1 text-(length:--docblocks-font-size) font-normal shadow-none"
            }
            onClick={() => data.retry()}
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const applyFilter = () => {
    updateView({ filter: filterDraft });
    setFilterOpen(false);
  };
  const commitName = (draft: string) => {
    setNameDraft(null);
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === data.table?.name) return;
    // The rename is the bridge's (the table's attribute): every block over
    // the tableId stands the new name over the table event — no doc write,
    // the grid's undo stack covers it.
    void data.renameTable(trimmed);
  };

  const lastRowId = rows.length > 0 ? rows[rows.length - 1]!.rowId : null;

  return (
    <Card
      data-slot="docblocks/block"
      data-block-type="database"
      data-block-id={id}
      data-state="ready"
      className="
        my-(--docblocks-block-spacing) rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
        border-(--docblocks-table-border-color) outline-none
      "
    >
      <CardContent
        data-slot="docblocks/database"
        className="flex flex-col gap-(--docblocks-block-spacing) p-(--docblocks-block-spacing)"
      >
        <div data-slot="docblocks/database-toolbar" className="flex flex-wrap items-center gap-2">
          {nameDraft !== null ? (
            <Input
              size="sm"
              data-slot="docblocks/database-name-input"
              className={
                GRID_CHROME_FRAME +
                " h-auto min-w-32 px-1 py-0.5 text-(length:--docblocks-font-size) font-(--docblocks-heading-font-weight)"
              }
              value={nameDraft}
              autoFocus
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={(event) => commitName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                if (event.key === "Escape") setNameDraft(null);
              }}
            />
          ) : (
            <Button
              data-slot="docblocks/database-name"
              variant="ghost"
              size="sm"
              title="Rename"
              className={
                // The frame-less stand (the look's own: no border) — the
                // primitive's chrome frame stands off.
                " h-auto cursor-text border-0 bg-transparent px-1 text-(length:--docblocks-font-size) " +
                "font-(--docblocks-heading-font-weight) hover:bg-transparent hover:opacity-70 " +
                "hover:text-inherit dark:bg-transparent dark:hover:bg-transparent"
              }
              onClick={() => setNameDraft(displayName)}
            >
              {displayName}
            </Button>
          )}
          <Badge data-slot="docblocks/database-count" variant="secondary">
            {rows.length} {rows.length === 1 ? "row" : "rows"}
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button
              data-slot="docblocks/database-undo"
              variant="outline"
              size="sm"
              data-disabled={data.canUndo ? undefined : true}
              className={
                GRID_CHROME_FRAME +
                GRID_BUTTON_HOVER +
                " h-auto px-2 py-0.5 text-xs font-normal shadow-none disabled:cursor-default disabled:opacity-40"
              }
              disabled={!data.canUndo}
              onClick={() => void data.undo()}
            >
              Undo
            </Button>
            <Button
              data-slot="docblocks/database-redo"
              variant="outline"
              size="sm"
              data-disabled={data.canRedo ? undefined : true}
              className={
                GRID_CHROME_FRAME +
                GRID_BUTTON_HOVER +
                " h-auto px-2 py-0.5 text-xs font-normal shadow-none disabled:cursor-default disabled:opacity-40"
              }
              disabled={!data.canRedo}
              onClick={() => void data.redo()}
            >
              Redo
            </Button>
            <Popover
              open={filterOpen}
              onOpenChange={(open) => {
                setFilterOpen(open);
                if (open) setFilterDraft(filter ?? null);
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  data-slot="docblocks/database-filter"
                  variant="outline"
                  size="sm"
                  data-active={filter !== undefined && filter.conditions.length > 0 ? "true" : undefined}
                  className={
                    GRID_CHROME_FRAME + GRID_BUTTON_HOVER + " h-auto px-2 py-0.5 text-xs font-normal shadow-none"
                  }
                >
                  Filter{filter !== undefined && filter.conditions.length > 0 ? " •" : ""}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-96">
                <div className="flex flex-col gap-(--docblocks-block-spacing)">
                  <FilterBuilder
                    value={filterDraft}
                    columns={data.table.columns}
                    onChange={setFilterDraft}
                    refTableData={refTableData}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <Button
                      data-slot="docblocks/filter-clear"
                      variant="outline"
                      size="sm"
                      className="
                        cursor-pointer bg-transparent px-2 py-1 text-xs font-normal shadow-none
                        hover:bg-transparent hover:opacity-70
                        dark:bg-transparent
                        dark:hover:bg-transparent
                      "
                      onClick={() => setFilterDraft(emptyFilter())}
                    >
                      Clear
                    </Button>
                    <Button
                      data-slot="docblocks/filter-apply"
                      variant="outline"
                      size="sm"
                      disabled={!filterIsComplete(filterDraft, data.table.columns)}
                      className="
                        cursor-pointer bg-accent px-2 py-1 text-xs font-normal
                        hover:opacity-70
                        disabled:cursor-default disabled:opacity-40
                      "
                      onClick={applyFilter}
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <ScrollArea data-slot="docblocks/database-grid">
          <div
            ref={tableRef}
            data-slot="docblocks/database-table"
            tabIndex={0}
            // The grid's pointer model stands the cell / column selection —
            // the native text selection over the drag is suppressed (the
            // editable inputs stand the explicit `select-text`).
            className="grid w-full outline-none select-none"
            onKeyDown={onTableKeyDown}
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
                  const preview =
                    resizePreview !== null && resizePreview.col === index ? resizePreview.width : undefined;
                  const width = preview ?? columnWidths?.[index];
                  return width !== undefined ? `${width}px` : "minmax(7rem, 1fr)";
                })
                .join(" ")} 2.5rem`,
            }}
          >
            {columns.map((column, index) => (
              <HeaderCell
                key={column.id}
                column={column}
                colIndex={index}
                first={index === 0}
                resizing={resizePreview !== null && resizePreview.col === index}
                dragDx={drag !== null && drag.id === column.id ? drag.dx : dragShiftOf(index)}
                dragShifted={drag !== null && drag.id !== column.id}
                menuOpen={columnMenu === column.id}
                onMenuChange={(open) => setColumnMenu(open ? column.id : null)}
                onRename={(renameName) => void data.renameColumn(column.id, renameName)}
                onEditOptions={
                  column.refKind === "enum" && column.refTableId !== undefined
                    ? () => openColumnFormEdit(column)
                    : undefined
                }
                onHide={() => updateView({ hiddenColumns: [...(hiddenColumns ?? []), column.id] })}
                onShow={() =>
                  updateView({ hiddenColumns: (hiddenColumns ?? []).filter((entryId) => entryId !== column.id) })
                }
                onDelete={() => void data.deleteColumn(column.id)}
                hidden={(hiddenColumns ?? []).includes(column.id)}
                onPointerDown={(event) => onColumnPointerDown(column, event)}
                onResizePointerDown={(event) => onSeamPointerDown(index)(event)}
                onResizePointerMove={onSeamPointerMove}
                onResizePointerUp={onSeamPointerUp}
                onResizePointerCancel={onSeamPointerCancel}
                onPointerMove={onColumnPointerMove}
                onPointerUp={(event) => onColumnPointerUp(column, event)}
              />
            ))}
            <div
              data-slot="docblocks/database-add-column"
              className="
                relative flex items-center justify-center border-b-(length:--docblocks-table-border-width)
                border-(--docblocks-table-border-color)
              "
            >
              <DropdownMenu modal={false} open={addingColumn} onOpenChange={setAddingColumn}>
                <DropdownMenuTrigger asChild>
                  <Button
                    data-slot="docblocks/database-add-column-trigger"
                    variant="ghost"
                    size="icon"
                    className={
                      GRID_CHROME_FRAME +
                      " size-6 cursor-pointer p-1 text-(--docblocks-placeholder-color) hover:bg-transparent " +
                      "hover:text-(--docblocks-text-color) dark:hover:bg-transparent"
                    }
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
                        onClick={() => {
                          // Every entry stands the create form (the name
                          // input + the type-specific block over it): the
                          // create commits on the form's button only.
                          setColumnForm(emptyColumnForm(entry));
                          setAddingColumn(false);
                          setColumnFormOpen(true);
                        }}
                      >
                        <EntryIcon className="size-4 shrink-0 text-muted-foreground" />
                        {entry.label}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              {/* The create form (every menu entry opens it: the name
                  input + the type-specific attributes — the number's
                  display attributes stand the bridge's column data). */}
              <Popover
                open={columnFormOpen && columnForm !== null}
                onOpenChange={(open) => {
                  setColumnFormOpen(open);
                  // The close (the outside press / the Escape) drops the
                  // draft — the next open stands a fresh one.
                  if (!open) setColumnForm(null);
                }}
              >
                <PopoverTrigger asChild>
                  <span data-slot="docblocks/database-add-column-form-anchor" className="absolute size-0" />
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-72 p-3"
                  // The menu's entry stands the form: the menu's close
                  // restores the focus to the plus trigger (outside the
                  // popover content) — the focus-outside would close the
                  // form the very tick it opens. The outside press (the
                  // interact-outside) and the Escape keep the close (no
                  // create — the commit stands the form's button only).
                  onFocusOutside={(event) => event.preventDefault()}
                >
                  <div data-slot="docblocks/database-add-column-form" className="flex flex-col gap-2">
                    <Label>
                      Name
                      <Input
                        size="sm"
                        type="text"
                        data-slot="docblocks/database-add-column-name"
                        className="cursor-text focus:bg-muted/60"
                        value={columnForm?.name ?? ""}
                        onChange={(event) =>
                          setColumnForm((draft) => (draft === null ? draft : { ...draft, name: event.target.value }))
                        }
                      />
                    </Label>
                    {columnFormNumber && (
                      <>
                        {columnForm?.numberKind === "decimal" && (
                          <Label>
                            Decimals
                            <Input
                              size="sm"
                              type="number"
                              min={0}
                              max={10}
                              data-slot="docblocks/database-add-column-decimals"
                              className="w-16 cursor-text px-1 focus:bg-muted/60"
                              value={columnForm?.decimals ?? 0}
                              onChange={(event) =>
                                setColumnForm((draft) =>
                                  draft === null ? draft : { ...draft, decimals: Number(event.target.value) || 0 }
                                )
                              }
                            />
                          </Label>
                        )}
                        <Label className="cursor-pointer">
                          <Checkbox
                            data-slot="docblocks/database-add-column-thousands"
                            checked={columnForm?.thousands ?? false}
                            onCheckedChange={(checked) =>
                              setColumnForm((draft) =>
                                draft === null ? draft : { ...draft, thousands: checked === true }
                              )
                            }
                          />
                          Thousands' separator
                        </Label>
                        <Label>
                          Prefix
                          <Input
                            size="sm"
                            type="text"
                            data-slot="docblocks/database-add-column-prefix"
                            className="cursor-text focus:bg-muted/60"
                            value={columnForm?.prefix ?? ""}
                            onChange={(event) =>
                              setColumnForm((draft) =>
                                draft === null ? draft : { ...draft, prefix: event.target.value }
                              )
                            }
                          />
                        </Label>
                        <Label>
                          Suffix
                          <Input
                            size="sm"
                            type="text"
                            data-slot="docblocks/database-add-column-suffix"
                            className="cursor-text focus:bg-muted/60"
                            value={columnForm?.suffix ?? ""}
                            onChange={(event) =>
                              setColumnForm((draft) =>
                                draft === null ? draft : { ...draft, suffix: event.target.value }
                              )
                            }
                          />
                        </Label>
                        <Label className="cursor-pointer">
                          <Checkbox
                            data-slot="docblocks/database-add-column-negative"
                            checked={columnForm?.allowNegative ?? true}
                            onCheckedChange={(checked) =>
                              setColumnForm((draft) =>
                                draft === null ? draft : { ...draft, allowNegative: checked === true }
                              )
                            }
                          />
                          Allow negative
                        </Label>
                      </>
                    )}
                    {columnFormRef && columnForm?.refKind === "enum" && (
                      /* The enum's options' editor (the create / the edit's
                          stand): the ref table's pick is out (the options
                          stand over the column's own system table — the
                          created / the edited stand). The motion's variant
                          (the framer's Reorder's rows) stands over the
                          slot's context; the plain's editor is the stand
                          over its absence. */
                      <OptionsEditor
                        options={columnForm.enumOptions ?? []}
                        onChange={(next) =>
                          setColumnForm((draft) => (draft === null ? draft : { ...draft, enumOptions: next }))
                        }
                      />
                    )}
                    {columnFormRef && columnForm?.refKind === "row" && (
                      <>
                        {/* The row-link's table's pick: the existing tables
                            + the new-table creation. The package's Select
                            (the native select is gone) — the "none" stand
                            is the sentinel pick (Radix takes no empty
                            value), the portaled list stands the standard
                            tokens (the --docblocks-* do not reach the
                            body). */}
                        <Label>
                          Table
                          <Select
                            value={
                              columnForm === null || columnForm.refPick === "" ? REF_NONE_PICK : columnForm.refPick
                            }
                            onValueChange={(next) =>
                              setColumnForm((draft) =>
                                draft === null
                                  ? draft
                                  : { ...draft, refPick: next === REF_NONE_PICK ? "" : next, newTableName: "" }
                              )
                            }
                          >
                            <SelectTrigger
                              data-slot="docblocks/database-add-column-ref"
                              className="w-full justify-start px-2 py-0.5 text-xs shadow-none data-[size=default]:h-7"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="start" sideOffset={4}>
                              <SelectItem value={REF_NONE_PICK}>— Select a table —</SelectItem>
                              {bridgeTables.map((table) => (
                                <SelectItem key={table.id} value={table.id}>
                                  {table.name}
                                </SelectItem>
                              ))}
                              <SelectItem value={NEW_TABLE_PICK}>New table…</SelectItem>
                            </SelectContent>
                          </Select>
                        </Label>
                        {(columnForm?.refPick ?? "") === NEW_TABLE_PICK && (
                          <Label>
                            Name
                            <Input
                              size="sm"
                              type="text"
                              data-slot="docblocks/database-add-column-ref-new"
                              placeholder="New table name"
                              className="cursor-text focus:bg-muted/60"
                              value={columnForm?.newTableName ?? ""}
                              onChange={(event) =>
                                setColumnForm((draft) =>
                                  draft === null ? draft : { ...draft, newTableName: event.target.value }
                                )
                              }
                            />
                          </Label>
                        )}
                      </>
                    )}
                    <Button
                      data-slot="docblocks/database-add-column-create"
                      variant="outline"
                      size="sm"
                      // The create / the save commits on the press only
                      // (the outside press / the Escape close without the
                      // commit); the empty name / the unpicked row's table
                      // stand the disabled stand (the commit is impossible
                      // over it).
                      disabled={
                        columnForm === null ||
                        columnForm.name.trim() === "" ||
                        (columnFormRef &&
                          columnForm.refKind === "row" &&
                          (columnForm.refPick === "" ||
                            (columnForm.refPick === NEW_TABLE_PICK && columnForm.newTableName.trim() === "")))
                      }
                      className="bg-accent px-2 py-1 hover:opacity-70"
                      onClick={() => {
                        commitColumnForm();
                      }}
                    >
                      {columnForm?.editColumnId !== undefined ? "Save" : "Add column"}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {rows.map((row, rowIndex) => (
              <Fragment key={row.rowId}>
                {columns.map((column, index) => {
                  const key = cellKeyOf(row.rowId, column.id);
                  return (
                    <DatabaseCell
                      key={column.id}
                      rowId={row.rowId}
                      column={column}
                      value={row.cells[column.id]}
                      rowIndex={rowIndex}
                      colIndex={index}
                      first={index === 0}
                      lastRow={row.rowId === lastRowId}
                      dragDx={drag !== null && drag.id === column.id ? drag.dx : dragShiftOf(index)}
                      dragShifted={drag !== null && drag.id !== column.id}
                      selected={selectedCells.has(key)}
                      singleSelected={selectedCells.has(key) && selectedCells.size === 1}
                      editing={editingCell === key}
                      onChange={(value) => void data.updateRow(row.rowId, { [column.id]: value })}
                      onPointerDown={onCellPointerDown(row.rowId, column.id, rowIndex, index)}
                      onEditStart={() => setEditingCell(key)}
                      refTableData={
                        column.refTableId !== undefined
                          ? refTableData[
                              refEntryKey({ tableId: column.refTableId, displayColumn: column.refDisplayColumn })
                            ]
                          : undefined
                      }
                      onEditEnd={() => setEditingCell(null)}
                      booleanPress={booleanPressRef}
                    />
                  );
                })}
                <RowMenuCell
                  row={row}
                  rowMenu={rowMenu}
                  setRowMenu={setRowMenu}
                  canMoveUp={rows.indexOf(row) > 0}
                  canMoveDown={rows.indexOf(row) < rows.length - 1}
                  onMoveUp={() => {
                    const index = rows.indexOf(row);
                    if (index > 0) void data.moveRow(row.rowId, rows[index - 1]!.rowId);
                  }}
                  onMoveDown={() => {
                    const index = rows.indexOf(row);
                    if (index < rows.length - 1)
                      void data.moveRow(row.rowId, index + 2 < rows.length ? rows[index + 2]!.rowId : null);
                  }}
                  onRemove={() => void data.removeRow(row.rowId)}
                  lastRow={row.rowId === lastRowId}
                />
              </Fragment>
            ))}
          </div>

          {rows.length === 0 && (
            <div
              data-slot="docblocks/database-empty"
              className="
                px-(--docblocks-table-cell-padding) py-(--docblocks-block-spacing) text-(length:--docblocks-font-size)
                text-(--docblocks-placeholder-color) select-none
              "
            >
              No rows{filter !== undefined ? " match the filter" : ""}.
            </div>
          )}
        </ScrollArea>

        <Button
          data-slot="docblocks/database-add-row"
          variant="outline"
          size="sm"
          className={
            GRID_CHROME_FRAME +
            " h-auto cursor-pointer self-start px-2 py-1 font-normal " +
            "text-(length:--docblocks-font-size) shadow-none select-none " +
            "text-(--docblocks-placeholder-color) hover:bg-transparent " +
            "hover:text-(--docblocks-text-color) dark:hover:bg-transparent"
          }
          onClick={() => void data.insertRow({})}
        >
          + Add row
        </Button>
      </CardContent>
    </Card>
  );
}

export { GridBody };
