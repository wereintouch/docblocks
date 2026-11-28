import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import type { UseDatabaseTable } from "../use-database-table";
import { clearGridCells, selectedGridRowIds } from "./grid-cell-actions";

interface GridRangeMenuContext {
  selectedCells: Set<string>;
  data: UseDatabaseTable;
  readOnly: boolean;
  onAction?: () => void;
}

interface GridRangePoint {
  x: number;
  y: number;
}

/** Opens the selected range's menu at the right-click release point. */
function useGridRangeMenu({ selectedCells, data, readOnly, onAction }: GridRangeMenuContext) {
  const [anchor, setAnchor] = useState<GridRangePoint | null>(null);
  const pendingOpenRef = useRef<(() => void) | null>(null);

  const onTableContextMenu = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (readOnly || selectedCells.size <= 1) return;
    const target = event.target instanceof Element ? event.target : null;
    const cell = target?.closest<HTMLElement>("[data-slot='docblocks/database-cell'][data-key]");
    if (cell == null || !selectedCells.has(cell.dataset.key ?? "")) return;
    event.preventDefault();
    pendingOpenRef.current?.();
    const open = (x: number, y: number) => setAnchor({ x, y });
    if (event.buttons === 0) {
      const task = window.setTimeout(() => {
        pendingOpenRef.current = null;
        open(event.clientX, event.clientY);
      }, 0);
      pendingOpenRef.current = () => window.clearTimeout(task);
      return;
    }
    // Opening under a held right button lets its release select the first item.
    const onUp = (up: PointerEvent) => {
      if (up.button !== 2) {
        window.addEventListener("pointerup", onUp, { once: true });
        return;
      }
      pendingOpenRef.current = null;
      open(up.clientX, up.clientY);
    };
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    pendingOpenRef.current = () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  };

  const clearRange = (): void => {
    onAction?.();
    void clearGridCells(selectedCells, data).catch(() => undefined);
  };
  const deleteRows = (): void => {
    onAction?.();
    void data.removeRows(selectedGridRowIds(selectedCells)).catch(() => undefined);
  };
  const onOpenChange = (open: boolean): void => {
    if (!open) setAnchor(null);
  };

  useEffect(() => {
    if (selectedCells.size > 1) return;
    pendingOpenRef.current?.();
    pendingOpenRef.current = null;
    setAnchor(null);
  }, [selectedCells]);

  useEffect(
    () => () => {
      pendingOpenRef.current?.();
      pendingOpenRef.current = null;
    },
    []
  );

  return { anchor, clearRange, deleteRows, onOpenChange, onTableContextMenu };
}

export { useGridRangeMenu };
export type { GridRangePoint };
