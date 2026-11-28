/** The database grid paste: same-table structured values or external TSV,
 * committed as one update/create batch. Invalid cells are skipped. */
import type { BridgeColumn } from "../bridge";
import type { UseDatabaseTable } from "../use-database-table";
import { cellValueEqual } from "../use-database-table";
import {
  DATABASE_GRID_MIME,
  parseDatabaseGridPayload,
  refDataOf,
  resolveStructuredGridCell,
  resolveTextGridCell,
} from "./grid-cell-clipboard";
import type { GridCellSelectionFrame } from "./use-grid-cell-interaction";
import type { RefTableDataMap } from "./use-ref-tables";
import { parseClipboardTsv } from "./utils";

interface GridCellPasteContext {
  readOnly: boolean;
  tableId: string;
  rows: UseDatabaseTable["rows"];
  columns: BridgeColumn[];
  data: UseDatabaseTable;
  selectionFrame: GridCellSelectionFrame | null;
  refTableData: RefTableDataMap;
}

interface GridCellPasteHighlight {
  rowId: string;
  columnIds: string[];
}

/** Commits one paste and returns its changed cells for the transient frame. */
async function handleGridCellPaste(
  event: React.ClipboardEvent<HTMLDivElement>,
  ctx: GridCellPasteContext
): Promise<GridCellPasteHighlight[] | null> {
  const { readOnly, tableId, rows, columns, data, selectionFrame, refTableData } = ctx;
  if (readOnly) return null;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return null;
  if (selectionFrame === null) return null;
  const structured = parseDatabaseGridPayload(event.clipboardData.getData(DATABASE_GRID_MIME), tableId);
  const text = event.clipboardData.getData("text/plain");
  if (structured === null && text === "") return null;
  event.preventDefault();
  const grid: unknown[][] = structured ?? parseClipboardTsv(text);
  if (grid.length === 0 || rows.length === 0 || columns.length === 0) return null;
  const r0 = selectionFrame.anchorR;
  const c0 = selectionFrame.anchorC;
  const updates: Array<{ rowId: string; cells: Record<string, unknown> }> = [];
  const creates: Array<Record<string, unknown>> = [];
  for (let i = 0; i < grid.length; i += 1) {
    const line = grid[i];
    if (line === undefined) continue;
    const cells = Object.create(null) as Record<string, unknown>;
    for (let j = 0; j < line.length; j += 1) {
      const column = columns[c0 + j];
      const raw = line[j];
      if (column === undefined || raw === undefined) continue;
      const resolved =
        structured !== null
          ? resolveStructuredGridCell(column, raw)
          : resolveTextGridCell(column, String(raw), refDataOf(column, refTableData));
      if (resolved.ok) cells[column.id] = resolved.value;
    }
    const rowAt = rows[r0 + i];
    if (rowAt !== undefined) {
      // Unchanged cells are not writes and do not belong to the paste frame.
      for (const [columnId, value] of Object.entries(cells)) {
        if (cellValueEqual(rowAt.cells[columnId], value)) delete cells[columnId];
      }
    }
    if (Object.keys(cells).length === 0) continue;
    if (rowAt !== undefined) updates.push({ rowId: rowAt.rowId, cells });
    else creates.push(cells);
  }
  if (updates.length === 0 && creates.length === 0) return null;
  const lastUpdated = updates.at(-1);
  const lastUpdatedIndex = lastUpdated === undefined ? -1 : rows.findIndex((row) => row.rowId === lastUpdated.rowId);
  const successor = rows[lastUpdatedIndex + 1];
  const createdRowIds = await data.pasteRows({ updates, creates, beforeRowId: successor?.rowId ?? null });
  const updatedHighlights = updates.map(({ rowId, cells }) => ({ rowId, columnIds: Object.keys(cells) }));
  const createdHighlights = createdRowIds.flatMap((rowId, index) => {
    const cells = creates[index];
    return cells === undefined ? [] : [{ rowId, columnIds: Object.keys(cells) }];
  });
  return [...updatedHighlights, ...createdHighlights];
}

export { handleGridCellPaste };
export type { GridCellPasteContext, GridCellPasteHighlight };
