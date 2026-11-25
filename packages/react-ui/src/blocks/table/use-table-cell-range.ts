/**
 * The table cell range's session: the grip drag that selects a rectangle of
 * cells (the merge / split gesture's stand, the cell's text selection is
 * untouched). The range is view state — the store's `tableRange` slice — not
 * document data: it never travels the wire and the doc commands read it, not
 * the other way round.
 *
 * The gesture: a press on the hovered cell's corner grip starts the range at
 * that cell, the drag extends it over the cells under the pointer, the
 * release keeps it. Escape clears it. Every coordinate comes from the grid
 * resolver (a merged region stands one cell over several coordinates).
 */
import { useStore } from "zustand";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { resolveTableGrid } from "docblocks-core";
import type { BlockId, Doc, GridAnchor } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";
import type { TableCellRange, TableCellRangeRect } from "../../state";
import type { CellRangeSession } from "./models";
import type { TableCellRangeHandlers } from "./table-range-context";

/** The anchor of the cell in the resolved grid (null for an unknown id). */
function anchorOfId(doc: Doc, tableId: BlockId, cellId: BlockId): GridAnchor | null {
  const grid = resolveTableGrid(doc.raw, tableId);
  if (grid === null) return null;
  for (const line of grid.rows) {
    for (const anchor of line) if (anchor.id === cellId) return anchor;
  }
  return null;
}

/**
 * The range between two anchor cells: their rectangles' union. A region the
 * union touches joins it WHOLE (a selection never cuts a merged cell — a
 * cut rectangle would show a frame in the middle of a region and a merge
 * over it would take cells the reader did not select).
 */
function rangeOfAnchors(doc: Doc, tableId: BlockId, from: GridAnchor, to: GridAnchor): TableCellRange | null {
  const grid = resolveTableGrid(doc.raw, tableId);
  if (grid === null) return null;
  let top = Math.min(from.row, to.row);
  let left = Math.min(from.col, to.col);
  let bottom = Math.max(from.row + from.rowspan - 1, to.row + to.rowspan - 1);
  let right = Math.max(from.col + from.colspan - 1, to.col + to.colspan - 1);
  for (let guard = 0; guard < 8; guard += 1) {
    let grew = false;
    for (const anchor of grid.anchorsIn(top, left, bottom, right)) {
      if (anchor.row < top) {
        top = anchor.row;
        grew = true;
      }
      if (anchor.col < left) {
        left = anchor.col;
        grew = true;
      }
      if (anchor.row + anchor.rowspan - 1 > bottom) {
        bottom = anchor.row + anchor.rowspan - 1;
        grew = true;
      }
      if (anchor.col + anchor.colspan - 1 > right) {
        right = anchor.col + anchor.colspan - 1;
        grew = true;
      }
    }
    if (!grew) break;
  }
  const anchors = grid.anchorsIn(top, left, bottom, right);
  if (anchors.length === 0) return null;
  const cells: Record<BlockId, TableCellRangeRect> = {};
  for (const anchor of anchors) {
    cells[anchor.id] = { row: anchor.row, col: anchor.col, colspan: anchor.colspan, rowspan: anchor.rowspan };
  }
  return { tableId, top, left, bottom, right, cellIds: anchors.map((anchor) => anchor.id), cells };
}

/**
 * The cell whose BOX holds the point: the geometry's stand, never the
 * top-most element — the table's chrome (the seams, the handles, the chips)
 * overlays the grid, and a covered region's interior boundary stands no cell
 * to hit. `null` when the point stands outside the cells.
 */
function cellAtPoint(table: HTMLTableElement | null, clientX: number, clientY: number): BlockId | null {
  if (table === null) return null;
  for (const td of table.querySelectorAll<HTMLTableCellElement>("td[data-block-id]")) {
    const box = td.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom) {
      return td.dataset.blockId ?? null;
    }
  }
  return null;
}

/** The table cell range's slice for one table (null when the range stands elsewhere / nowhere). */
function useTableRangeOf(tableId: BlockId): TableCellRange | null {
  const { store } = useEditorContext();
  return useStore(store, (state) => (state.tableRange?.tableId === tableId ? state.tableRange : null));
}

/** The range's bitmask: the cell's membership + the frame's edges. */
const RANGE_SELECTED = 1;
const RANGE_EDGE_TOP = 2;
const RANGE_EDGE_RIGHT = 4;
const RANGE_EDGE_BOTTOM = 8;
const RANGE_EDGE_LEFT = 16;

/**
 * The cell's range stand as a bitmask (a primitive — the selector keeps the
 * cells' re-render scope to their own membership / edges): the membership bit
 * and the frame's edges the cell stands on the rectangle's boundary.
 */
