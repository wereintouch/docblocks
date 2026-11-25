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

/** The grid rectangle between two cells' coordinates (the corners' stand). */
function rangeBetween(
  doc: Doc,
  tableId: BlockId,
  from: { row: number; col: number },
  to: { row: number; col: number }
): TableCellRange | null {
  const grid = resolveTableGrid(doc.raw, tableId);
  if (grid === null) return null;
  const top = Math.min(from.row, to.row);
  const bottom = Math.max(from.row, to.row);
  const left = Math.min(from.col, to.col);
  const right = Math.max(from.col, to.col);
  const anchors = grid.anchorsIn(top, left, bottom, right);
  if (anchors.length === 0) return null;
  const cells: Record<BlockId, TableCellRangeRect> = {};
  for (const anchor of anchors) {
    cells[anchor.id] = { row: anchor.row, col: anchor.col, colspan: anchor.colspan, rowspan: anchor.rowspan };
  }
  return { tableId, top, left, bottom, right, cellIds: anchors.map((anchor) => anchor.id), cells };
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
}

/** The grip's drag session over one table. */
function useTableCellRange({ doc, tableId }: UseCellRangeArgs) {
  const setRange = useSetTableCellRange();
  const sessionRef = useRef<CellRangeSession | null>(null);

  const onGripPointerDown = useCallback(
    (cellId: BlockId) => (event: ReactPointerEvent<HTMLElement>) => {
      const anchor = anchorOfId(doc, tableId, cellId);
      if (anchor === null) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      sessionRef.current = { pointerId: event.pointerId, origin: { row: anchor.row, col: anchor.col } };
      setRange(rangeBetween(doc, tableId, sessionRef.current.origin, sessionRef.current.origin));
    },
    [doc, tableId, setRange]
  );

  const onGripPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (session === null || session.pointerId !== event.pointerId) return;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const cell = element?.closest<HTMLElement>("td[data-block-id]");
      const cellId = cell?.dataset.blockId;
      if (cellId === undefined) return;
      const anchor = anchorOfId(doc, tableId, cellId);
      if (anchor === null) return;
      setRange(rangeBetween(doc, tableId, session.origin, { row: anchor.row, col: anchor.col }));
    },
    [doc, tableId, setRange]
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
function useTableCellRangeWiring({ doc, tableId }: UseCellRangeArgs) {
  const session = useTableCellRange({ doc, tableId });
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
  useEffect(() => {
    if (range === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") clearRange();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [range, clearRange]);
  return { rangeHandlers, range };
}

export {
  anchorOfId,
  clearTableRangeOnEscape,
  rangeBetween,
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
