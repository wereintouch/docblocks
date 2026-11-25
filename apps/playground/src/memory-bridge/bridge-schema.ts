/**
 * The in-memory bridge's column-schema operations (over the core): the
 * create over the anchor (the position's clamp stand), the patch's
 * all-or-nothing update (the full spec's pre-validation + the position's
 * re-insert), the soft delete (the definition's detachment — the cells
 * stay in the rows), and the restore (the schema's re-insert over the
 * detached state). Every op stands the idempotent + the envelope's publish.
 */
import type { Column, MutationContext, MutationReceipt } from "docblocks-react-ui";
import { BridgeError } from "docblocks-react-ui";

import { noOpReceipt } from "./core";
import type { MemoryBridgeCore } from "./core";
import { nextRevision } from "./rows";
import { reindexColumns, validateColumnSpec } from "./schema";
import { clone, deepEqual } from "./utils";

async function createColumn(
  core: MemoryBridgeCore,
  tableId: string,
  input: { column: Omit<Column, "id" | "revision">; afterColumnId?: string },
  ctx: MutationContext
): Promise<MutationReceipt<Column>> {
  const table = core.tableOf(tableId);
  validateColumnSpec(core.tables, table, input.column);
  const fingerprint = core.fingerprintOf("createColumn", {
    tableId,
    column: input.column,
    afterColumnId: input.afterColumnId ?? null,
  });
  return core.idempotent(ctx, fingerprint, () => {
    let position: number;
    if (input.afterColumnId !== undefined) {
      const anchor = table.columns.findIndex((column) => column.id === input.afterColumnId);
      if (anchor === -1)
        throw new BridgeError("invalid_column", `The anchor column "${input.afterColumnId}" is unknown.`);
      position = anchor + 1;
    } else {
      position = Math.min(input.column.position, table.columns.length);
    }
    const column: Column = {
      id: `c-${table.id}-${++table.nextColumnSeq}`,
      name: input.column.name,
      type: input.column.type,
      position,
      nullable: input.column.nullable,
      revision: nextRevision(table),
      ...(input.column.operators !== undefined ? { operators: [...input.column.operators] } : {}),
      ...(input.column.reference !== undefined ? { reference: clone(input.column.reference) } : {}),
      ...(input.column.numberDisplay !== undefined ? { numberDisplay: clone(input.column.numberDisplay) } : {}),
    };
    table.columns.splice(position, 0, column);
    reindexColumns(table);
    table.schemaRevision = nextRevision(table);
    const wire = clone(column);
    return core.publish(table, ctx.operationId, wire, { [column.id]: column.revision }, [
      { type: "field.created", payload: { column: wire, schemaRevision: table.schemaRevision } },
    ]);
  });
}

async function updateColumn(
  core: MemoryBridgeCore,
  tableId: string,
  columnId: string,
  patch: Partial<Omit<Column, "id" | "revision">>,
  ctx: MutationContext
): Promise<MutationReceipt<Column>> {
  const table = core.tableOf(tableId);
  const column = table.columns.find((entry) => entry.id === columnId);
  if (column === undefined) throw new BridgeError("invalid_column", `The column "${columnId}" is unknown.`);
  const fingerprint = core.fingerprintOf("updateColumn", { tableId, columnId, patch });
  return core.idempotent(ctx, fingerprint, () => {
    // Pre-validate the whole patch before the mutation: the patch merged
    // over the current column stands the complete spec (the create's
    // full validation — the per-key check stood the name / the nullable
    // / the position only and missed the numberDisplay / the operators
    // / the reference's contract), and the invalid spec stands no
    // partial apply (the patch's all-or-nothing stand).
    const spec: Record<string, unknown> = { ...column };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || key === "id" || key === "revision") continue;
      spec[key] = value;
    }
    validateColumnSpec(core.tables, table, spec as Omit<Column, "id" | "revision">);
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || key === "id" || key === "revision" || deepEqual(column[key as keyof Column], value))
        continue;
      (column as unknown as Record<string, unknown>)[key] = clone(value);
      changed = true;
    }
    if (!changed) return noOpReceipt(ctx, table, clone(column));
    // The position patch stands the move (the reindex rewrites the
    // positions over the array's order — the patch's value stands the
    // re-insert at the target index, not the stored number): the
    // clamped stand (the create's Math.min position over the insert
    // index stands the move's last-index stand).
    const at = table.columns.indexOf(column);
    if (typeof patch.position === "number" && Number.isInteger(patch.position) && patch.position >= 0) {
      const target = Math.min(patch.position, table.columns.length - 1);
      if (target !== at) {
        table.columns.splice(at, 1);
        table.columns.splice(target, 0, column);
      }
    }
    reindexColumns(table);
    table.schemaRevision = nextRevision(table);
    column.revision = nextRevision(table);
    const wire = clone(column);
    return core.publish(table, ctx.operationId, wire, { [columnId]: column.revision }, [
      { type: "field.updated", payload: { column: wire, schemaRevision: table.schemaRevision } },
    ]);
  });
}

async function deleteColumn(
  core: MemoryBridgeCore,
  tableId: string,
  columnId: string,
  ctx: MutationContext
): Promise<MutationReceipt<{ columnId: string }>> {
  const table = core.tableOf(tableId);
  const fingerprint = core.fingerprintOf("deleteColumn", { tableId, columnId });
  // The state check stands the fresh execution only (inside the
  // closure): a replay of the committed delete must stand the stored
  // receipt, not the not_found of the already-gone column.
  return core.idempotent(ctx, fingerprint, () => {
    const at = table.columns.findIndex((column) => column.id === columnId);
    if (at === -1) throw new BridgeError("not_found", `The column "${columnId}" is unknown or already deleted.`);
    const column = table.columns.splice(at, 1)[0]!;
    reindexColumns(table);
    table.detachedColumns.push(column);
    table.schemaRevision = nextRevision(table);
    column.revision = nextRevision(table);
    const before = clone(column);
    return core.publish(table, ctx.operationId, { columnId }, { [columnId]: column.revision }, [
      { type: "field.deleted", payload: { columnId, before, schemaRevision: table.schemaRevision } },
    ]);
  });
}

async function restoreDeletedColumn(
  core: MemoryBridgeCore,
  tableId: string,
  columnId: string,
  ctx: MutationContext
): Promise<MutationReceipt<Column>> {
  const table = core.tableOf(tableId);
  const live = table.columns.find((column) => column.id === columnId);
  if (live !== undefined) {
    const fingerprint = core.fingerprintOf("restoreDeletedColumn", { tableId, columnId });
    return core.idempotent(ctx, fingerprint, () => noOpReceipt(ctx, table, clone(live)));
  }
  const at = table.detachedColumns.findIndex((column) => column.id === columnId);
  if (at === -1) throw new BridgeError("not_found", `No deleted column "${columnId}" to restore.`);
  const fingerprint = core.fingerprintOf("restoreDeletedColumn", { tableId, columnId });
  return core.idempotent(ctx, fingerprint, () => {
    const column = table.detachedColumns.splice(at, 1)[0]!;
    table.columns.splice(Math.min(column.position, table.columns.length), 0, column);
    reindexColumns(table);
    table.schemaRevision = nextRevision(table);
    column.revision = nextRevision(table);
    const wire = clone(column);
    return core.publish(table, ctx.operationId, wire, { [columnId]: column.revision }, [
      { type: "field.restored", payload: { column: wire, schemaRevision: table.schemaRevision } },
    ]);
  });
}

export { createColumn, deleteColumn, restoreDeletedColumn, updateColumn };
