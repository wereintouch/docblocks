/**
 * The in-memory reference bridge's conformance helpers (shared over the
 * suite's theme files): the write context, the recording subscription
 * observer, the seed table (the People's schema + rows), the rejected
 * error's code, and the signed token's oracle (the platform's HMAC stand
 * over the reference's pure implementation).
 */
import { isBridgeError } from "docblocks-react-ui";
import type { BridgeErrorCode, MutationContext, TableEvent } from "docblocks-react-ui";
import { createHmac } from "node:crypto";

import { createMemoryDatabaseBridge } from "../src/memory-bridge";

/** The test's write context (a fresh operation id per call). */
function ctx(operationId?: string): MutationContext {
  return {
    operationId: operationId ?? crypto.randomUUID(),
    issuedAt: new Date().toISOString(),
  };
}

/** The recording subscription observer (the stream stand). */
function recordingObserver() {
  const envelopes: TableEvent[] = [];
  const statuses: string[] = [];
  const resets: { code: string }[] = [];
  const observer = {
    envelopes,
    statuses,
    resets,
    ready: ({ afterSeq, headSeq }: { afterSeq: number; headSeq: number }) => {
      observer.readyValue = { afterSeq, headSeq };
    },
    event: (envelope: TableEvent) => {
      envelopes.push(envelope);
    },
    status: (value: string) => {
      statuses.push(value);
    },
    error: () => undefined,
    reset: (value: { code: string }) => {
      resets.push(value);
    },
    readyValue: null as null | { afterSeq: number; headSeq: number },
  };
  return observer;
}

/** Seeds a table over the bridge: the schema (the name / age columns) +
 *  the rows in the given order. Returns the table id + the row ids in the
 *  creation order. */
async function seedTable(bridge: ReturnType<typeof createMemoryDatabaseBridge>) {
  const tableReceipt = await bridge.createTable({ name: "People" }, ctx());
  const tableId = tableReceipt.result.id;
  const nameColumn = await bridge.createColumn(
    tableId,
    { column: { name: "Name", type: "text", position: 0, nullable: true } },
    ctx()
  );
  const ageColumn = await bridge.createColumn(
    tableId,
    { column: { name: "Age", type: "integer", position: 1, nullable: true } },
    ctx()
  );
  const rowIds: string[] = [];
  const people: Array<{ name: string; age: number | null }> = [
    { name: "Alice", age: 30 },
    { name: "Bob", age: null },
    { name: "Carol", age: 45 },
    { name: "Dan", age: 25 },
    { name: "Eve", age: 35 },
  ];
  for (const person of people) {
    const receipt = await bridge.batchRows(
      tableId,
      {
        ops: [
          {
            op: "create",
            row: { [nameColumn.result.id]: person.name, [ageColumn.result.id]: person.age },
            beforeRowId: null,
          },
        ],
      },
      ctx()
    );
    rowIds.push(receipt.result.rows[0]!.id);
  }
  return { tableId, nameColumnId: nameColumn.result.id, ageColumnId: ageColumn.result.id, rowIds };
}

/** The rejected error's code (null = not a bridge error). */
function codeOf(error: unknown): BridgeErrorCode | null {
  return isBridgeError(error) ? error.code : null;
}

/** The signed token's shape (the `v3:<body>.<signature>` stand). */
function signedTokenParts(token: string): { body: string; signature: string } {
  const rest = token.slice("v3:".length);
  const separator = rest.lastIndexOf(".");
  return { body: rest.slice(0, separator), signature: rest.slice(separator + 1) };
}

/** The base64url signature's hex (the deterministic test's golden stand). */
function signatureHex(token: string): string {
  const binary = atob(signedTokenParts(token).signature.replace(/-/g, "+").replace(/_/g, "/"));
  return Array.from(binary)
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
}

/** The platform's HMAC-SHA256 (the signature scheme's oracle — the test
 *  stand for the reference's pure implementation). */
function hmacSha256Base64Url(key: string, message: string): string {
  return createHmac("sha256", Buffer.from(key, "utf8")).update(Buffer.from(message, "utf8")).digest("base64url");
}

export { codeOf, ctx, hmacSha256Base64Url, recordingObserver, seedTable, signatureHex, signedTokenParts };
