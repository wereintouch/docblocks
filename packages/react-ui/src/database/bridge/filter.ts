/**
 * The typed cell-value parse + the filter-condition evaluation: a raw value
 * is validated against the value input kind before it is written to the row
 * (the empty string is a valid "clear"), and a filter condition is evaluated
 * against a cell value over the operators the annotation declares (an unknown
 * operator never matches).
 */
import type { BridgeValueInput, CellValueParse } from "./models";

/**
 * Validates a raw (string) value against the value input kind before it is
 * written to the row (the number must parse, the date / datetime must be a
 * real date). The empty string is a valid "clear" (null). text / enum /
 * row-link / boolean pass through (the browser input / the picker
 * already constrains them).
 */
function parseCellValue(kind: BridgeValueInput, raw: string): CellValueParse {
  if (raw === "") return { ok: true, value: null };
  switch (kind) {
    case "number": {
      const n = Number(raw);
      return Number.isNaN(n) ? { ok: false, error: "The value is not a number" } : { ok: true, value: n };
    }
    case "date":
      return isValidDate(raw) ? { ok: true, value: raw } : { ok: false, error: "The value is not a valid date" };
    case "datetime":
      return !Number.isNaN(Date.parse(raw))
        ? { ok: true, value: raw }
        : { ok: false, error: "The value is not a valid date and time" };
    default:
      return { ok: true, value: raw };
  }
}

/** A valid ISO calendar date (`YYYY-MM-DD` that resolves to a real day). */
function isValidDate(raw: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw));
}

/** The timestamp of a date / datetime cell value (the `before` / `after`
 *  comparison); null when it is not a parseable date. */
function timestampOf(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? null : t;
}

/** Evaluates one filter condition against a cell value. */
function conditionMatches(op: string, value: unknown, expected: unknown): boolean {
  // The empty array stands the empty stand (the many cardinality's clear
  // = the empty list, like the null cell).
  const hasValue =
    value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
  switch (op) {
    case "is":
      if (expected === undefined || expected === null || expected === "") return !hasValue;
      // The many cardinality: the cell holds the array — the match stands
      // over the containment (the row is linked to the option / the row).
      if (Array.isArray(value)) return value.some((item) => equalsLoose(item, expected));
      return equalsLoose(value, expected);
    case "is not":
      if (expected === undefined || expected === null || expected === "") return hasValue;
      if (Array.isArray(value)) return !value.some((item) => equalsLoose(item, expected));
      return !equalsLoose(value, expected);
    case "contains":
      return stringOf(value).includes(stringOf(expected));
    case "not contains":
      return !stringOf(value).includes(stringOf(expected));
    case "starts with":
      return stringOf(value).startsWith(stringOf(expected));
    case "ends with":
      return stringOf(value).endsWith(stringOf(expected));
    case "empty":
      return !hasValue;
    case "not empty":
      return hasValue;
    case "<":
      return numberOr(value) < numberOr(expected);
    case "<=":
      return numberOr(value) <= numberOr(expected);
    case ">":
      return numberOr(value) > numberOr(expected);
    case ">=":
      return numberOr(value) >= numberOr(expected);
    case "between":
      return between(value, expected);
    case "before": {
      const a = timestampOf(value);
      const b = timestampOf(expected);
      if (a !== null && b !== null) return a < b;
      return stringOf(value) < stringOf(expected);
    }
    case "after": {
      const a = timestampOf(value);
      const b = timestampOf(expected);
      if (a !== null && b !== null) return a > b;
      return stringOf(value) > stringOf(expected);
    }
    case "in": {
      const list = Array.isArray(expected) ? expected.map(stringOf) : [stringOf(expected)];
      return list.includes(stringOf(value));
    }
    case "not in": {
      const list = Array.isArray(expected) ? expected.map(stringOf) : [stringOf(expected)];
      return !list.includes(stringOf(value));
    }
    default:
      // An unknown operator never matches (the bridge declares its
      // catalog; the filter UI offers only the declared ones).
      return false;
  }
}

function equalsLoose(a: unknown, b: unknown): boolean {
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  if (typeof a === "number" || typeof b === "number") return numberOr(a) === numberOr(b);
  return stringOf(a) === stringOf(b);
}

function stringOf(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function numberOr(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isNaN(parsed) ? -Infinity : parsed;
}

/** `between`: the expected is a two-item [low, high] pair. Date-aware: when
 *  the value and both bounds parse as dates, the comparison stands over the
 *  instants (the number path would stand NaN for a date string and never
 *  match). */
function between(value: unknown, expected: unknown): boolean {
  const pair = Array.isArray(expected) ? expected : [expected, expected];
  const t = timestampOf(value);
  const lo = timestampOf(pair[0]);
  const hi = timestampOf(pair[1]);
  if (t !== null && lo !== null && hi !== null) {
    return t >= Math.min(lo, hi) && t <= Math.max(lo, hi);
  }
  const num = numberOr(value);
  return num >= numberOr(pair[0]) && num <= numberOr(pair[1]);
}

export { conditionMatches, parseCellValue };
