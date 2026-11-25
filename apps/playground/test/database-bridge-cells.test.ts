/** The in-memory reference bridge's conformance — the cell's validation. */
import { describe, expect, it } from "vitest";

import { createMemoryDatabaseBridge } from "../src/memory-bridge";
import { codeOf, ctx } from "./database-bridge-helpers";

describe("the cell's validation", () => {
  it("the unknown column / the non-nullable null / the non-scalar reject the op", async () => {
    const bridge = createMemoryDatabaseBridge();
    const tableReceipt = await bridge.createTable({ name: "Strict" }, ctx());
    const tableId = tableReceipt.result.id;
    const column = await bridge.createColumn(
      tableId,
      { column: { name: "Value", type: "text", position: 0, nullable: false } },
      ctx()
    );
    const badColumn = await bridge
      .batchRows(tableId, { ops: [{ op: "create", row: { nope: "x" }, beforeRowId: null }] }, ctx())
      .catch((operationError: unknown) => operationError);
    expect(codeOf(badColumn)).toBe("invalid_column");
    const nonNullable = await bridge
      .batchRows(tableId, { ops: [{ op: "create", row: { [column.result.id]: null }, beforeRowId: null }] }, ctx())
      .catch((operationError: unknown) => operationError);
    expect(codeOf(nonNullable)).toBe("validation");
    const nonScalar = await bridge
      .batchRows(
        tableId,
        { ops: [{ op: "create", row: { [column.result.id]: { nested: true } }, beforeRowId: null }] },
        ctx()
      )
      .catch((operationError: unknown) => operationError);
    expect(codeOf(nonScalar)).toBe("validation");
    // The non-finite number stands the wire's JSON stand (the round-trip
    // stands the null — the silent corruption): the top-level value and
    // the array's element stand rejected.
    const infinity = await bridge
      .batchRows(tableId, { ops: [{ op: "create", row: { [column.result.id]: Infinity }, beforeRowId: null }] }, ctx())
      .catch((operationError: unknown) => operationError);
    expect(codeOf(infinity)).toBe("validation");
    const minusInfinity = await bridge
      .batchRows(tableId, { ops: [{ op: "create", row: { [column.result.id]: -Infinity }, beforeRowId: null }] }, ctx())
      .catch((operationError: unknown) => operationError);
    expect(codeOf(minusInfinity)).toBe("validation");
    const inArray = await bridge
      .batchRows(
        tableId,
        { ops: [{ op: "create", row: { [column.result.id]: ["ok", Infinity] }, beforeRowId: null }] },
        ctx()
      )
      .catch((operationError: unknown) => operationError);
    expect(codeOf(inArray)).toBe("validation");
    // The non-JSON value (function / symbol / BigInt) stands rejected —
    // the JSON round-trip would stand it silently dropped (the receipt
    // stands the full data).
    const asFunction = await bridge
      .batchRows(tableId, { ops: [{ op: "create", row: { [column.result.id]: () => 1 }, beforeRowId: null }] }, ctx())
      .catch((operationError: unknown) => operationError);
    expect(codeOf(asFunction)).toBe("validation");
    const asBigint = await bridge
      .batchRows(tableId, { ops: [{ op: "create", row: { [column.result.id]: 10n }, beforeRowId: null }] }, ctx())
      .catch((operationError: unknown) => operationError);
    expect(codeOf(asBigint)).toBe("validation");
    // The finite number stands the pass (the stand is the finiteness, not
    // the type — the contract's type-agnostic stand).
    await bridge.batchRows(
      tableId,
      { ops: [{ op: "create", row: { [column.result.id]: 42 }, beforeRowId: null }] },
      ctx()
    );
  });
});
