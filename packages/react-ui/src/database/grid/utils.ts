/** The database grid's pure helpers: the visible-column derivation, the
 * number column's display attributes / input step, the cell's selection
 * key, and the date/datetime value parsing + labels. */
import { format, parse } from "date-fns";

import type { BridgeColumn } from "../bridge";
import type { NumberFormatAttrs } from "../number-format";
import type { AddColumnFormDraft, AddColumnTypeEntry } from "./models";

/** The full known id order: explicit ids first, then new schema columns. */
function normalizeColumnOrder(columns: BridgeColumn[] | undefined, columnOrder?: string[]): string[] {
  const all = columns ?? [];
  const byId = new Map(all.map((column) => [column.id, column]));
  const ordered: string[] = [];
  for (const id of columnOrder ?? []) {
    if (!byId.has(id) || ordered.includes(id)) continue;
    ordered.push(id);
    byId.delete(id);
  }
  for (const column of byId.values()) ordered.push(column.id);
  return ordered;
}

/** The block's visible columns: the full order minus the hidden ids. */
function visibleColumns(
  columns: BridgeColumn[] | undefined,
  columnOrder?: string[],
  hiddenColumns?: string[]
): BridgeColumn[] {
  const byId = new Map((columns ?? []).map((column) => [column.id, column]));
  const hidden = new Set(hiddenColumns ?? []);
  return normalizeColumnOrder(columns, columnOrder).flatMap((id) => {
    const column = byId.get(id);
    return column === undefined || hidden.has(id) ? [] : [column];
  });
}

/** One immutable list move; an invalid or identity move returns the input. */
function reorderItems<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) return items;
  next.splice(toIndex, 0, moved);
  return next;
}

/** A visible header drop mapped into the full order without moving hidden ids over an anchor. */
function moveVisibleColumn(
  columns: BridgeColumn[] | undefined,
  columnOrder: string[] | undefined,
  hiddenColumns: string[] | undefined,
  columnId: string,
  toIndex: number
): string[] {
  const fullOrder = normalizeColumnOrder(columns, columnOrder);
  const visibleIds = visibleColumns(columns, columnOrder, hiddenColumns).map((column) => column.id);
  const stationary = visibleIds.filter((id) => id !== columnId);
  if (stationary.length === visibleIds.length || toIndex < 0 || toIndex > stationary.length) return fullOrder;
  const next = fullOrder.filter((id) => id !== columnId);
  const targetId = stationary[toIndex];
  if (targetId !== undefined) {
    next.splice(next.indexOf(targetId), 0, columnId);
    return next;
  }
  const anchorId = stationary.at(-1);
  if (anchorId === undefined) return fullOrder;
  next.splice(next.indexOf(anchorId) + 1, 0, columnId);
  return next;
}
/** The number input's step stand: the explicit `decimals` stands the
 *  `10^-decimals` step; the absent stand follows the integer types only
 *  (the float types stand no step — the 0.5 must be typeable). */
function numberStepFor(column: BridgeColumn): string | undefined {
  if (column.decimals !== undefined) {
    const decimals = Math.max(0, Math.min(10, Math.trunc(Number(column.decimals)) || 0));
    return decimals === 0 ? "1" : String(10 ** -decimals);
  }
  const base = column.type.replace(/\[\]$/, "").trim();
  return base === "integer" || base === "int" || base === "smallint" || base === "bigint" ? "1" : undefined;
}
/** The display's attributes stand: the explicit `decimals` (or the
 *  integer stand) takes the fixed-digit format; the float types without
 *  the explicit digits stand the RAW value (no rounding — the display
 *  must not lose the value's own stand). */
function numberDisplayAttrs(column: BridgeColumn): NumberFormatAttrs {
  const base = column.type.replace(/\[\]$/, "").trim();
  const integerish =
    column.decimals !== undefined ||
    base === "integer" ||
    base === "int" ||
    base === "smallint" ||
    base === "bigint" ||
    base === "number";
  return {
    decimals: integerish ? (column.decimals ?? 0) : null,
    thousands: column.thousands,
    prefix: column.prefix,
    suffix: column.suffix,
  };
}
/** The cell's selection/editing key (the row id + the column id). */
const cellKeyOf = (rowId: string, colId: string) => `${rowId}\u0000${colId}`;
/** The cell's clipboard text: the TSV's flat stand (the tab / the
 *  newline stand the space — the TSV's shape stands; the row-link's array
 *  joins over the comma — the label's stand, never the id). */
function cellTextOf(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map((item) => cellTextOf(item)).join(",");
  return String(value).replace(/[\t\n\r]/g, " ");
}
/** The TSV's parse (the clipboard's plain text over the grid's paste):
 *  the rows over the newline (the carriage return stands the newline),
 *  the cells over the tab; the trailing empty row stands no stand (the
 *  clipboard's trailing newline). An empty text stands no grid. */
function parseClipboardTsv(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) return [];
  return lines.map((line) => line.split("\t"));
}
/** The local-calendar day (the year / month / date stand, the time is
 *  dropped) — the picker's draft stand. */
function dateOnly(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
/** The time stand (the hours / minutes / the seconds are not all zero). */
function hasTime(value: Date): boolean {
  return value.getHours() !== 0 || value.getMinutes() !== 0 || value.getSeconds() !== 0;
}
/** The datetime cell's value (the optional "THH:MM" / "THH:MM:SS" time
 *  part) parsed to the local-calendar Date; null when absent / invalid. */
function parseCellDateTime(value: unknown): Date | null {
  const raw = value === undefined || value === null ? "" : String(value);
  if (raw === "") return null;
  if (raw.includes("T")) {
    const withSeconds = parse(raw, "yyyy-MM-dd'T'HH:mm:ss", new Date());
    const result = Number.isNaN(withSeconds.getTime()) ? parse(raw, "yyyy-MM-dd'T'HH:mm", new Date()) : withSeconds;
    return Number.isNaN(result.getTime()) ? null : result;
  }
  const dateOnlyResult = parse(raw, "yyyy-MM-dd", new Date());
  return Number.isNaN(dateOnlyResult.getTime()) ? null : dateOnlyResult;
}
/** The datetime's compact label (`dd.MM.yyyy HH:mm` — the seconds stand
 *  only when they are not zero; the midnight zero stands the date only). */
function dateTimeLabel(value: Date): string {
  const base = format(value, "dd.MM.yyyy");
  if (!hasTime(value)) return base;
  const label = format(value, "HH:mm");
  return value.getSeconds() !== 0 ? `${base} ${label}:${format(value, "ss")}` : `${base} ${label}`;
}

/** The form draft over a catalog entry (the name prefills the type's
 *  label — the create's commit takes the input's name). */
function emptyColumnForm(entry: AddColumnTypeEntry): AddColumnFormDraft {
  return {
    key: entry.key,
    type: entry.type,
    name: entry.label,
    numberKind: entry.numberKind,
    decimals: entry.numberKind === "decimal" ? 2 : 0,
    thousands: false,
    prefix: "",
    suffix: "",
    allowNegative: true,
    refKind: entry.refKind,
    refMany: entry.refMany,
    refPick: "",
    newTableName: "",
  };
}

export {
  cellKeyOf,
  cellTextOf,
  parseClipboardTsv,
  dateOnly,
  dateTimeLabel,
  emptyColumnForm,
  hasTime,
  numberDisplayAttrs,
  moveVisibleColumn,
  normalizeColumnOrder,
  numberStepFor,
  parseCellDateTime,
  reorderItems,
  visibleColumns,
};
