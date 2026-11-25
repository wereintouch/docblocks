/**
 * The in-memory bridge's row / table helpers (pure over the shared state,
 * which stands over the core): the wire shapes (the table ref, the row
 * wire), the retained physical order (live + the tombstoned rows), the row
 * lookup, the revision / tx ids, the order-key allocation (the normative
 * candidate + the full baseline rebalance), the move's no-op stand, the
 * cell value's validation, the CAS assert, the enum option's live-reference
 * guard, and the display value's text.
 */
import type { BridgeErrorCode, RowWire, TableRef } from "docblocks-react-ui";

import type { MemoryRow, MemoryTable } from "./models";
import { clone, physicalCompare } from "./utils";

function tableRefOf(table: MemoryTable): TableRef {
  return {
    id: table.id,
    name: table.name,
    revision: table.revision,
    ...(table.system ? { system: true } : {}),
  };
}

function rowWireOf(row: MemoryRow): RowWire {
  return { id: row.id, orderKey: row.orderKey, revision: row.revision, cells: clone(row.cells) };
}

/** The retained physical order (the live + the tombstoned rows) sorted by
 *  `(orderKey, id)`. */
function physicalOrder(table: MemoryTable): MemoryRow[] {
  return [...table.rows].sort((a, b) => physicalCompare(a, b));
}

function liveRows(table: MemoryTable): MemoryRow[] {
  return physicalOrder(table).filter((row) => row.deletedAt === null);
}

function liveRowOf(table: MemoryTable, rowId: string): MemoryRow | undefined {
  return table.rows.find((row) => row.id === rowId && row.deletedAt === null);
}

function nextRevision(table: MemoryTable): string {
  table.revisionCounter += 1;
  return `rev-${table.revisionCounter}`;
}

function newTxId(): string {
  return `tx-${Math.random().toString(36).slice(2, 12)}`;
}

/** The order key allocation: the normative candidate for the (left,
 *  right) bounds — the right bound − 1 for the head, the mean for the
 *  middle, the left bound + 1 for the tail. The bounds read over the
 *  RETAINED rows (a tombstone between two live rows keeps its key), the
 *  anchor is a live row. A collapse / occupancy triggers the full
 *  baseline rebalance: the retained sequence is rewritten to the dense
 *  integers, the bounds are re-read, and the candidate is validated
 *  again — the original op is then written exactly once. */
function allocateOrderKey(
  table: MemoryTable,
  beforeRowId: string | null,
  movingRowId: string | undefined,
  fail: (code: BridgeErrorCode, message: string) => never
): { key: number; rebalanced: boolean } {
  const bounds = (retained: MemoryRow[]): { left: MemoryRow | undefined; right: MemoryRow | undefined } => {
    const live = retained.filter((row) => row.deletedAt === null);
    if (beforeRowId === null) {
      return { left: retained[retained.length - 1], right: undefined };
    }
    const anchorIndex = live.findIndex((row) => row.id === beforeRowId);
    if (anchorIndex === -1) fail("not_found", `The anchor row "${beforeRowId}" is unknown or deleted.`);
    const anchor = live[anchorIndex]!;
    const retainedIndex = retained.findIndex((row) => row.id === anchor.id);
    return { left: retainedIndex > 0 ? retained[retainedIndex - 1] : undefined, right: anchor };
  };
  const candidate = (left: MemoryRow | undefined, right: MemoryRow | undefined): number =>
    right === undefined
      ? (left?.orderKey ?? 0) + 1
      : left === undefined
        ? right.orderKey - 1
        : left.orderKey + (right.orderKey - left.orderKey) / 2;
  const valid = (
    key: number,
    retained: MemoryRow[],
    left: MemoryRow | undefined,
    right: MemoryRow | undefined
  ): boolean => {
    if (!Number.isFinite(key)) return false;
    if (right === undefined) {
      if (left !== undefined && key <= left.orderKey) return false;
    } else if (left === undefined) {
      if (key >= right.orderKey) return false;
    } else if (key <= left.orderKey || key >= right.orderKey) {
      return false;
    }
    return !retained.some((row) => row.id !== movingRowId && row.orderKey === key);
  };
  const retained = physicalOrder(table);
  const { left, right } = bounds(retained);
  const key = candidate(left, right);
  if (valid(key, retained, left, right)) return { key, rebalanced: false };
  // The collapse / occupancy: the full baseline rebalance within the
  // same transaction.
  retained.forEach((row, index) => {
    row.orderKey = index + 1;
  });
  const retained2 = physicalOrder(table);
  const bounds2 = bounds(retained2);
  const rebalancedKey = candidate(bounds2.left, bounds2.right);
  if (!valid(rebalancedKey, retained2, bounds2.left, bounds2.right)) {
    fail("conflict", "The row order allocation is still invalid after the rebalance; the batch rolled back.");
  }
  return { key: rebalancedKey, rebalanced: true };
}

