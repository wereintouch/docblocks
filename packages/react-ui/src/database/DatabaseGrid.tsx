/**
 * The external-form database grid: the live table view over the bridge
 * (the schema + the rows + the live events). The view settings are the
 * block's attrs (the `filter`, the `columnOrder`, the `hiddenColumns`)
 * written via `updateBlock` (CRDT data, undo-able); the table data
 * itself is the consumer's database (the bridge is the source of truth).
 * The cell editing commits one `bridge.updateRow` per cell (the
 * optimistic layer + the forward-only undo live in the
 * `useDatabaseTable` provider).
 */
import { useState } from "react";

import type { BlockId, DatabaseBlock as DatabaseBlockType, DatabaseFilterPayload } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { Badge } from "../shared/ui/Badge";
import { Card, CardContent } from "../shared/ui/Card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../shared/ui/DropdownMenu";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/Popover";
import { Ellipsis, Plus } from "../shared/ui/icons";
import type { BridgeColumn, BridgeColumnAnnotation } from "./bridge";
import { columnAnnotation } from "./bridge";
import { FilterBuilder, emptyFilter, filterIsComplete } from "./filter-builder";
import { useDatabaseTable } from "./use-database-table";
import type { DatabaseTableRow } from "./use-database-table";

/** The block's visible columns: the `columnOrder` attr first (the
 *  additive columns not listed keep the schema order), the hidden
 *  columns dropped. */
function visibleColumns(
  columns: BridgeColumn[] | undefined,
  columnOrder?: string[],
  hiddenColumns?: string[]
): BridgeColumn[] {
  const all = columns ?? [];
  const hidden = new Set(hiddenColumns ?? []);
  const byId = new Map(all.map((column) => [column.id, column]));
  const ordered: BridgeColumn[] = [];
  if (columnOrder !== undefined) {
    for (const id of columnOrder) {
      const column = byId.get(id);
      if (column !== undefined && !hidden.has(id)) {
        ordered.push(column);
        byId.delete(id);
      }
    }
  }
  for (const column of all) if (!hidden.has(column.id)) ordered.push(column);
  return ordered;
}

/** The add-column type catalog (the `select` columns are the
 *  consumer-level — they need the options set). */
const ADD_COLUMN_TYPES: Array<{ type: string; label: string }> = [
  { type: "text", label: "Text" },
  { type: "integer", label: "Number" },
  { type: "boolean", label: "Checkbox" },
  { type: "date", label: "Date" },
];

function DatabaseGrid({ id, block }: { id: BlockId; block: DatabaseBlockType }) {
  const { doc, databaseBridge } = useEditorContext();
  const tableId = block.attrs.tableId;
  if (tableId === undefined) {
    // The inline form: the built-in placeholder card stands (the caller
    // branches); this is the unreachable guard.
    return null;
  }
  return (
    <GridBody
      id={id}
      doc={doc}
      blockId={id}
      bridge={databaseBridge}
      tableId={tableId}
      filter={block.attrs.filter}
      columnOrder={block.attrs.columnOrder}
      hiddenColumns={block.attrs.hiddenColumns}
    />
  );
}

interface GridBodyProps {
  id: BlockId;
  doc: import("docblocks-core").Doc;
  blockId: BlockId;
  bridge: import("./bridge").DatabaseBridge;
  tableId: string;
  filter?: DatabaseFilterPayload;
  columnOrder?: string[];
  hiddenColumns?: string[];
}

