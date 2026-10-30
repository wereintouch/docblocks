/** The database grid's cell interaction: the cell selection (the single
 * click's one cell, the press-drag's rectangle over the frame's corners,
 * the double click's edit session), the keyboard's selection stand (the
 * arrow's region slide, the shift+arrow's extension, the Escape's clear,
 * the Delete / Backspace's one-commit clear — one `updateRow` per row),
 * the undo / redo hotkey (the grid's own stack — the bridge operations),
 * and the press-outside's teardown (the view state resets, the edit session
 * closes). The selection's set + the frame's state + the editing cell's
 * state + the boolean press's stand stand in the hook. */
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";

import type { BridgeColumn } from "../bridge";
import type { UseDatabaseTable } from "../use-database-table";
import { DRAG_START_THRESHOLD_PX } from "./constants";
import { cellKeyOf } from "./utils";

interface GridCellInteractionDeps {
  /** The live rows (the selection's set + the keyboard's rows count). */
  rows: UseDatabaseTable["rows"];
  /** The visible columns (the selection's set + the keyboard's cols count). */
  columns: BridgeColumn[];
  /** The bridge table's data (the undo / redo / the clear's commit). */
  data: UseDatabaseTable;
  /** The table element (the focus's seat + the press-outside's teardown). */
  tableRef: RefObject<HTMLDivElement | null>;
}

function useGridCellInteraction({ rows, columns, data, tableRef }: GridCellInteractionDeps) {
  const [selectionFrame, setSelectionFrame] = useState<{
    anchorR: number;
    anchorC: number;
    cursorR: number;
    cursorC: number;
  } | null>(null);
  const [editingCell, setEditingCell] = useState<string | null>(null);
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
      if (event.button !== 0) return;
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

  /** The selection's clear (the Delete / Backspace over the stand; the
   *  focused input keeps its own character editing — no cell clear). One
   *  `updateRow` per row, the columns are the null cells. */
  const onTableKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // The undo / redo hotkey over the table's focus: the grid's own stack
    // (the bridge operations — the doc's undo does not cover them). The
    // focused input keeps its own history (the browser's edit commands).
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      event.stopPropagation();
      void (event.shiftKey ? data.redo() : data.undo());
      return;
    }
    if (event.key === "Escape") {
      if (selectionFrame === null && editingCell === null) return;
      // The grid owns the Escape (the cell selection / the edit session):
      // the editor root's blocks-selection gesture must not double-fire.
      event.preventDefault();
      event.stopPropagation();
      setSelectionFrame(null);
      setEditingCell(null);
      return;
    }
    // The keyboard's selection stand: the arrow stands the region's slide
    // (the single cell's move; the shape stands, the grid's edge stands no
    // move), the shift+arrow stands the region's extension (the cursor
    // moves over the anchor — the Excel's model).
    const isArrow =
      event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowRight";
    if (isArrow) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return; // the edit's own stand
      if (selectionFrame === null) return; // the stand stands the selected region only
      event.preventDefault();
      // The arrows over the stand are the grid's own gesture: the editor
      // root's caret navigation must not fire over the table's focus.
      event.stopPropagation();
      const dr = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      const dc = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      const rowsCount = rows.length;
      const colsCount = columns.length;
      if (rowsCount === 0 || colsCount === 0) return;
      if (event.shiftKey) {
        setSelectionFrame((frame) =>
          frame === null
            ? frame
            : {
                ...frame,
                cursorR: Math.max(0, Math.min(frame.cursorR + dr, rowsCount - 1)),
                cursorC: Math.max(0, Math.min(frame.cursorC + dc, colsCount - 1)),
              }
        );
        return;
      }
      setSelectionFrame((frame) => {
        if (frame === null) return frame;
        const rMin = Math.min(frame.anchorR, frame.cursorR);
        const rMax = Math.max(frame.anchorR, frame.cursorR);
        const cMin = Math.min(frame.anchorC, frame.cursorC);
        const cMax = Math.max(frame.anchorC, frame.cursorC);
        // The slide's clamp: the region's top / left corner stands over
        // the grid (the edge stands no move — the shift is 0 at the
        // boundary).
        const r0 = Math.max(0, Math.min(rMin + dr, rowsCount - 1 - (rMax - rMin)));
        const c0 = Math.max(0, Math.min(cMin + dc, colsCount - 1 - (cMax - cMin)));
        const rShift = r0 - rMin;
        const cShift = c0 - cMin;
        if (rShift === 0 && cShift === 0) return frame;
        return {
          ...frame,
          anchorR: frame.anchorR + rShift,
          anchorC: frame.anchorC + cShift,
          cursorR: frame.cursorR + rShift,
          cursorC: frame.cursorC + cShift,
        };
      });
      return;
    }
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (selectedCells.size === 0) return;
    event.preventDefault();
    // The cell clear is the grid's own gesture: the editor root's
    // blocks-selection Delete (the non-text row removal) must not fire
    // over the stand (the stand's row would take the block-level delete).
    event.stopPropagation();
    const byRow = new Map<string, Record<string, unknown>>();
    selectedCells.forEach((key) => {
      const [rowId, colId] = key.split("\u0000");
      const cells = byRow.get(rowId!) ?? {};
      cells[colId!] = null;
      byRow.set(rowId!, cells);
    });
    // The whole clear is ONE commit (the batch's one bridge call + the
    // one undo entry): the undo stands every cleared row back, not one
    // per row.
    void data.updateRows([...byRow.entries()].map(([rowId, cells]) => ({ rowId, cells })));
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
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [selectionFrame]);

  return {
    editingCell,
    setEditingCell,
    selectedCells,
    booleanPressRef,
    onCellPointerDown,
    onTableKeyDown,
  };
}

export { useGridCellInteraction };
