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
import { normalizeColumnOrder, pointerYOf, reorderItems, visibleColumns } from "./utils";

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
  onDragEnd: (columnId: string, event: PointerEvent | MouseEvent | TouchEvent) => void;
}

function ColumnRow({ column, hidden, hideDisabled, onToggle, onMove, onDragEnd }: ColumnRowProps) {
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
  // The release's commit input (the pointer's true's release position's
  // stand over the drag's tracked position's stand — the framer's rAF's
  // tick lags over the slow engine's input's batching, and the tracked's
  // lag stands the last slot's miss over the commit).
  const onReorderEnd = (event: PointerEvent | MouseEvent | TouchEvent) => onDragEnd(column.id, event);

  return (
    <Reorder.Item
      as="div"
      value={column.id}
      dragListener={false}
      dragControls={dragControls}
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
  const groupRef = useRef<HTMLDivElement | null>(null);
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
  // The release's commit (the pointer's true's release position's stand):
  // the rows' midpoints' hit test over the current display's order (the
  // preview's cascade's stand) — the page row's release's parity (the
  // draft's preview-only's stand; the framer's onDragEnd's native event's
  // coordinate over the drag's tracked position's stand).
  const commitAtPointer = (columnId: string, clientY: number): void => {
    const group = groupRef.current;
    if (group === null) return;
    const rows = Array.from(group.children).filter((row): row is HTMLElement => row instanceof HTMLElement);
    const displayed = rows
      .map((row) =>
        row.querySelector<HTMLElement>("[data-slot='docblocks/database-column-move']")?.getAttribute("data-column-id")
      )
      .filter((id): id is string => id !== null);
    if (displayed.length === 0 || displayed.includes(columnId) === false) return;
    // The committed's order (the prop's stand) is the commit's previous —
    // the drag's cascade preview stays uncommitted until release, and the
    // widths' rebase maps over the committed widths' order.
    const previousOrder = normalizedOrder;
    const others = displayed.filter((id) => id !== columnId);
    let insertAt = 0;
    for (const row of rows) {
      const id = row
        .querySelector<HTMLElement>("[data-slot='docblocks/database-column-move']")
        ?.getAttribute("data-column-id");
      if (id === null || id === columnId) continue;
      const rect = row.getBoundingClientRect();
      if (clientY > rect.top + rect.height / 2) insertAt += 1;
    }
    const newVisible = [...others.slice(0, insertAt), columnId, ...others.slice(insertAt)];
    // The full order's stand: the new visible order re-placed over the
    // committed's visible slots (the hidden's columns keep the committed's
    // positions — the framer's reorder's reconstruction's parity).
    const visibleIds = new Set(newVisible);
    const visibleSlots = normalizedOrder
      .map((id, index) => (visibleIds.has(id) ? index : -1))
      .filter((index) => index >= 0);
    const nextOrder = [...normalizedOrder];
    newVisible.forEach((id, slot) => {
      const target = visibleSlots[slot];
      if (target !== undefined) nextOrder[target] = id;
    });
    // The release in place stands the preview's snap-back (the cascade's
    // draft's keep would stand the popover's rows over the committed's order).
    if (nextOrder.every((id, index) => id === previousOrder[index])) {
      setDraftOrder(null);
      return;
    }
    commitOrder(columnId, nextOrder, previousOrder);
  };
  const onDragEnd = (columnId: string, event: PointerEvent | MouseEvent | TouchEvent) => {
    const pointerY = pointerYOf(event);
    if (pointerY === null) {
      setDraftOrder(null); // the stale's release's stand (the preview's snap-back)
      return;
    }
    commitAtPointer(columnId, pointerY);
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
          data-disabled={columns.length === 0 ? true : undefined}
          disabled={columns.length === 0}
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
          ref={groupRef}
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
