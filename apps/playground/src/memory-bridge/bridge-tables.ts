/**
 * The in-memory bridge's table-level operations (over the core): the
 * protocol descriptor, the tables catalog (the system tables' stand out),
 * the create (the id's allocation over the name's slug) + the rename —
 * the idempotent, the envelope's publish — and the schema's read.
 */
import type {
  MutationContext,
  MutationReceipt,
  ProtocolDescriptor,
  TableDescription,
  TableRef,
} from "docblocks-react-ui";
import { BridgeError } from "docblocks-react-ui";

import { noOpReceipt } from "./core";
import type { MemoryBridgeCore } from "./core";
import type { MemoryTable } from "./models";
import { nextRevision, tableRefOf } from "./rows";
import { clone, tableIdFor } from "./utils";

async function describeProtocol(core: MemoryBridgeCore): Promise<ProtocolDescriptor> {
  return core.descriptor;
}

async function listTables(core: MemoryBridgeCore): Promise<TableRef[]> {
  return [...core.tables.values()].filter((table) => !table.system).map(tableRefOf);
}

async function createTable(
  core: MemoryBridgeCore,
  input: { name: string; system?: boolean },
  ctx: MutationContext
): Promise<MutationReceipt<TableRef>> {
  const name = typeof input.name === "string" ? input.name : "";
  if (name.trim() === "") throw new BridgeError("validation", "The table name must be a non-empty string.");
  const fingerprint = core.fingerprintOf("createTable", { name, system: input.system === true });
  return core.idempotent(ctx, fingerprint, () => {
    const base = tableIdFor(name);
    let id = base;
    let suffix = 2;
    while (core.tables.has(id)) id = `${base}-${suffix++}`;
    const table: MemoryTable = {
      id,
      name,
      system: input.system === true,
      revision: "",
      columns: [],
      detachedColumns: [],
      rows: [],
      headSeq: 0,
      envelopes: [],
      schemaRevision: "",
      revisionCounter: 0,
      nextRowSeq: 0,
      nextColumnSeq: 0,
    };
    table.revision = nextRevision(table);
    table.schemaRevision = nextRevision(table);
    core.tables.set(id, table);
    const ref = tableRefOf(table);
    return core.publish(table, ctx.operationId, ref, { [id]: ref.revision }, [
      {
        type: "table.created",
        payload: { table: { table: ref, columns: [], schemaRevision: table.schemaRevision } },
      },
    ]);
  });
}

async function renameTable(
  core: MemoryBridgeCore,
  tableId: string,
  input: { name: string },
  ctx: MutationContext
): Promise<MutationReceipt<TableRef>> {
  const table = core.tableOf(tableId);
  const name = typeof input.name === "string" ? input.name : "";
  if (name.trim() === "") throw new BridgeError("validation", "The table name must be a non-empty string.");
  const fingerprint = core.fingerprintOf("renameTable", { tableId, name });
  return core.idempotent(ctx, fingerprint, () => {
    if (table.name === name) return noOpReceipt(ctx, table, tableRefOf(table));
    table.name = name;
    table.revision = nextRevision(table);
    const ref = tableRefOf(table);
    return core.publish(table, ctx.operationId, ref, { [tableId]: ref.revision }, [
      { type: "table.renamed", payload: { table: ref } },
    ]);
  });
}

async function describeTable(core: MemoryBridgeCore, tableId: string): Promise<TableDescription> {
  const table = core.tableOf(tableId);
  return { table: tableRefOf(table), columns: clone(table.columns), schemaRevision: table.schemaRevision };
}

export { createTable, describeProtocol, describeTable, listTables, renameTable };
