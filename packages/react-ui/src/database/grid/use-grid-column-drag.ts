/** The database grid's column drag: the header cell's press + drag (the
 * live parting preview — the dragged column's own cells stand the pointer's
 * dx, the stationary ones the parting shift), the drop index measurement
 * (the stationary headers' midpoints against the table's left edge), the
 * release (a sub-threshold press stands nothing; a drag commits the visible
 * order with the dragged column at the drop index after validating the live
 * columns against the press-time snapshot — a peer restructure stands no
 * commit), and the cancel. The preview's state stands in the hook (the view
 * reads the dragged column's live dx + the parting shift). */
import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import type { BridgeColumn } from "../bridge";
import { DRAG_START_THRESHOLD_PX } from "./constants";
import type { ColumnDragSession } from "./models";

interface GridColumnDragDeps {
  /** The visible columns (the press-time snapshot's source). */
  columns: BridgeColumn[];
  /** The view's commit (the column order's `updateBlock`). */
  updateView: (patch: Record<string, unknown>) => void;
  /** The table element (the live DOM — the drop measurement reads it). */
  tableRef: RefObject<HTMLDivElement | null>;
}

function useGridColumnDrag({ columns, updateView, tableRef }: GridColumnDragDeps) {
  // The column drag session (the header cell's press).
  const [drag, setDrag] = useState<{ id: string; dx: number; toIndex: number | null; startWidth: number } | null>(null);
  const dragSession = useRef<ColumnDragSession | null>(null);

  // --- The column drag session (the header cell's press).
  const onColumnPointerDown = (column: BridgeColumn, event: ReactPointerEvent<HTMLDivElement>) => {
    // The menu's own controls (the Ellipsis trigger, the rename input) own
    // their presses: no drag session over them. The menu's content stands
    // portaled outside the cell's DOM — but inside its REACT tree, so a
    // press on a menu item still bubbles to this handler (the synthetic
    // dispatch follows the React tree): the capture over the portaled
    // content would retarget the item's pointerup and swallow its click.
    if (
      event.target instanceof Element &&
      event.target.closest('[data-slot="docblocks/database-column-menu"], [role="menu"]')
    ) {
      return;
    }
    const index = columns.findIndex((entry) => entry.id === column.id);
    if (index === -1) return;
    dragSession.current = {
      columnId: column.id,
      index,
      startX: event.clientX,
      ids: columns.map((entry) => entry.id),
      started: false,
      startWidth: event.currentTarget.getBoundingClientRect().width,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onColumnPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSession.current;
    if (session === null) return;
    const dx = event.clientX - session.startX;
    if (!session.started && Math.abs(dx) < DRAG_START_THRESHOLD_PX) return;
    session.started = true;
    setDrag({
      id: session.columnId,
      dx,
      toIndex: columnDropIndexAt(event.clientX, session.columnId),
      startWidth: session.startWidth,
    });
  };

  /** The drop index (the dragged column's final visible index) for a
   *  pointer x: the stationary headers' midpoints (the dragged column's
   *  live position is excluded) — the position among the stationary
   *  columns IS the final visible index (the splice into the stationary
   *  order). The release's commit and the parting preview share the
   *  measurement. */
  const columnDropIndexAt = (clientX: number, excludeId: string): number | null => {
    const table = tableRef.current;
    if (table === null) return null;
    const midpoints: number[] = [];
    table.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-header-cell']").forEach((cell) => {
      if (cell.dataset.columnId === excludeId) return;
      const rect = cell.getBoundingClientRect();
      midpoints.push(rect.left + rect.width / 2);
    });
    if (midpoints.length === 0) return null;
    midpoints.sort((a, b) => a - b);
    let position = 0;
    for (const mid of midpoints) {
      if (clientX > mid) position += 1;
    }
    return position;
  };

  const onColumnPointerUp = (column: BridgeColumn, event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSession.current;
    dragSession.current = null;
    if (session === null) return;
    if (!session.started) {
      // A sub-threshold press (a click) on the header's zone stands nothing:
      // the properties' menu opens only over the Ellipsis's own press (the
      // Radix trigger — a press without movement past the threshold). The
      // name zone's cursor-grab is the drag's affordance; a click there is
      // a no-op (the drag is a past-threshold press).
      return;
    }
    setDrag(null);
    // The stale-drop guard: the visible column sequence must stand as at
    // the press (a peer added / removed / renamed-structurally a column
    // mid-drag invalidates the drop — no commit, the grid resyncs).
    if (!columns.map((entry) => entry.id).every((value, i) => session.ids[i] === value)) return;
    // The drop position among the stationary columns (the live preview's
    // measurement, re-read at the release).
    const toIndex = columnDropIndexAt(event.clientX, session.columnId);
    if (toIndex === null || toIndex === session.index) return;
    // The commit: the visible order with the dragged column at the drop
    // index (the hidden columns keep the schema tail — the attr lists the
    // visible order only).
    const ids = session.ids.filter((value) => value !== session.columnId);
    ids.splice(toIndex, 0, session.columnId);
    updateView({ columnOrder: ids });
  };

  // --- The cell selection (pure view state): the single click stands the
  //     one cell, the press-drag stands the rectangle (the region between
  //     the anchor and the hovered cell), the double click stands the edit

  return {
    drag,
    onColumnPointerDown,
    onColumnPointerMove,
    onColumnPointerUp,
  };
}

export { useGridColumnDrag };
