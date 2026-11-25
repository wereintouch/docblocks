/**
 * The in-memory bridge's query pipeline (pure over the shared state, which
 * stands over the core): the filter / sort / limit's validation, the
 * filter's matching, the sort's comparator, the ordered visible rows, the
 * server's signed query fingerprint + the declared semantics, and the
 * opaque page cursor (the continuation token signed under the instance's
 * key).
 */
import type {
  BridgeColumn,
  Column,
  FilterInput,
  PageQuery,
  QueryOperator,
  QuerySemantics,
  SortInput,
} from "docblocks-react-ui";
import { BridgeError, columnAnnotation, conditionMatches } from "docblocks-react-ui";

import {
  MAX_FILTER_DEPTH,
  MAX_FILTER_TERMS,
  MAX_PAGE_SIZE,
  SEMANTICS_COLLATION,
  SEMANTICS_NULL_ORDERING,
  SEMANTICS_TIMEZONE,
  SEMANTICS_VERSION,
} from "./constants";
import { queryFingerprintOf, signCursor } from "./cursor";
import type { MemoryRow, MemoryTable } from "./models";
import { liveRows } from "./rows";
import { physicalCompare } from "./utils";

/** The column's effective operator catalog (the consumer's `operators`
 *  override, else the option catalog for the reference columns, else the
 *  type's default). */
function columnAsBridge(column: Column): BridgeColumn {
  const bridge: BridgeColumn = {
    id: column.id,
    name: column.name,
    type: column.type,
    ...(column.operators !== undefined ? { operators: [...column.operators] } : {}),
    ...(column.reference !== undefined
      ? {
          refKind: column.reference.kind,
          refTableId: column.reference.tableId,
          refMany: column.reference.many,
          ...(column.reference.displayColumnId !== undefined
            ? { refDisplayColumn: column.reference.displayColumnId }
            : {}),
        }
      : {}),
  };
  return bridge;
}

function validateFilter(table: MemoryTable, filter: FilterInput, depth = 0, terms = { count: 0 }): void {
  if (depth > MAX_FILTER_DEPTH)
    throw new BridgeError("limit_exceeded", `The filter depth exceeds ${MAX_FILTER_DEPTH}.`);
  if (typeof filter !== "object" || filter === null || Array.isArray(filter)) {
    throw new BridgeError("invalid_filter", "The filter must be a plain object.");
  }
  if (filter.logic !== "and" && filter.logic !== "or") {
    throw new BridgeError("invalid_filter", 'The filter logic must be "and" or "or".');
  }
  if (!Array.isArray(filter.conditions))
    throw new BridgeError("invalid_filter", "The filter conditions must be an array.");
  for (const condition of filter.conditions) {
    terms.count += 1;
    if (terms.count > MAX_FILTER_TERMS) {
      throw new BridgeError("limit_exceeded", `The filter terms exceed ${MAX_FILTER_TERMS}.`);
    }
    if (typeof condition !== "object" || condition === null || Array.isArray(condition)) {
      throw new BridgeError("invalid_filter", "A filter condition must be a plain object.");
    }
    if (typeof condition.columnId !== "string" || typeof condition.op !== "string") {
      throw new BridgeError("invalid_filter", "A filter condition requires the columnId and the operator.");
    }
    const column = table.columns.find((entry) => entry.id === condition.columnId);
    if (column === undefined) {
      throw new BridgeError("invalid_column", `The filter references the unknown column "${condition.columnId}".`);
    }
    const annotation = columnAnnotation(columnAsBridge(column));
    if (!annotation.operators.includes(condition.op)) {
      throw new BridgeError(
        "invalid_operator",
        `The operator "${condition.op}" is not declared for the column type "${column.type}".`
      );
    }
    if (annotation.valueless.has(condition.op) && condition.value !== undefined) {
      throw new BridgeError("invalid_filter", `The operator "${condition.op}" takes no value.`);
    }
  }
  for (const group of filter.groups ?? []) validateFilter(table, group, depth + 1, terms);
}

function validateSort(table: MemoryTable, sort: SortInput): void {
  for (const key of sort) {
    if (typeof key?.fieldId !== "string" || (key.direction !== "asc" && key.direction !== "desc")) {
      throw new BridgeError("invalid_filter", "A sort key requires the fieldId and the direction.");
    }
    if (!table.columns.some((column) => column.id === key.fieldId)) {
      throw new BridgeError("invalid_column", `The sort references the unknown column "${key.fieldId}".`);
    }
  }
}

function validateQuery(table: MemoryTable, query: PageQuery): void {
  if (query.filter !== undefined) validateFilter(table, query.filter);
  if (query.sort !== undefined) validateSort(table, query.sort);
  if (
    query.limit !== undefined &&
    (!Number.isInteger(query.limit) || query.limit <= 0 || query.limit > MAX_PAGE_SIZE)
  ) {
    throw new BridgeError("limit_exceeded", `The page limit must be an integer in 1..${MAX_PAGE_SIZE}.`);
  }
}

