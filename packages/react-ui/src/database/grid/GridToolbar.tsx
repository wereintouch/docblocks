/**
 * The grid's toolbar: the table's display name (the bridge's table name —
 * the name is the table's attribute, every block over the tableId stands
 * it live; the rename's entry stands off over the read-only / the
 * standalone's stands), the row count, the grid undo/redo (the bridge's
 * forward-only history — the doc-undo does not cover the table rows), the
 * column manager, and the filter popover (the draft stands the apply's
 * press — the close stands no write).
 */
import { useTranslation } from "react-i18next";

import { useState } from "react";

import type { DatabaseFilterPayload } from "docblocks-core";

import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { InlineEditInput } from "../../shared/ui/InlineEditInput";
import { Popover, PopoverContent, PopoverTrigger } from "../../shared/ui/Popover";
import { cn } from "../../shared/ui/cn";
import type { BridgeTableDescription } from "../bridge";
import { FilterBuilder, emptyFilter, filterIsComplete } from "../filter-builder";
import { useDatabaseTable } from "../use-database-table";
import { ColumnManager } from "./ColumnManager";
import { GRID_CHROME_FRAME } from "./constants";
import type { RefTableDataMap } from "./use-ref-tables";

interface GridToolbarProps {
  tableId: string;
  table: BridgeTableDescription;
  data: ReturnType<typeof useDatabaseTable>;
  filter?: DatabaseFilterPayload;
  columnOrder?: string[];
  hiddenColumns?: string[];
  columnWidths?: number[];
  onViewChange: (patch: Record<string, unknown>) => void;
  refTableData: RefTableDataMap;
  /** The name's display stand (the standalone's stand is off — the
   *  consumer's heading stands the name). */
  showName: boolean;
  /** The read-only stand (the view / published's modes). */
  readOnly?: boolean;
}

function GridToolbar({
  tableId,
  table,
  data,
  filter,
  columnOrder,
  hiddenColumns,
  columnWidths,
  onViewChange,
  refTableData,
  showName,
  readOnly = false,
}: GridToolbarProps) {
  const { t } = useTranslation("database");
  const [nameEditing, setNameEditing] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<DatabaseFilterPayload | null>(filter ?? null);

  // --- The display name: the bridge's table name (the name is the
  //     table's attribute — every block over the tableId stands it live;
  //     the block's legacy `name` attr is ignored over the display).
  const displayName = data.table?.name ?? tableId;
  // The standalone's stand (the block's id's absence — the consumer's own
  // page's table): the table's name stands off — the standalone's grid is
  // the consumer's own visual element (the consumer's heading stands the
  // name), so the toolbar keeps no name display or rename over it.

  const commitName = (draft: string) => {
    setNameEditing(false);
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === data.table?.name) return;
    // The rename is the bridge's (the table's attribute): every block over
    // the tableId stands the new name over the table event — no doc write,
    // the grid's undo stack covers it.
    void data.renameTable(trimmed).catch(() => undefined);
  };
  const undoStep = () => void data.undo().catch(() => undefined);
  const redoStep = () => void data.redo().catch(() => undefined);
  const applyFilter = () => {
    onViewChange({ filter: filterDraft });
    setFilterOpen(false);
  };
  const onFilterOpenChange = (open: boolean) => {
    setFilterOpen(open);
    if (open) setFilterDraft(filter ?? null);
  };
  const resetFilterDraft = () => setFilterDraft(emptyFilter());

  return (
    <div data-slot="docblocks/database-toolbar" className="flex flex-wrap items-center gap-2">
      {showName &&
        (nameEditing ? (
          <InlineEditInput
            size="sm"
            initial={displayName}
            selectOnMount
            ariaLabel={t("renameTable.aria", { name: displayName })}
            slot="docblocks/database-name-input"
            className={cn(
              GRID_CHROME_FRAME,
              `h-auto min-w-32 px-1 py-0.5 text-(length:--docblocks-font-size) font-(--docblocks-heading-font-weight)`
            )}
            onCommit={commitName}
            onCancel={() => setNameEditing(false)}
          />
        ) : readOnly ? (
          // The read-only stand (view / published): the name's display is
          // plain (the rename's entry is off).
          <span data-slot="docblocks/database-name" className="font-(--docblocks-heading-font-weight)">
            {displayName}
          </span>
        ) : (
          <Button
            data-slot="docblocks/database-name"
            variant="ghost"
            size="sm"
            title={t("common:rename")}
            className={
              // The frame-less stand (the look's own: no border) — the
              // primitive's chrome frame stands off.
              " h-auto cursor-text border-0 bg-transparent px-1 text-(length:--docblocks-font-size) " +
              "font-(--docblocks-heading-font-weight) hover:bg-transparent hover:opacity-70 " +
              "hover:text-inherit dark:bg-transparent dark:hover:bg-transparent"
            }
            onClick={() => setNameEditing(true)}
          >
            {displayName}
          </Button>
        ))}
      <Badge data-slot="docblocks/database-count" variant="secondary">
        {data.rows.length} {t("rowCount", { count: data.rows.length })}
      </Badge>
      <div className="ml-auto flex items-center gap-2">
        {readOnly ? null : (
          <>
            <Button
              data-slot="docblocks/database-undo"
              variant="outline"
              size="sm"
              data-disabled={data.canUndo ? undefined : true}
              disabled={!data.canUndo}
              onClick={undoStep}
            >
              {t("toolbar.undo")}
            </Button>
            <Button
              data-slot="docblocks/database-redo"
              variant="outline"
              size="sm"
              data-disabled={data.canRedo ? undefined : true}
              disabled={!data.canRedo}
              onClick={redoStep}
            >
              {t("toolbar.redo")}
            </Button>
          </>
        )}
        {readOnly ? null : (
          <ColumnManager
            columns={table.columns}
            columnOrder={columnOrder}
            hiddenColumns={hiddenColumns}
            columnWidths={columnWidths}
            onViewChange={onViewChange}
          />
        )}
        {readOnly ? null : (
          <Popover open={filterOpen} onOpenChange={onFilterOpenChange}>
            <PopoverTrigger asChild>
              <Button
                data-slot="docblocks/database-filter"
                variant="outline"
                size="sm"
                data-active={filter !== undefined && filter.conditions.length > 0 ? "true" : undefined}
              >
                {t("toolbar.filter")}
                {filter !== undefined && filter.conditions.length > 0 ? " •" : ""}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-fit max-w-xl min-w-110">
              <div className="flex flex-col gap-2.5">
                <FilterBuilder
                  value={filterDraft}
                  columns={table.columns}
                  onChange={setFilterDraft}
                  refTableData={refTableData}
                />
                {/* The footer's stand: the apply/clear over the separator's line (not stuck to the add rows — the popover's own 10px rhythm over both sides of the line). */}
                <div
                  data-slot="docblocks/filter-footer"
                  className="flex items-center gap-2 border-t border-border pt-2.5"
                >
                  <Button data-slot="docblocks/filter-clear" variant="outline" size="sm" onClick={resetFilterDraft}>
                    {t("common:clear")}
                  </Button>
                  <Button
                    data-slot="docblocks/filter-apply"
                    variant="outline"
                    size="sm"
                    disabled={!filterIsComplete(filterDraft, table.columns)}
                    className="bg-accent text-accent-foreground"
                    onClick={applyFilter}
                  >
                    {t("toolbar.apply")}
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

export { GridToolbar };
export type { GridToolbarProps };
