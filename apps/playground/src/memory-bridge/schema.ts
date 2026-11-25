/**
 * The in-memory bridge's column-schema helpers (pure over the shared
 * state, which stands over the core): the registry order's reindex (the
 * `position` mirrors the array's index), the column create-spec's
 * validation (the name / type / position / nullability / the operators /
 * the reference relation / the number display), and the table's
 * checkpoint (the batch's rollback stand — the pre-batch state's clone +
 * restore).
 */
import type { Column, TableEvent } from "docblocks-react-ui";
import { BridgeError } from "docblocks-react-ui";

import type { MemoryRow, MemoryTable } from "./models";
import { clone } from "./utils";

/** The pre-batch table state (the `batchRows`'s rollback stand). */
interface TableCheckpoint {
  revision: string;
  columns: Column[];
  detachedColumns: Column[];
  rows: MemoryRow[];
  headSeq: number;
  envelopes: TableEvent[];
  schemaRevision: string;
  revisionCounter: number;
  nextRowSeq: number;
  nextColumnSeq: number;
}

function cloneTableCheckpoint(table: MemoryTable): TableCheckpoint {
  return clone({
    revision: table.revision,
    columns: table.columns,
    detachedColumns: table.detachedColumns,
    rows: table.rows,
    headSeq: table.headSeq,
    envelopes: table.envelopes,
    schemaRevision: table.schemaRevision,
    revisionCounter: table.revisionCounter,
    nextRowSeq: table.nextRowSeq,
    nextColumnSeq: table.nextColumnSeq,
  });
}

function restoreTableCheckpoint(table: MemoryTable, checkpoint: TableCheckpoint): void {
  table.revision = checkpoint.revision;
  table.columns = checkpoint.columns;
  table.detachedColumns = checkpoint.detachedColumns;
  table.rows = checkpoint.rows;
  table.headSeq = checkpoint.headSeq;
  table.envelopes = checkpoint.envelopes;
  table.schemaRevision = checkpoint.schemaRevision;
  table.revisionCounter = checkpoint.revisionCounter;
  table.nextRowSeq = checkpoint.nextRowSeq;
  table.nextColumnSeq = checkpoint.nextColumnSeq;
}

function reindexColumns(table: MemoryTable): void {
  table.columns.forEach((column, index) => {
    column.position = index;
  });
}

function validateColumnSpec(
  tables: Map<string, MemoryTable>,
  table: MemoryTable,
  spec: Omit<Column, "id" | "revision">
): void {
  if (typeof spec?.name !== "string" || spec.name.trim() === "") {
    throw new BridgeError("validation", "The column name must be a non-empty string.");
  }
  if (typeof spec?.type !== "string" || spec.type === "") {
    throw new BridgeError("validation", "The column type must be a non-empty string.");
  }
  if (typeof spec.position !== "number" || !Number.isInteger(spec.position) || spec.position < 0) {
    throw new BridgeError("validation", "The column position must be a non-negative integer.");
  }
  if (typeof spec.nullable !== "boolean")
    throw new BridgeError("validation", "The column nullability must be a boolean.");
  if (spec.operators !== undefined && !spec.operators.every((op) => typeof op === "string")) {
    throw new BridgeError("validation", "The column operators must be strings.");
  }
  const reference = spec.reference;
  if (reference !== undefined) {
    if (reference.kind !== "enum" && reference.kind !== "row") {
      throw new BridgeError("validation", 'The column reference kind must be "enum" or "row".');
    }
    if (typeof reference.many !== "boolean") {
      throw new BridgeError("validation", "The column reference cardinality must be a boolean.");
    }
    const linked = tables.get(reference.tableId);
    if (linked === undefined) {
      throw new BridgeError("not_found", `The referenced table "${reference.tableId}" is unknown.`);
    }
    if (
      reference.displayColumnId !== undefined &&
      !linked.columns.some((column) => column.id === reference.displayColumnId)
    ) {
      throw new BridgeError(
        "invalid_column",
        `The reference display column "${reference.displayColumnId}" is unknown in the linked table.`
      );
    }
  }
  if (spec.numberDisplay !== undefined) {
    const display = spec.numberDisplay;
    if (
      display.decimals !== undefined &&
      (typeof display.decimals !== "number" || !Number.isInteger(display.decimals) || display.decimals < 0)
    ) {
      throw new BridgeError("validation", "The number display decimals must be a non-negative integer.");
    }
    for (const key of ["thousands", "allowNegative"] as const) {
      if (display[key] !== undefined && typeof display[key] !== "boolean") {
        throw new BridgeError("validation", `The number display ${key} must be a boolean.`);
      }
    }
    for (const key of ["prefix", "suffix"] as const) {
      if (display[key] !== undefined && typeof display[key] !== "string") {
        throw new BridgeError("validation", `The number display ${key} must be a string.`);
      }
    }
  }
}

export { cloneTableCheckpoint, reindexColumns, restoreTableCheckpoint, validateColumnSpec };
export type { TableCheckpoint };
