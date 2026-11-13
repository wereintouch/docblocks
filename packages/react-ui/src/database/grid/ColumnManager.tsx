import { Reorder, useDragControls } from "framer-motion";
import { useTranslation } from "react-i18next";

import { useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import { Button } from "../../shared/ui/Button";
import { Checkbox } from "../../shared/ui/Checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "../../shared/ui/Popover";
import { cn } from "../../shared/ui/cn";
import { GripVertical } from "../../shared/ui/icons";
import type { BridgeColumn } from "../bridge";
import { normalizeColumnOrder, reorderItems, visibleColumns } from "./utils";

interface ColumnManagerProps {
  columns: BridgeColumn[];
  columnOrder?: string[];
  hiddenColumns?: string[];
  columnWidths?: number[];
  triggerClassName?: string;
  onViewChange: (patch: Record<string, unknown>) => void;
}

interface ColumnRowProps {
  column: BridgeColumn;
  hidden: boolean;
  hideDisabled: boolean;
  onToggle: (columnId: string) => void;
  onMove: (columnId: string, delta: number) => void;
  onDragStart: () => void;
  onDragEnd: (columnId: string) => void;
}

function ColumnRow({ column, hidden, hideDisabled, onToggle, onMove, onDragStart, onDragEnd }: ColumnRowProps) {
  const { t } = useTranslation("database");
  const dragControls = useDragControls();
  const onGripPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    dragControls.start(event);
  };
  const onGripKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    onMove(column.id, event.key === "ArrowUp" ? -1 : 1);
  };
  const onVisibilityChange = () => onToggle(column.id);
  const onReorderEnd = () => onDragEnd(column.id);

  return (
    <Reorder.Item
      as="div"
      value={column.id}
      dragListener={false}
      dragControls={dragControls}
      onDragStart={onDragStart}
      onDragEnd={onReorderEnd}
      className="flex items-center gap-1 rounded-sm px-1 py-0.5 text-sm"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-slot="docblocks/database-column-move"
        data-column-id={column.id}
        aria-label={t("columns.move", { name: column.name })}
        className="size-6 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing"
        onPointerDown={onGripPointerDown}
        onKeyDown={onGripKeyDown}
      >
        <GripVertical className="size-3.5" />
      </Button>
      <span className={cn("min-w-0 flex-1 truncate px-1", hidden && "text-muted-foreground")}>{column.name}</span>
      <Checkbox
        data-slot="docblocks/database-column-visibility"
        data-column-id={column.id}
        aria-label={t("columns.visibility", { name: column.name })}
        checked={!hidden}
        disabled={hideDisabled}
        onCheckedChange={onVisibilityChange}
      />
    </Reorder.Item>
  );
}

function ColumnManager({
  columns,
  columnOrder,
  hiddenColumns,
  columnWidths,
  triggerClassName,
  onViewChange,
}: ColumnManagerProps) {
  const { t } = useTranslation("database");
  const [open, setOpen] = useState(false);
  const [draftOrder, setDraftOrder] = useState<string[] | null>(null);
  const dragStartOrderRef = useRef<string[] | null>(null);
  const normalizedOrder = normalizeColumnOrder(columns, columnOrder);
  const order = draftOrder ?? normalizedOrder;
  const hidden = new Set(hiddenColumns ?? []);
  const hiddenCount = columns.filter((column) => hidden.has(column.id)).length;
  const visibleCount = columns.length - hiddenCount;

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setDraftOrder(null);
  };
  const commitOrder = (columnId: string, nextOrder: string[], previousOrder: string[]) => {
    if (nextOrder.every((id, index) => id === previousOrder[index])) return;
    const previousVisible = visibleColumns(columns, previousOrder, hiddenColumns).map((column) => column.id);
    const nextVisible = visibleColumns(columns, nextOrder, hiddenColumns).map((column) => column.id);
    const fromIndex = previousVisible.indexOf(columnId);
    const toIndex = nextVisible.indexOf(columnId);
    onViewChange({
      columnOrder: nextOrder,
      ...(columnWidths !== undefined ? { columnWidths: reorderItems(columnWidths, fromIndex, toIndex) } : {}),
    });
    setDraftOrder(nextOrder);
  };
  const onDragStart = () => {
    dragStartOrderRef.current = order;
  };
  const onDragEnd = (columnId: string) => {
    const previousOrder = dragStartOrderRef.current ?? order;
    dragStartOrderRef.current = null;
    if (draftOrder !== null) commitOrder(columnId, draftOrder, previousOrder);
  };
  const onMove = (columnId: string, delta: number) => {
    const fromIndex = order.indexOf(columnId);
    const toIndex = fromIndex + delta;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= order.length) return;
    commitOrder(columnId, reorderItems(order, fromIndex, toIndex), order);
  };
  const onToggle = (columnId: string) => {
    const isHidden = hidden.has(columnId);
    if (!isHidden && visibleCount === 1) return;
    const nextHidden = isHidden ? [...hidden].filter((id) => id !== columnId) : [...hidden, columnId];
    onViewChange({ hiddenColumns: nextHidden });
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          data-slot="docblocks/database-columns"
          variant="outline"
          size="sm"
          data-active={hiddenCount > 0 ? "true" : undefined}
          className={triggerClassName}
        >
          {t("toolbar.columns")}
          {hiddenCount > 0 ? " •" : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        data-slot="docblocks/database-columns-content"
        aria-label={t("toolbar.columns")}
        align="end"
        className="w-72 p-2"
      >
        <Reorder.Group
          as="div"
          axis="y"
          values={order}
          onReorder={setDraftOrder}
          className="flex max-h-80 scrollbar-thin flex-col gap-0.5 overflow-y-auto"
        >
          {order.map((columnId) => {
            const column = columns.find((entry) => entry.id === columnId);
            if (column === undefined) return null;
            return (
              <ColumnRow
                key={column.id}
                column={column}
                hidden={hidden.has(column.id)}
                hideDisabled={!hidden.has(column.id) && visibleCount === 1}
                onToggle={onToggle}
                onMove={onMove}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            );
          })}
        </Reorder.Group>
      </PopoverContent>
    </Popover>
  );
}

export { ColumnManager };
