/** The database table hook's pure helpers: the cell-value equality, the
 *  wire → grid shapes' mapping (the column's reference / number display to
 *  the flat stand), the write's context stand, and the structured error's
 *  code. */
import { isBridgeError } from "../bridge";
import type {
  BridgeColumn,
  BridgeErrorCode,
  BridgeTableDescription,
  Column,
  MutationContext,
  TableDescription,
} from "../bridge";

/** The cell-value equality (null / undefined stand as the empty cell). */
function cellValueEqual(current: unknown, next: unknown): boolean {
  if (current === undefined || current === null) return next === undefined || next === null;
  return current === next;
}

/** The wire column's grid stand: the reference relation maps to the
 *  `refKind` / `refTableId` / `refMany` / `refDisplayColumn`, the number
 *  display's nested object stands the flat fields. */
function columnToGrid(column: Column): BridgeColumn {
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
    ...(column.numberDisplay !== undefined
      ? {
          ...(column.numberDisplay.decimals !== undefined ? { decimals: column.numberDisplay.decimals } : {}),
          ...(column.numberDisplay.thousands !== undefined ? { thousands: column.numberDisplay.thousands } : {}),
          ...(column.numberDisplay.prefix !== undefined ? { prefix: column.numberDisplay.prefix } : {}),
          ...(column.numberDisplay.suffix !== undefined ? { suffix: column.numberDisplay.suffix } : {}),
          ...(column.numberDisplay.allowNegative !== undefined
            ? { allowNegative: column.numberDisplay.allowNegative }
            : {}),
        }
      : {}),
  };
  return bridge;
}

/** The wire table description's grid stand (the grid reads the `name`
 *  flat over the wire's `TableDescription`). */
function descriptionToGrid(description: TableDescription): BridgeTableDescription {
  return {
    name: description.table.name,
    columns: description.columns.map(columnToGrid),
  };
}

/** The write's context: the fresh client-issued operation id (a UUID,
 *  unique within the retention) + the issue time. Every user action stands
 *  a fresh `operationId` — the id is never reused across logical
 *  operations, and a failed write is reconciled by the SAME id (the
 *  bridge's idempotency), never a silent new one. */
function newMutationContext(): MutationContext {
  return { operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() };
}

/** The structured error's code (null = the failure carries no machine
 *  code — the transport-level stand). */
function errorCodeOf(error: unknown): BridgeErrorCode | null {
  return isBridgeError(error) ? error.code : null;
}

/** The table-level fatal codes (the contract's `not_found` / `forbidden`
 *  stand): the table is gone for this client (deleted / foreign / the
 *  permission lost) — the operation stops and the sensitive cache (the
 *  rows, the cursor, the revisions) stands cleared, the delivery stops.
 *  The write's `not_found` (the GC'd row / the deleted column residue)
 *  is the row-level stand — it stands NOT fatal (the table stands alive,
 *  the failed op stands retryable). */
function isFatalTableError(error: unknown): boolean {
  const code = errorCodeOf(error);
  return code === "not_found" || code === "forbidden";
}

export { cellValueEqual, columnToGrid, descriptionToGrid, errorCodeOf, isFatalTableError, newMutationContext };
