/**
 * The database grid's clipboard's paste (the mixed batch): the TSV's
 * grid stands from the selection's anchor cell (the active cell) over
 * the grid's own columns — the visible rows from the anchor down stand
 * the updates, the overflow past the last visible row stands the creates
 * (one `batchRows`, one undo entry). The option-based columns (the enum
 * / the row-link) stand no paste (the option's id stands not resolvable
 * from the pasted text — the v1's stand); the unparseable value stands
 * no cell (the editor's stand: the invalid input is not committed).
 */
import type { BridgeColumn } from "../bridge";
import { columnAnnotation, parseCellValue } from "../bridge";
import type { UseDatabaseTable } from "../use-database-table";
import type { GridCellSelectionFrame } from "./use-grid-cell-interaction";
import { parseClipboardTsv } from "./utils";

/** The paste's context (the hook's session state over the bridge's
 * data — the stand's inputs). */
interface GridCellPasteContext {
  /** The read-only stand (view / published): the paste's batch's commit is off. */
  readOnly: boolean;
  /** The live rows (the updates' targets + the created rows' successor). */
  rows: UseDatabaseTable["rows"];
  /** The visible columns (the paste's target set). */
  columns: BridgeColumn[];
  /** The bridge table's data (the mixed batch's commit). */
  data: UseDatabaseTable;
  /** The selection's frame (the paste's origin over the anchor cell). */
  selectionFrame: GridCellSelectionFrame | null;
}

/** The table's clipboard's paste (the mixed batch's commit). */
function handleGridCellPaste(event: React.ClipboardEvent<HTMLDivElement>, ctx: GridCellPasteContext): void {
  const { readOnly, rows, columns, data, selectionFrame } = ctx;
  // The read-only stand (view / published): the paste's batch's commit is
  // off (the selection's anchor stands no stand there).
  if (readOnly) return;
  // The edit's own control keeps its native paste (the character's
  // stand — the browser's text insert over the input).
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const frame = selectionFrame;
  if (frame === null) return; // no active cell: the paste has no origin
  const text = event.clipboardData.getData("text/plain");
  if (text === "") return;
  event.preventDefault();
  const grid = parseClipboardTsv(text);
  if (grid.length === 0 || rows.length === 0 || columns.length === 0) return;
  const r0 = frame.anchorR;
  const c0 = frame.anchorC;
  const updates: Array<{ rowId: string; cells: Record<string, unknown> }> = [];
  const creates: Array<Record<string, unknown>> = [];
  for (let i = 0; i < grid.length; i += 1) {
    const line = grid[i];
    if (line === undefined) continue;
    const cells: Record<string, unknown> = {};
    for (let j = 0; j < line.length; j += 1) {
      const column = columns[c0 + j];
      if (column === undefined) continue; // the grid's right edge: the overflow columns stand no stand
      const input = columnAnnotation(column).valueInput;
      if (input === "enum" || input === "row-link" || input === "none") continue; // the option's id stands not resolvable over the pasted text
      const raw = line[j];
      if (raw === undefined) continue;
      const parsed = parseCellValue(input, raw);
      if (!parsed.ok) continue;
      cells[column.id] = parsed.value;
    }
    const rowAt = rows[r0 + i];
    if (rowAt !== undefined) {
      updates.push({ rowId: rowAt.rowId, cells });
    } else {
      creates.push(cells);
    }
  }
  if (updates.length === 0 && creates.length === 0) return;
  // The created rows' seat: the visible successor of the last updated
  // row (the absent one — the paste over the window's tail — stands the
  // table's tail).
  const lastUpdatedIndex = r0 + updates.length - 1;
  const successor = rows[lastUpdatedIndex + 1];
  void data.pasteRows({ updates, creates, beforeRowId: successor?.rowId ?? null }).catch(() => undefined);
}

export { handleGridCellPaste };
export type { GridCellPasteContext };