function useTableCellRangeMask(cellId: BlockId): number {
  const { store } = useEditorContext();
  return useStore(store, (state) => {
    const range = state.tableRange;
    if (range === null) return 0;
    const rect = range.cells[cellId];
    if (rect === undefined) return 0;
    let mask = RANGE_SELECTED;
    if (rect.row === range.top) mask |= RANGE_EDGE_TOP;
    if (rect.col === range.left) mask |= RANGE_EDGE_LEFT;
    if (rect.row + rect.rowspan - 1 === range.bottom) mask |= RANGE_EDGE_BOTTOM;
    if (rect.col + rect.colspan - 1 === range.right) mask |= RANGE_EDGE_RIGHT;
    return mask;
  });
}

/** The range's setter (the clear stands `null`). */
function useSetTableCellRange(): (range: TableCellRange | null) => void {
  const { store } = useEditorContext();
  return useStore(store, (state) => state.setTableCellRange);
}

interface UseCellRangeArgs {
  doc: Doc;
  tableId: BlockId;
  /** The live table element (the point hit-test's frame). */
  tableEl: () => HTMLTableElement | null;
}

/** The grip's drag session over one table. */
function useTableCellRange({ doc, tableId, tableEl }: UseCellRangeArgs) {
  const setRange = useSetTableCellRange();
  const sessionRef = useRef<CellRangeSession | null>(null);

  const onGripPointerDown = useCallback(
    (cellId: BlockId) => (event: ReactPointerEvent<HTMLElement>) => {
      const anchor = anchorOfId(doc, tableId, cellId);
      if (anchor === null) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      sessionRef.current = { pointerId: event.pointerId, origin: anchor };
      setRange(rangeOfAnchors(doc, tableId, anchor, anchor));
    },
    [doc, tableId, setRange]
  );

  const onGripPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (session === null || session.pointerId !== event.pointerId) return;
      const cellId = cellAtPoint(tableEl(), event.clientX, event.clientY);
      if (cellId === null) return; // outside the cells (the frame's padding): the range keeps its stand
      const anchor = anchorOfId(doc, tableId, cellId);
      if (anchor === null) return;
      setRange(rangeOfAnchors(doc, tableId, session.origin, anchor));
    },
    [doc, tableId, setRange, tableEl]
  );

  const onGripPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const session = sessionRef.current;
    if (session === null || session.pointerId !== event.pointerId) return;
    sessionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const clearRange = useCallback(() => setRange(null), [setRange]);

  return { onGripPointerDown, onGripPointerMove, onGripPointerUp, clearRange };
}

/**
 * The table's range wiring: the grip's handlers (the context value) and the
 * Escape cancel. The table component hands the handlers to the cells and
 * keeps the range's own read for the menu's stand.
 */
function useTableCellRangeWiring({ doc, tableId, tableEl }: UseCellRangeArgs) {
  const session = useTableCellRange({ doc, tableId, tableEl });
  const rangeHandlers = useMemo<TableCellRangeHandlers>(
    () => ({
      onGripPointerDown: session.onGripPointerDown,
      onGripPointerMove: session.onGripPointerMove,
      onGripPointerUp: session.onGripPointerUp,
    }),
    [session.onGripPointerDown, session.onGripPointerMove, session.onGripPointerUp]
  );
  const range = useTableRangeOf(tableId);
  const { clearRange } = session;
  // A structural change (a merge, a reorder, an insert) moves the cells the
  // range's rectangles were read from: the selection resets rather than
  // marking coordinates that no longer stand.
  const { store } = useEditorContext();
  const chromeStamp = useStore(store, (state) => state.chromeStamp);
  const stampRef = useRef(chromeStamp);
  useEffect(() => {
    if (stampRef.current === chromeStamp) return;
    stampRef.current = chromeStamp;
    if (range !== null && range.tableId === tableId) clearRange();
  }, [chromeStamp, range, tableId, clearRange]);
  useEffect(() => {
    if (range === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") clearRange();
    };
    // A press on the document's content outside the table's cells (an empty
    // place, a paragraph, another table) clears the range. The portaled
    // layers (the cell menu) and the consumer's chrome stand outside the
    // editor root and never clear it — their own press is the menu's.
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const cell = target.closest("td[data-block-id]");
      if (cell !== null && cell.closest(`[data-block-id="${tableId}"]`) !== null) return;
      if (target.closest('[data-slot="docblocks/editor"]') === null) return;
      if (cell === null && target.closest(`[data-block-id="${tableId}"]`) !== null) return;
      clearRange();
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [range, tableId, clearRange]);
  return { rangeHandlers, range };
}

export {
  anchorOfId,
  cellAtPoint,
  clearTableRangeOnEscape,
  rangeOfAnchors,
  useSetTableCellRange,
  RANGE_EDGE_BOTTOM,
  RANGE_EDGE_LEFT,
  RANGE_EDGE_RIGHT,
  RANGE_EDGE_TOP,
  RANGE_SELECTED,
  useTableCellRange,
  useTableCellRangeMask,
  useTableCellRangeWiring,
  useTableRangeOf,
};

/** The Escape key clears the range (the window-level listener's stand). */
function clearTableRangeOnEscape(clear: () => void): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    if (event.key === "Escape") clear();
  };
}
