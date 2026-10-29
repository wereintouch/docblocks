/**
 * The filter payload's pure helpers: the empty ("no filter") shape, the
 * recursion depth cap, and whether a payload is applicable (every condition
 * that takes a value has one).
 */
import type { DatabaseFilterPayload } from "docblocks-core";

import { columnAnnotation } from "../bridge";
import type { BridgeColumn } from "../bridge";

/** The filter recursion depth cap (the package's UI constant; a backend
 *  validates the depth on its own). */
const FILTER_MAX_DEPTH = 4;

/** The empty filter payload (the "no filter" shape the Clear writes). */
function emptyFilter(): DatabaseFilterPayload {
  return { logic: "and", conditions: [] };
}

/** Whether the payload is applicable: every condition that needs a value
 *  has one (an empty value = the condition is inapplicable). */
function filterIsComplete(payload: DatabaseFilterPayload | null, columns: BridgeColumn[]): boolean {
  if (payload === null) return true;
  for (const condition of payload.conditions) {
    const column = columns.find((entry) => entry.id === condition.columnId);
    if (column === undefined) return false;
    if (columnAnnotation(column).valueless.has(condition.op)) continue;
    const value = condition.value;
    if (value === undefined || value === null || value === "") return false;
    if (Array.isArray(value) && value.length === 0) return false;
  }
  for (const group of payload.groups ?? []) {
    if (!filterIsComplete(group, columns)) return false;
  }
  return true;
}

export { FILTER_MAX_DEPTH, emptyFilter, filterIsComplete };
