import type { BridgeColumn, CellValueParse } from "../bridge";
import { columnAnnotation, parseCellValue } from "../bridge";
import type { DatabaseTableRow } from "../use-database-table/models";
import type { GridCellSelectionFrame } from "./use-grid-cell-interaction";
import { refEntryKey } from "./use-ref-tables";
import type { RefTableData, RefTableDataMap } from "./use-ref-tables";
import { cellTextOf } from "./utils";

const DATABASE_GRID_MIME = "application/x-docblocks-database-grid";
const DATABASE_GRID_PAYLOAD_VERSION = 1;

interface DatabaseGridClipboard {
  mime: string;
  text: string;
  payload: string;
}

interface BuildGridClipboardContext {
  tableId: string;
  rows: DatabaseTableRow[];
  columns: BridgeColumn[];
  selectionFrame: GridCellSelectionFrame;
  refTableData: RefTableDataMap;
}

function refDataOf(column: BridgeColumn, refs: RefTableDataMap): RefTableData | undefined {
  if (column.refTableId === undefined) return undefined;
  return refs[refEntryKey({ tableId: column.refTableId, displayColumn: column.refDisplayColumn })];
}

function displayTextOf(column: BridgeColumn, value: unknown, refs: RefTableDataMap): string {
  if (column.refKind === undefined) return cellTextOf(value);
  const data = refDataOf(column, refs);
  const display = (entry: unknown): string => {
    const raw = cellTextOf(entry);
    return data?.displays[raw] ?? raw;
  };
  return Array.isArray(value) ? value.map(display).join(",") : display(value);
}

/** Builds the standard display TSV and the same-table raw-value payload. */
function buildDatabaseGridClipboard(ctx: BuildGridClipboardContext): DatabaseGridClipboard | null {
  const { tableId, rows, columns, selectionFrame, refTableData } = ctx;
  const rMin = Math.min(selectionFrame.anchorR, selectionFrame.cursorR);
  const rMax = Math.max(selectionFrame.anchorR, selectionFrame.cursorR);
  const cMin = Math.min(selectionFrame.anchorC, selectionFrame.cursorC);
  const cMax = Math.max(selectionFrame.anchorC, selectionFrame.cursorC);
  const textRows: string[] = [];
  const rawRows: unknown[][] = [];
  for (let r = rMin; r <= rMax; r += 1) {
    const textCells: string[] = [];
    const rawCells: unknown[] = [];
    for (let c = cMin; c <= cMax; c += 1) {
      const row = rows[r];
      const column = columns[c];
      const value = row === undefined || column === undefined ? null : row.cells[column.id];
      rawCells.push(value ?? null);
      textCells.push(column === undefined ? "" : displayTextOf(column, value, refTableData));
    }
    textRows.push(textCells.join("\t"));
    rawRows.push(rawCells);
  }
  return {
    mime: DATABASE_GRID_MIME,
    text: textRows.join("\n"),
    payload: JSON.stringify({ v: DATABASE_GRID_PAYLOAD_VERSION, tableId, cells: rawRows }),
  };
}

/** Parses only the versioned payload issued for the current table. */
function parseDatabaseGridPayload(raw: string, tableId: string): unknown[][] | null {
  if (raw === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as { v?: unknown; tableId?: unknown; cells?: unknown };
    if (candidate.v !== DATABASE_GRID_PAYLOAD_VERSION || candidate.tableId !== tableId) return null;
    if (!Array.isArray(candidate.cells) || !candidate.cells.every((row) => Array.isArray(row))) return null;
    return candidate.cells;
  } catch {
    return null;
  }
}

function invalid(error: string): CellValueParse {
  return { ok: false, error };
}

/** Resolves display text against a reference column's loaded catalog. */
function resolveReferenceText(column: BridgeColumn, raw: string, refs?: RefTableData): CellValueParse {
  if (raw === "") return { ok: true, value: null };
  if (refs === undefined) return invalid("The reference catalog is unavailable");
  const labels = column.refMany === true ? raw.split(",").map((entry) => entry.trim()) : [raw.trim()];
  const values: string[] = [];
  for (const label of labels) {
    const matches = refs.rowIds.filter((rowId) => refs.displays[rowId] === label);
    if (matches.length === 0 || (column.refKind === "row" && matches.length !== 1)) {
      return invalid("The reference label is unknown or ambiguous");
    }
    values.push(matches[0]!);
  }
  return { ok: true, value: column.refMany === true ? values : values[0] };
}

/** Resolves external TSV text into one target cell. */
function resolveTextGridCell(column: BridgeColumn, raw: string, refs?: RefTableData): CellValueParse {
  const input = columnAnnotation(column).valueInput;
  if (input === "none") return invalid("The column does not accept values");
  if (input === "enum" || input === "row-link") return resolveReferenceText(column, raw, refs);
  return parseCellValue(input, raw);
}

/** Validates raw structured clipboard values against the target column. */
function resolveStructuredGridCell(column: BridgeColumn, raw: unknown): CellValueParse {
  const input = columnAnnotation(column).valueInput;
  if (input === "none") return invalid("The column does not accept values");
  if (raw === null) return { ok: true, value: null };
  if (input === "enum" || input === "row-link") {
    if (column.refMany === true) {
      return Array.isArray(raw) && raw.every((entry) => typeof entry === "string")
        ? { ok: true, value: [...raw] }
        : invalid("The reference list is invalid");
    }
    return typeof raw === "string" ? { ok: true, value: raw } : invalid("The reference is invalid");
  }
  if (input === "number") {
    return typeof raw === "number" && Number.isFinite(raw)
      ? { ok: true, value: raw }
      : invalid("The number is invalid");
  }
  if (input === "boolean") {
    return typeof raw === "boolean" ? { ok: true, value: raw } : invalid("The boolean is invalid");
  }
  if (typeof raw !== "string") return invalid("The text value is invalid");
  return parseCellValue(input, raw);
}

/** Writes both clipboard flavors, retaining TSV when custom MIME is unavailable. */
async function writeDatabaseGridClipboard(clipboard: DatabaseGridClipboard): Promise<void> {
  if (typeof navigator === "undefined" || navigator.clipboard === undefined) return;
  if (typeof navigator.clipboard.write === "function" && typeof ClipboardItem !== "undefined") {
    try {
      const item = new ClipboardItem({
        "text/plain": new Blob([clipboard.text], { type: "text/plain" }),
        [clipboard.mime]: new Blob([clipboard.payload], { type: clipboard.mime }),
      });
      await navigator.clipboard.write([item]);
      return;
    } catch {
      // A browser can reject custom MIME; the standard TSV fallback remains.
    }
  }
  try {
    await navigator.clipboard.writeText(clipboard.text);
  } catch {
    // Clipboard permissions are optional; a rejected write is a no-op.
  }
}

export {
  DATABASE_GRID_MIME,
  buildDatabaseGridClipboard,
  parseDatabaseGridPayload,
  refDataOf,
  resolveStructuredGridCell,
  resolveTextGridCell,
  writeDatabaseGridClipboard,
};
export type { DatabaseGridClipboard };
