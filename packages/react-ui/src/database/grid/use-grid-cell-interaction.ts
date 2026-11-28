/** The database grid's cell interaction: the cell selection (the single
 * click's one cell, the press-drag's rectangle over the frame's corners,
 * the double click's edit session), the keyboard's selection stand (the
 * arrow's region slide, the shift+arrow's extension, the Escape's clear,
 * the Delete / Backspace's one-commit clear — the whole clear as one
 * `updateRows` batch),
 * the undo / redo hotkey (the grid's own stack — the bridge operations),
 * and the press-outside's teardown (the view state resets, the edit session
 * closes). The selection's set + the frame's state + the editing cell's
 * state + the boolean press's stand stand in the hook. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";

import type { BridgeColumn } from "../bridge";
import type { UseDatabaseTable } from "../use-database-table";
import { DRAG_START_THRESHOLD_PX } from "./constants";
import { handleGridCellKeyDown } from "./grid-cell-keyboard";
import { handleGridCellPaste } from "./grid-cell-paste";
import { useGridRangeMenu } from "./use-grid-range-menu";
import type { RefTableDataMap } from "./use-ref-tables";
import { cellKeyOf } from "./utils";

interface GridCellInteractionDeps {
  tableId: string;
  refTableData: RefTableDataMap;
  /** The live rows (the selection's set + the keyboard's rows count). */
  rows: UseDatabaseTable["rows"];
  /** The visible columns (the selection's set + the keyboard's cols count). */
  columns: BridgeColumn[];
  /** The bridge table's data (the undo / redo / the clear's commit). */
  data: UseDatabaseTable;
  /** The table element (the focus's seat + the press-outside's teardown). */
  tableRef: RefObject<HTMLDivElement | null>;
  /** The read-only stand (the view / published's modes): the cells' selection / edit and the keyboard's / the paste's paths stand off (the data stands rendered, the editing's paths do not). */
  readOnly?: boolean;
}

/** The selection's frame (the rectangle's anchor + the cursor over the
 * cells' indices). */
interface GridCellSelectionFrame {
  anchorR: number;
  anchorC: number;
  cursorR: number;
  cursorC: number;
}