/** The move's no-op stand: the row is already the immediate predecessor
 *  of the anchor (or already at the requested tail / head) in the
 *  VISIBLE order. */
function moveIsNoOp(table: MemoryTable, rowId: string, beforeRowId: string | null): boolean {
  const live = physicalOrder(table).filter((row) => row.deletedAt === null);
  if (beforeRowId === null) return live[live.length - 1]?.id === rowId;
  if (beforeRowId === rowId) return true;
  const index = live.findIndex((row) => row.id === rowId);
  if (index === -1) return false;
  return live[index + 1]?.id === beforeRowId;
}

function stripUndefinedCells(cells: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cells)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** The cell keys against the schema + the value stands (the unknown
 *  column, the null into the non-nullable, the non-scalar into the
 *  plain column, the non-array into the many reference). */
function validateCells(
  table: MemoryTable,
  cells: Record<string, unknown>,
  fail: (code: BridgeErrorCode, message: string) => never
): void {
  for (const [fieldId, value] of Object.entries(cells)) {
    const column = table.columns.find((entry) => entry.id === fieldId);
    if (column === undefined) fail("invalid_column", `The cell references the unknown column "${fieldId}".`);
    if (value === null && !column.nullable) fail("validation", `The column "${column.name}" is not nullable.`);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      fail("validation", `The column "${column.name}" holds scalar values (or an id array for a many reference).`);
    }
    // The wire's JSON stand: a non-JSON value (function / symbol / BigInt)
    // would stand silently dropped over the JSON round-trip — it is
    // rejected, not stored (the receipt stands the full data).
    if (value !== null && (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint")) {
      fail("validation", `The column "${column.name}" holds a non-JSON value (the wire's JSON stand).`);
    }
    // The wire's JSON stand: a non-finite number stands the null over the
    // JSON round-trip (the silent corruption) — it is rejected, not
    // stored (the top-level value or the many-reference array's element).
    if (
      (typeof value === "number" && !Number.isFinite(value)) ||
      (Array.isArray(value) && value.some((element) => typeof element === "number" && !Number.isFinite(element)))
    ) {
      fail("validation", `The column "${column.name}" holds a non-finite number (the wire's JSON stand).`);
    }
    if (column.reference !== undefined && column.reference.many && value !== null && !Array.isArray(value)) {
      fail("validation", `The column "${column.name}" is a many reference and holds an id array.`);
    }
  }
}

function assertCas(
  current: string,
  expected: string | undefined,
  fail: (code: BridgeErrorCode, message: string) => never,
  what: string
): void {
  if (expected !== undefined && expected !== current) {
    fail("conflict", `The expected revision of ${what} is stale (expected "${expected}", current "${current}").`);
  }
}

/** The enum option's live-reference guard: the delete of an option row
 *  a live cell of a `kind: "enum"` column references (the scalar match
 *  or the many array's membership) stands the default refusal — the
 *  explicit replacement migration is the consumer's separate operation,
 *  never a plain delete. */
function assertNoLiveEnumOptionReference(
  tables: Map<string, MemoryTable>,
  source: MemoryTable,
  rowId: string,
  fail: (code: BridgeErrorCode, message: string) => never
): void {
  for (const other of tables.values()) {
    for (const column of other.columns) {
      const reference = column.reference;
      if (reference === undefined || reference.kind !== "enum" || reference.tableId !== source.id) continue;
      for (const row of liveRows(other)) {
        const value = row.cells[column.id];
        const referenced = value === rowId || (Array.isArray(value) && value.includes(rowId));
        if (referenced) {
          fail("enum.option_in_use", `The enum option "${rowId}" is referenced by a live cell of table "${other.id}".`);
        }
      }
    }
  }
}

/** The cell value as display text (null / undefined = empty). */
function formatCellDisplay(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    const parts = value.map((item) => formatCellDisplay(item)).filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export {
  allocateOrderKey,
  assertCas,
  assertNoLiveEnumOptionReference,
  formatCellDisplay,
  liveRowOf,
  liveRows,
  moveIsNoOp,
  newTxId,
  nextRevision,
  physicalOrder,
  rowWireOf,
  stripUndefinedCells,
  tableRefOf,
  validateCells,
};
