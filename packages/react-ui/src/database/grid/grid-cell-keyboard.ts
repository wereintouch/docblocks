/**
 * The database grid's keyboard stand over the table's focus: the
 * clipboard's copy (the TSV's stand — the paste's round-trip) over the
 * selection's rectangle, the grid's own undo / redo stack (the bridge's
 * operations — the doc's undo does not cover them), the Escape's clear
 * (the cell selection / the edit session), the arrow's region slide /
 * the shift+arrow's extension (the Excel's model), and the Delete /
 * Backspace's one-commit clear (the batch's one bridge call).
 */
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, SetStateAction } from "react";

import type { BridgeColumn } from "../bridge";
import type { UseDatabaseTable } from "../use-database-table";
import { clearGridCells } from "./grid-cell-actions";
import { buildDatabaseGridClipboard, writeDatabaseGridClipboard } from "./grid-cell-clipboard";
import type { GridCellSelectionFrame } from "./use-grid-cell-interaction";
import type { RefTableDataMap } from "./use-ref-tables";

/** The keyboard's context (the hook's session state over the bridge's
 * data — the stand's inputs). */
interface GridCellKeyboardContext {
  tableId: string;
  refTableData: RefTableDataMap;
  /** The read-only stand (view / published): the keyboard's paths stand off. */
  readOnly: boolean;
  /** The live rows (the copy's cells + the arrows' rows count). */
  rows: UseDatabaseTable["rows"];
  /** The visible columns (the copy's cells + the arrows' cols count). */
  columns: BridgeColumn[];
  /** The bridge table's data (the undo / redo / the clear's commit). */
  data: UseDatabaseTable;
  /** The selection's frame (the copy's rectangle; the slide / extension's origin). */
  selectionFrame: GridCellSelectionFrame | null;
  /** The editing cell's stand (the Escape's clear gate). */
  editingCell: string | null;
  /** The selection's set (the clear's cells). */
  selectedCells: Set<string>;
  /** The selection's frame's setter (the Escape's clear, the arrows' updates). */
  setSelectionFrame: Dispatch<SetStateAction<GridCellSelectionFrame | null>>;
  /** The editing cell's setter (the Escape's clear). */
  setEditingCell: Dispatch<SetStateAction<string | null>>;
}

/** The table's keydown stand (the grid's own gestures over the table's
 * focus — the editor root's blocks-selection gestures must not fire). */
function handleGridCellKeyDown(event: ReactKeyboardEvent<HTMLDivElement>, ctx: GridCellKeyboardContext): void {
  const {
    tableId,
    refTableData,
    readOnly,
    rows,
    columns,
    data,
    selectionFrame,
    editingCell,
    selectedCells,
    setSelectionFrame,
    setEditingCell,
  } = ctx;
  // The read-only stand (view / published): the keyboard's selection's
  // stand and the clipboard's copy / clear's commits stand off (the
  // selection stands no stand there).
  if (readOnly) return;
  // The clipboard's copy (the TSV's stand — the paste's round-trip):
  // the selection's rectangle over the grid's own columns, the rows
  // top → bottom, the cells left → right. The edit's own input keeps its
  // native text copy; the no-selection stands no copy.
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "c") {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (selectionFrame === null) return;
    event.preventDefault();
    event.stopPropagation();
    const clipboard = buildDatabaseGridClipboard({
      tableId,
      rows,
      columns,
      selectionFrame,
      refTableData,
    });
    if (clipboard !== null) void writeDatabaseGridClipboard(clipboard);
    return;
  }
  // The undo / redo hotkey over the table's focus: the grid's own stack
  // (the bridge operations — the doc's undo does not cover them). The
  // focused input keeps its own history (the browser's edit commands).
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    event.stopPropagation();
    void (event.shiftKey ? data.redo() : data.undo()).catch(() => undefined);
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
  void clearGridCells(selectedCells, data).catch(() => undefined);
}

export { handleGridCellKeyDown };
export type { GridCellKeyboardContext };