function GridBody({ id, doc, blockId, bridge, tableId, filter, columnOrder, hiddenColumns }: GridBodyProps) {
  const data = useDatabaseTable(bridge, tableId, filter);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<DatabaseFilterPayload | null>(filter ?? null);
  const [columnMenu, setColumnMenu] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);

  const columns = visibleColumns(data.table?.columns, columnOrder, hiddenColumns);

  const updateView = (patch: Record<string, unknown>) => {
    doc.updateBlock(blockId, patch);
  };

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
          <button
            type="button"
            data-slot="docblocks/database-retry"
            className="
              cursor-pointer rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
              border-(--docblocks-table-border-color) bg-transparent px-2 py-1 text-(length:--docblocks-font-size)
              outline-none
              hover:opacity-70
            "
            onClick={() => data.retry()}
          >
            Retry
          </button>
        </CardContent>
      </Card>
    );
  }

  const rows = data.rows;
  const applyFilter = () => {
    updateView({ filter: filterDraft });
    setFilterOpen(false);
  };

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
          <span
            data-slot="docblocks/database-name"
            className="text-(length:--docblocks-font-size) font-(--docblocks-heading-font-weight)"
          >
            {data.table.name}
          </span>
          <Badge data-slot="docblocks/database-count" variant="secondary">
            {rows.length} {rows.length === 1 ? "row" : "rows"}
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              data-slot="docblocks/database-undo"
              data-disabled={data.canUndo ? undefined : true}
              className="
                cursor-pointer rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
                border-(--docblocks-table-border-color) bg-transparent px-2 py-0.5 text-xs outline-none
                hover:opacity-70
                disabled:cursor-default disabled:opacity-40
              "
              disabled={!data.canUndo}
              onClick={() => void data.undo()}
            >
              Undo
            </button>
            <button
              type="button"
              data-slot="docblocks/database-redo"
              data-disabled={data.canRedo ? undefined : true}
              className="
                cursor-pointer rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
                border-(--docblocks-table-border-color) bg-transparent px-2 py-0.5 text-xs outline-none
                hover:opacity-70
                disabled:cursor-default disabled:opacity-40
              "
              disabled={!data.canRedo}
              onClick={() => void data.redo()}
            >
              Redo
            </button>
            <Popover
              open={filterOpen}
              onOpenChange={(open) => {
                setFilterOpen(open);
                if (open) setFilterDraft(filter ?? null);
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-slot="docblocks/database-filter"
                  data-active={filter !== undefined && filter.conditions.length > 0 ? "true" : undefined}
                  className="
                    cursor-pointer rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
                    border-(--docblocks-table-border-color) bg-transparent px-2 py-0.5 text-xs outline-none
                    hover:opacity-70
                  "
                >
                  Filter{filter !== undefined && filter.conditions.length > 0 ? " •" : ""}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="
                  w-96 rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
                  border-(--docblocks-table-border-color) bg-(--docblocks-page-card-background)
                  p-(--docblocks-block-spacing) shadow-(--docblocks-formatbar-shadow)
                "
              >
                <div className="flex flex-col gap-(--docblocks-block-spacing)">
                  <FilterBuilder value={filterDraft} columns={data.table.columns} onChange={setFilterDraft} />
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      data-slot="docblocks/filter-clear"
                      className="
                        cursor-pointer rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
                        border-(--docblocks-table-border-color) bg-transparent px-2 py-1 text-xs outline-none
                        hover:opacity-70
                      "
                      onClick={() => setFilterDraft(emptyFilter())}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      data-slot="docblocks/filter-apply"
                      disabled={!filterIsComplete(filterDraft, data.table.columns)}
                      className="
                        cursor-pointer rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
                        border-(--docblocks-table-border-color) bg-(--docblocks-selected-background) px-2 py-1 text-xs
                        outline-none
                        hover:opacity-70
                        disabled:cursor-default disabled:opacity-40
                      "
                      onClick={applyFilter}
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div data-slot="docblocks/database-grid" className="flex flex-col overflow-x-auto">
          <div
            data-slot="docblocks/database-header"
            className="flex border-b-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color)"
          >
            {columns.map((column) => (
              <HeaderCell
                key={column.id}
                column={column}
                menuOpen={columnMenu === column.id}
                onMenuChange={(open) => setColumnMenu(open ? column.id : null)}
                onRename={(name) => void data.renameColumn(column.id, name)}
                onHide={() => updateView({ hiddenColumns: [...(hiddenColumns ?? []), column.id] })}
                onShow={() =>
                  updateView({ hiddenColumns: (hiddenColumns ?? []).filter((entryId) => entryId !== column.id) })
                }
                onDelete={() => void data.deleteColumn(column.id)}
                hidden={(hiddenColumns ?? []).includes(column.id)}
              />
            ))}
            <div data-slot="docblocks/database-add-column" className="flex w-10 items-center justify-center">
              <DropdownMenu modal={false} open={addingColumn} onOpenChange={setAddingColumn}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    data-slot="docblocks/database-add-column-trigger"
                    className="
                      cursor-pointer rounded-(--docblocks-radius) p-1 text-(--docblocks-placeholder-color) outline-none
                      hover:text-(--docblocks-text-color)
                    "
                  >
                    <Plus className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-32">
                  {ADD_COLUMN_TYPES.map((entry) => (
                    <DropdownMenuItem
                      key={entry.type}
                      data-column-type={entry.type}
                      onClick={() => {
                        const suffix = `${data.table?.columns.length ?? 0} + 1`;
                        void data.addColumn({ id: `col${suffix}`, name: entry.label, type: entry.type });
                      }}
                    >
                      {entry.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {rows.length === 0 && (
            <div
              data-slot="docblocks/database-empty"
              className="
                px-(--docblocks-table-cell-padding) py-(--docblocks-block-spacing) text-(length:--docblocks-font-size)
                text-(--docblocks-placeholder-color)
              "
            >
              No rows{filter !== undefined ? " match the filter" : ""}.
            </div>
          )}

          {rows.map((row, index) => (
            <DatabaseGridRow
              key={row.rowId}
              row={row}
              columns={columns}
              menuOpen={rowMenu === row.rowId}
              onMenuChange={(open) => setRowMenu(open ? row.rowId : null)}
              canMoveUp={index > 0}
              canMoveDown={index < rows.length - 1}
              onMoveUp={() => index > 0 && void data.moveRow(row.rowId, rows[index - 1]!.rowId)}
              onMoveDown={() =>
                index < rows.length - 1 &&
                void data.moveRow(row.rowId, index + 2 < rows.length ? rows[index + 2]!.rowId : null)
              }
              onRemove={() => void data.removeRow(row.rowId)}
              onCellChange={(columnId, value) => void data.updateRow(row.rowId, { [columnId]: value })}
            />
          ))}
        </div>

        <button
          type="button"
          data-slot="docblocks/database-add-row"
          className="
            cursor-pointer self-start rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
            border-(--docblocks-table-border-color) bg-transparent px-2 py-1 text-(length:--docblocks-font-size)
            text-(--docblocks-placeholder-color) outline-none
            hover:text-(--docblocks-text-color)
          "
          onClick={() => void data.insertRow({})}
        >
          + Add row
        </button>
      </CardContent>
    </Card>
  );
}

interface HeaderCellProps {
  column: BridgeColumn;
  menuOpen: boolean;
  onMenuChange: (open: boolean) => void;
  onRename: (name: string) => void;
  onHide: () => void;
  onShow: () => void;
  onDelete: () => void;
  hidden: boolean;
}

function HeaderCell({ column, menuOpen, onMenuChange, onRename, onHide, onShow, onDelete, hidden }: HeaderCellProps) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(column.name);
  return (
    <div
      data-slot="docblocks/database-header-cell"
      data-column-id={column.id}
      className="
        flex min-w-28 items-center gap-1 border-l-(length:--docblocks-table-border-width)
        border-(--docblocks-table-border-color) px-(--docblocks-table-cell-padding) py-1
        first:border-l-0
      "
    >
      {renaming ? (
        <input
          data-slot="docblocks/database-rename-input"
          className="
            min-w-16 flex-1 rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
            border-(--docblocks-table-border-color) bg-transparent px-1 text-(length:--docblocks-font-size) outline-none
          "
          value={nameDraft}
          autoFocus
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={() => {
            setRenaming(false);
            if (nameDraft.trim().length > 0 && nameDraft !== column.name) onRename(nameDraft.trim());
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            if (event.key === "Escape") {
              setNameDraft(column.name);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <span className="text-(length:--docblocks-font-size) font-(--docblocks-heading-font-weight)">
          {column.name}
        </span>
      )}
      <span data-slot="docblocks/database-column-type" className="text-xs text-(--docblocks-placeholder-color)">
        {column.type}
      </span>
      <div className="ml-auto">
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
          <DropdownMenuContent align="end" className="min-w-36">
            <DropdownMenuItem
              onClick={() => {
                setNameDraft(column.name);
                setRenaming(true);
                onMenuChange(false);
              }}
            >
              Rename
            </DropdownMenuItem>
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
    </div>
  );
}

interface DatabaseGridRowProps {
  row: DatabaseTableRow;
  columns: BridgeColumn[];
  menuOpen: boolean;
  onMenuChange: (open: boolean) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onCellChange: (columnId: string, value: unknown) => void;
}

function DatabaseGridRow({
  row,
  columns,
  menuOpen,
  onMenuChange,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
  onCellChange,
}: DatabaseGridRowProps) {
  return (
    <div
      data-slot="docblocks/database-row"
      data-row-id={row.rowId}
      className="
        flex border-b-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color)
        last:border-b-0
      "
    >
      {columns.map((column) => (
        <DatabaseCell
          key={column.id}
          rowId={row.rowId}
          column={column}
          value={row.cells[column.id]}
          onChange={(value) => onCellChange(column.id, value)}
        />
      ))}
      <div data-slot="docblocks/database-row-menu" className="flex w-10 items-center justify-center">
        <DropdownMenu modal={false} open={menuOpen} onOpenChange={onMenuChange}>
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
    </div>
  );
}

interface DatabaseCellProps {
  rowId: string;
  column: BridgeColumn;
  value: unknown;
  onChange: (value: unknown) => void;
}

/** The cell editor per the column annotation; the commit is one
 *  `updateRow` (the optimistic layer stands in the provider). */
function DatabaseCell({ rowId, column, value, onChange }: DatabaseCellProps) {
  const annotation: BridgeColumnAnnotation = columnAnnotation(column);
  const empty = value === undefined || value === null || value === "";
  if (Array.isArray(value)) {
    return (
      <div
        data-slot="docblocks/database-cell"
        data-column-id={column.id}
        data-empty
        className="
          min-w-28 border-l-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color)
          px-(--docblocks-table-cell-padding) py-1 text-(length:--docblocks-font-size)
          text-(--docblocks-placeholder-color)
        "
      >
        {value.join(", ")}
      </div>
    );
  }
  switch (annotation.valueInput) {
    case "number":
      return (
        <div
          className="
            min-w-28 border-l-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color)
            p-(--docblocks-table-cell-padding)
          "
        >
          <input
            key={`${rowId}:${column.id}:${String(value ?? "")}`}
            type="number"
            data-slot="docblocks/database-cell"
            data-column-id={column.id}
            data-empty={empty ? "true" : undefined}
            className="
              w-full rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
              border-(--docblocks-table-border-color) bg-transparent px-1 text-(length:--docblocks-font-size)
              outline-none
            "
            defaultValue={value === undefined || value === null ? "" : String(value)}
            onBlur={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            }}
          />
        </div>
      );
    case "boolean":
      return (
        <div
          className="
            flex min-w-28 items-center border-l-(length:--docblocks-table-border-width)
            border-(--docblocks-table-border-color) p-(--docblocks-table-cell-padding)
          "
        >
          <input
            type="checkbox"
            data-slot="docblocks/database-cell"
            data-column-id={column.id}
            defaultChecked={value === true}
            onChange={(event) => onChange(event.target.checked)}
            className="size-4 cursor-pointer accent-(--docblocks-link-color)"
          />
        </div>
      );
    case "date":
      return (
        <div
          className="
            min-w-28 border-l-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color)
            p-(--docblocks-table-cell-padding)
          "
        >
          <input
            key={`${rowId}:${column.id}:${String(value ?? "")}`}
            type="date"
            data-slot="docblocks/database-cell"
            data-column-id={column.id}
            className="
              w-full rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
              border-(--docblocks-table-border-color) bg-transparent px-1 text-(length:--docblocks-font-size)
              outline-none
            "
            defaultValue={value === undefined || value === null ? "" : String(value)}
            onBlur={(event) => onChange(event.target.value === "" ? null : event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            }}
          />
        </div>
      );
    case "select":
      return (
        <div
          className="
            min-w-28 border-l-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color)
            p-(--docblocks-table-cell-padding)
          "
        >
          <select
            key={`${rowId}:${column.id}:${String(value ?? "")}`}
            data-slot="docblocks/database-cell"
            data-column-id={column.id}
            className="
              w-full rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
              border-(--docblocks-table-border-color) bg-transparent px-1 text-(length:--docblocks-font-size)
              outline-none
            "
            defaultValue={value === undefined || value === null ? "" : String(value)}
            onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
          >
            <option value="">—</option>
            {(column.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      );
    default:
      return (
        <div
          className="
            min-w-28 border-l-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color)
            p-(--docblocks-table-cell-padding)
          "
        >
          <input
            key={`${rowId}:${column.id}:${String(value ?? "")}`}
            type="text"
            data-slot="docblocks/database-cell"
            data-column-id={column.id}
            data-empty={empty ? "true" : undefined}
            className="
              w-full rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
              border-(--docblocks-table-border-color) bg-transparent px-1 text-(length:--docblocks-font-size)
              outline-none
            "
            placeholder="—"
            defaultValue={value === undefined || value === null ? "" : String(value)}
            onBlur={(event) => onChange(event.target.value === "" ? null : event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            }}
          />
        </div>
      );
  }
}

export { DatabaseGrid, visibleColumns };