function useGridCellInteraction({
  tableId,
  refTableData,
  rows,
  columns,
  data,
  tableRef,
  readOnly = false,
}: GridCellInteractionDeps) {
  const [selectionFrame, setSelectionFrame] = useState<GridCellSelectionFrame | null>(null);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [pasteRange, setPasteRange] = useState<Set<string>>(new Set());
  const clearPasteRange = useCallback((): void => {
    setPasteRange((current) => (current.size === 0 ? current : new Set()));
  }, []);
  const updateSelectionFrame: typeof setSelectionFrame = useCallback(
    (value) => {
      clearPasteRange();
      setSelectionFrame(value);
    },
    [clearPasteRange]
  );
  const updateEditingCell: typeof setEditingCell = useCallback(
    (value) => {
      if (value !== null) clearPasteRange();
      setEditingCell(value);
    },
    [clearPasteRange]
  );
  // The selection's set (the rectangle over the frame's corners — the
  // cells' keys stand from the live rows / columns by their indices).
  const selectedCells = useMemo(() => {
    const keys = new Set<string>();
    if (selectionFrame === null) return keys;
    const rMin = Math.min(selectionFrame.anchorR, selectionFrame.cursorR);
    const rMax = Math.max(selectionFrame.anchorR, selectionFrame.cursorR);
    const cMin = Math.min(selectionFrame.anchorC, selectionFrame.cursorC);
    const cMax = Math.max(selectionFrame.anchorC, selectionFrame.cursorC);
    for (let ri = rMin; ri <= rMax; ri += 1) {
      for (let ci = cMin; ci <= cMax; ci += 1) {
        const row = rows[ri];
        const column = columns[ci];
        if (row === undefined || column === undefined) continue;
        keys.add(cellKeyOf(row.rowId, column.id));
      }
    }
    return keys;
  }, [selectionFrame, rows, columns]);
  const cellDragRef = useRef<{
    anchorR: number;
    anchorC: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  // The boolean cell's press stand: armed = the cell stood the sole
  // selection at the press (the checkbox's press stands the toggle over
  // it); toggledTs = the interactive click's toggle time (the dblclick
  // over the same gesture stands no second toggle — the pointerdown's
  // detail stands 0, so the gesture's pair is the click's own detail +
  // the toggle's timestamp over the browser's double-click window).
  const booleanPressRef = useRef<{ armed: boolean; toggledTs: number }>({ armed: false, toggledTs: 0 });

  /** The cell press: the selection stand (the single cell at first; the
   *  press-drag extends it to the rectangle). The window-level session (no
   *  pointer capture: the capture would retarget the click / dblclick to
   *  the table and stand the double press's edit entry). The focused
   *  input keeps its own native stand (the text selection inside the input
   *  is never captured). */
  const onCellPointerDown =
    (rowId: string, colId: string, r: number, c: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
      // The read-only stand (view / published): the cells' selection's
      // path is off (the press stands no stand).
      if (readOnly) return;
      if (event.button !== 0) return;
      clearPasteRange();
      // The press inside the edit's own control (the number's input, the
      // text's 6-row textarea) is the edit's interaction (the caret's
      // seat, the text's selection) — the session stands, no teardown.
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      // The press over the grid's own portaled content (the date / datetime
      // pickers, the select list) is that content's interaction — the
      // portaled nodes are not the cell's DOM descendants, but they stand
      // below the cell in the React tree, so the press would reach here and
      // tear the editing session down (the picker would close itself).
      if (event.target instanceof Element && event.target.closest("[data-radix-popper-content-wrapper]") !== null)
        return;
      const key = cellKeyOf(rowId, colId);
      booleanPressRef.current.armed = selectedCells.size === 1 && selectedCells.has(key);
      cellDragRef.current = { anchorR: r, anchorC: c, startX: event.clientX, startY: event.clientY, moved: false };
      setEditingCell(null);
      setSelectionFrame({ anchorR: r, anchorC: c, cursorR: r, cursorC: c });
      tableRef.current?.focus({ preventScroll: true });
    };

  // The press-drag's region extension (the window's pointer events: the
  // press may leave the table while the drag stands). The handlers read the
  // session from the ref and the region's keys from the DOM (the cells'
  // data-key), so the component-lifetime listeners stand no stale closure.
  useEffect(() => {
    const move = (moveEvent: PointerEvent) => {
      const session = cellDragRef.current;
      if (session === null) return;
      if (!session.moved) {
        if (
          Math.hypot(moveEvent.clientX - session.startX, moveEvent.clientY - session.startY) < DRAG_START_THRESHOLD_PX
        )
          return;
        session.moved = true;
      }
      if (typeof document.elementFromPoint !== "function") return; // the headless DOM
      const el = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const cellEl =
        el instanceof Element
          ? el.closest<HTMLElement>("[data-slot='docblocks/database-cell'][data-row][data-col]")
          : null;
      if (cellEl === null) return;
      const row = Number(cellEl.dataset.row);
      const col = Number(cellEl.dataset.col);
      if (!Number.isInteger(row) || !Number.isInteger(col)) return;
      // The region stands the frame's cursor move (the anchor — the
      // press's cell — stands; the selection's set re-derives).
      setSelectionFrame((frame) => (frame === null ? frame : { ...frame, cursorR: row, cursorC: col }));
    };
    const end = () => {
      cellDragRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      cellDragRef.current = null;
    };
  }, []);

  /** The table's keydown stand (the grid's own gestures over the table's
   *  focus — the editor root's blocks-selection gestures must not fire
   *  over the stand). */
  const onTableKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    clearPasteRange();
    handleGridCellKeyDown(event, {
      readOnly,
      rows,
      columns,
      data,
      tableId,
      refTableData,
      selectionFrame,
      editingCell,
      selectedCells,
      setSelectionFrame: updateSelectionFrame,
      setEditingCell: updateEditingCell,
    });
  };

  /** The clipboard's paste (the mixed batch: the TSV's grid stands from
   *  the selection's anchor cell over the grid's own columns — the
   *  updates + the creates over one `batchRows`). */
  const commitPaste = async (event: React.ClipboardEvent<HTMLDivElement>): Promise<void> => {
    try {
      const highlights = await handleGridCellPaste(event, {
        readOnly,
        tableId,
        rows,
        columns,
        data,
        selectionFrame,
        refTableData,
      });
      if (highlights === null) return;
      const keys = new Set<string>();
      for (const highlight of highlights) {
        for (const columnId of highlight.columnIds) keys.add(cellKeyOf(highlight.rowId, columnId));
      }
      setPasteRange(keys);
    } catch {
      // The row operation exposes its typed failure through the grid error state.
    }
  };
  const onTablePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    clearPasteRange();
    void commitPaste(event);
  };

  // A press outside the table stands the selection no stand (the view
  // state resets; the edit session closes with it). The press over the
  // grid's own portaled content (the date / datetime pickers, the select
  // list, the menus) is the grid's own interaction — the portaled nodes
  // are not the table's descendants, so the Radix popper wrapper is the
  // inside test.
  useEffect(() => {
    if (selectionFrame === null) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target !== null && (target as Element).closest?.("[data-radix-popper-content-wrapper]") !== null) return;
      if (tableRef.current === null || !tableRef.current.contains(event.target as Node)) {
        setSelectionFrame(null);
        setEditingCell(null);
        clearPasteRange();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [selectionFrame]);

  const rangeMenu = useGridRangeMenu({ selectedCells, data, readOnly, onAction: clearPasteRange });

  return {
    editingCell,
    setEditingCell: updateEditingCell,
    pasteRange,
    selectedCells,
    booleanPressRef,
    onCellPointerDown,
    onTableKeyDown,
    onTablePaste,
    rangeMenu,
  };
}

export { useGridCellInteraction };
export type { GridCellSelectionFrame };
