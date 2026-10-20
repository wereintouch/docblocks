/** The database grid's pure helpers: the visible-column derivation, the
 * number column's display attributes / input step, the cell's selection
 * key, and the date/datetime value parsing + labels. */
import { format, parse } from "date-fns";

import type { BridgeColumn } from "../bridge";
import type { NumberFormatAttrs } from "../number-format";

/** The block's visible columns: the `columnOrder` attr first (the
 *  additive columns not listed keep the schema order), the hidden
 *  columns dropped. */
function visibleColumns(
  columns: BridgeColumn[] | undefined,
  columnOrder?: string[],
  hiddenColumns?: string[]
): BridgeColumn[] {
  const all = columns ?? [];
  const hidden = new Set(hiddenColumns ?? []);
  // The hidden columns stand out of the view entirely (the byId remainder
  // includes only the visible ones).
  const byId = new Map(all.filter((column) => !hidden.has(column.id)).map((column) => [column.id, column]));
  const ordered: BridgeColumn[] = [];
  if (columnOrder !== undefined) {
    for (const id of columnOrder) {
      const column = byId.get(id);
      if (column !== undefined) {
        ordered.push(column);
        byId.delete(id);
      }
    }
  }
  // The remainder (the columns the order does not list, the schema order).
  for (const column of byId.values()) ordered.push(column);
  return ordered;
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

export {
  cellKeyOf,
  dateOnly,
  dateTimeLabel,
  hasTime,
  numberDisplayAttrs,
  numberStepFor,
  parseCellDateTime,
  visibleColumns,
};