function filterMatches(filter: FilterInput, cells: Record<string, unknown>): boolean {
  const conditionResults = filter.conditions.map((condition) =>
    conditionMatches(condition.op, cells[condition.columnId], condition.value)
  );
  const groupResults = (filter.groups ?? []).map((group) => filterMatches(group, cells));
  const all = [...conditionResults, ...groupResults];
  return filter.logic === "and" ? all.every(Boolean) : all.some(Boolean);
}

function compareSortKey(
  key: { fieldId: string; direction: "asc" | "desc"; nulls?: "first" | "last" },
  a: Record<string, unknown>,
  b: Record<string, unknown>
): number {
  const va = a[key.fieldId];
  const vb = b[key.fieldId];
  const aNull = va === undefined || va === null;
  const bNull = vb === undefined || vb === null;
  if (aNull || bNull) {
    if (aNull === bNull) return 0;
    const nullFirst = key.nulls ?? SEMANTICS_NULL_ORDERING;
    return aNull ? (nullFirst === "first" ? -1 : 1) : nullFirst === "first" ? 1 : -1;
  }
  let result: number;
  if (typeof va === "number" && typeof vb === "number") result = va - vb;
  else if (typeof va === "boolean" && typeof vb === "boolean") result = Number(va) - Number(vb);
  else {
    const sa = String(va);
    const sb = String(vb);
    result = sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  return key.direction === "desc" ? -result : result;
}

/** The filtered + sorted visible rows (the input order stands the
 *  physical order; the sort tie-break keeps it). */
function orderedQueryRows(
  table: MemoryTable,
  filter: FilterInput | undefined,
  sort: SortInput | undefined
): MemoryRow[] {
  let rows = liveRows(table);
  if (filter !== undefined) rows = rows.filter((row) => filterMatches(filter, row.cells));
  if (sort !== undefined && sort.length > 0) {
    rows = [...rows].sort((a, b) => {
      for (const key of sort) {
        const result = compareSortKey(key, a.cells, b.cells);
        if (result !== 0) return result;
      }
      return physicalCompare(a, b);
    });
  }
  return rows;
}

/** The server's signed canonical form: the HMAC over the canonical query
 *  under the instance's key, together with the table, the snapshot
 *  boundary, the schema revision and the declared semantics (the client
 *  never constructs one). */
function queryFingerprint(
  cursorKey: Uint8Array,
  table: MemoryTable,
  R: number,
  filter: FilterInput | undefined,
  sort: SortInput | undefined,
  limit: number
): string {
  return queryFingerprintOf(cursorKey, {
    tableId: table.id,
    R,
    schemaRevision: table.schemaRevision,
    filter:
      filter === undefined ? null : { logic: filter.logic, conditions: filter.conditions, groups: filter.groups ?? [] },
    sort: sort ?? null,
    limit,
    semanticsVersion: SEMANTICS_VERSION,
    collation: SEMANTICS_COLLATION,
    nullOrdering: SEMANTICS_NULL_ORDERING,
  });
}

function semanticsOf(table: MemoryTable): QuerySemantics {
  const operatorsByColumnType: Record<string, QueryOperator[]> = {};
  for (const type of [...new Set(table.columns.map((column) => column.type))]) {
    const column = table.columns.find((entry) => entry.type === type);
    if (column === undefined) continue;
    const bridge = columnAsBridge(column);
    const annotation = columnAnnotation(bridge);
    operatorsByColumnType[type] = annotation.operators.map((op) => ({
      id: op,
      valueKind: annotation.valueless.has(op) ? "none" : bridge.refMany ? "list" : "scalar",
    }));
  }
  return {
    semanticsVersion: SEMANTICS_VERSION,
    collation: SEMANTICS_COLLATION,
    timezone: SEMANTICS_TIMEZONE,
    nullOrdering: SEMANTICS_NULL_ORDERING,
    operatorsByColumnType,
  };
}

/** The opaque continuation token: the payload signed under the instance's
 *  key (the `cursor_expired`'s first stand over the tampered / the
 *  foreign key's token). */
function buildCursor(
  cursorKey: Uint8Array,
  table: MemoryTable,
  R: number,
  filter: FilterInput | undefined,
  sort: SortInput | undefined,
  limit: number,
  afterRow: MemoryRow | null
): string {
  return signCursor(cursorKey, {
    tableId: table.id,
    R,
    fp: queryFingerprint(cursorKey, table, R, filter, sort, limit),
    filter: filter ?? null,
    sort: sort ?? null,
    limit,
    afterOrderKey: afterRow === null ? null : afterRow.orderKey,
    afterRowId: afterRow === null ? null : afterRow.id,
  });
}

export { buildCursor, orderedQueryRows, queryFingerprint, semanticsOf, validateQuery };
