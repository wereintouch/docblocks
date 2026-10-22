import { describe, expect, it } from "vitest";

import { columnAnnotation, conditionMatches, parseCellValue } from "../src/database/bridge";
import { createMemoryDatabaseBridge } from "../src/database/memory-bridge";

describe("the default bridge — the ref contract (the dict tables / the updateColumn / the row displays)", () => {
  it("stands the pk-value rows over the dict tables (the row id = the pk value)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const id = await bridge.createTable("Statuses");
    await bridge.insertRows(id, [{ id: "todo" }, { id: "doing" }]);
    const page = await bridge.queryRows(id, {});
    // The row ids stand the pk values (the option labels), not the
    // derived counters.
    expect(Object.keys(page.rows).sort()).toEqual(["doing", "todo"]);
    // The pk value is not a cell (the bridge-managed stand).
    expect(page.rows["todo"] ?? {}).toEqual({});
    // The idempotent re-seed (the channel's instances converge): the
    // repeat insert stands the same row.
    const rowId = await bridge.insertRow(id, { id: "todo" });
    expect(rowId).toBe("todo");
    const after = await bridge.queryRows(id, {});
    expect(Object.keys(after.rows).sort()).toEqual(["doing", "todo"]);
  });

  it("the updateColumn's patch stands the attributes (the name keeps; the zero patch is a no-op)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const id = await bridge.createTable("T");
    await bridge.createColumn(id, { id: "n", name: "N", type: "integer" });
    await bridge.updateColumn(id, "n", { decimals: 2, prefix: "₽" });
    let schema = await bridge.describeTable(id);
    expect(schema.columns[0]).toEqual({ id: "n", name: "N", type: "integer", decimals: 2, prefix: "₽" });
    // The name stands the renameColumn's domain (the patch's name entry
    // stands skipped — the typed patch does not carry it).
    await bridge.renameColumn(id, "n", "Budget");
    schema = await bridge.describeTable(id);
    expect(schema.columns[0]!.name).toBe("Budget");
    // The unknown column rejects.
    await expect(bridge.updateColumn(id, "missing", { decimals: 1 })).rejects.toThrow("Unknown column");
  });

  it("the resolveRowDisplay stands the display column (the declared / the first text / the pk)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const id = await bridge.createTable("People");
    await bridge.createColumn(id, { id: "code", name: "Code", type: "text" });
    await bridge.createColumn(id, { id: "full", name: "Full name", type: "text" });
    const [a, b] = (await bridge.insertRows(id, [
      { code: "P-1", full: "Ann P." },
      { code: "P-2", full: "Bob P." },
    ])) as [string, string];
    // The declared display column.
    const declared = await bridge.resolveRowDisplay(id, [a, b], "code");
    expect(declared).toEqual({ [a]: "P-1", [b]: "P-2" });
    // The default (the first text column).
    const firstText = await bridge.resolveRowDisplay(id, [a]);
    expect(firstText).toEqual({ [a]: "P-1" });
    // The dead row stands the empty display.
    const dead = await bridge.resolveRowDisplay(id, ["r-x-99"]);
    expect(dead).toEqual({ "r-x-99": "" });
    await bridge.removeRow(id, a);
    // The removed row stands the empty stand (the trash keeps the cells, the
    // display resolution reads the live rows).
    expect(await bridge.resolveRowDisplay(id, [a])).toEqual({ [a]: "" });
  });

  it("the array cell values stand the junction emulation (the updateRow's array stand)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const id = await bridge.createTable("T");
    const rowId = await bridge.insertRow(id, {});
    await bridge.updateRow(id, rowId, { tags: ["a", "b"] });
    const page = await bridge.queryRows(id, {});
    expect(page.rows[rowId]!.tags).toEqual(["a", "b"]);
    // The array's update stand (the before snapshot keeps the old array).
    await bridge.updateRow(id, rowId, { tags: ["b"] });
    const after = await bridge.queryRows(id, {});
    expect(after.rows[rowId]!.tags).toEqual(["b"]);
  });
});

describe("columnAnnotation — the Postgres type catalog", () => {
  it("maps the text-like types to the text input + the string operators", () => {
    for (const type of ["text", "varchar", "citext", "inet", "bytea", "xml"]) {
      const a = columnAnnotation({ id: "c", name: "c", type });
      expect(a.valueInput).toBe("text");
      expect(a.operators).toContain("contains");
      expect(a.operators).toContain("empty");
    }
  });

  it("maps the numeric types to the number input + the comparison operators", () => {
    for (const type of [
      "integer",
      "int",
      "bigint",
      "smallint",
      "numeric",
      "decimal",
      "real",
      "double precision",
      "money",
    ]) {
      const a = columnAnnotation({ id: "c", name: "c", type });
      expect(a.valueInput).toBe("number");
      expect(a.operators).toContain(">");
      expect(a.operators).toContain("between");
    }
  });

  it("maps the boolean type to the boolean input + the equality operators", () => {
    const a = columnAnnotation({ id: "c", name: "c", type: "boolean" });
    expect(a.valueInput).toBe("boolean");
    expect(a.operators).toEqual(["is", "is not"]);
  });

  it("maps date to the date input and timestamp / timestamptz to the datetime input", () => {
    expect(columnAnnotation({ id: "c", name: "c", type: "date" }).valueInput).toBe("date");
    expect(columnAnnotation({ id: "c", name: "c", type: "timestamp" }).valueInput).toBe("datetime");
    expect(columnAnnotation({ id: "c", name: "c", type: "timestamptz" }).valueInput).toBe("datetime");
    expect(columnAnnotation({ id: "c", name: "c", type: "timestamp" }).operators).toContain("before");
  });

  it("maps time to the text input + the time operators and interval to the equality operators", () => {
    const t = columnAnnotation({ id: "c", name: "c", type: "time" });
    expect(t.valueInput).toBe("text");
    expect(t.operators).toContain("before");
    const i = columnAnnotation({ id: "c", name: "c", type: "interval" });
    expect(i.valueInput).toBe("text");
    expect(i.operators).toEqual(["is", "is not"]);
  });

  it("resolves an array type through its base type", () => {
    expect(columnAnnotation({ id: "c", name: "c", type: "integer[]" }).valueInput).toBe("number");
    expect(columnAnnotation({ id: "c", name: "c", type: "text[]" }).valueInput).toBe("text");
  });

  it("falls back to the minimal operators + the text input for an unknown type", () => {
    const a = columnAnnotation({ id: "c", name: "c", type: "some_custom_type" });
    expect(a.valueInput).toBe("text");
    expect(a.operators).toEqual(["is", "is not"]);
  });

  it("stands the former uuid / json types as unknown (the minimal fallback)", () => {
    // The types left the package's catalog (the consumer's bridge may still
    // define them): they stand the unknown-type fallback (the minimal
    // `is` / `is not` + the text input — no dedicated editor).
    for (const type of ["uuid", "json", "jsonb"]) {
      const a = columnAnnotation({ id: "c", name: "c", type });
      expect(a.valueInput).toBe("text");
      expect(a.operators).toEqual(["is", "is not"]);
    }
  });

  it("lets the consumer operators override win over the ref columns", () => {
    expect(columnAnnotation({ id: "c", name: "c", type: "integer", operators: ["is", "gt"] }).operators).toEqual([
      "is",
      "gt",
    ]);
    // The consumer's override stands the ref's catalog (the type-agnostic
    // contract: the consumer declares its own operator set).
    expect(
      columnAnnotation({ id: "c", name: "c", type: "text", refKind: "enum", refTableId: "t", operators: ["in"] })
        .operators
    ).toEqual(["in"]);
  });

  it("maps the ref columns to the ref value inputs (the enum / the row-link)", () => {
    const enumColumn = columnAnnotation({ id: "c", name: "c", type: "text", refKind: "enum", refTableId: "t" });
    expect(enumColumn.valueInput).toBe("enum");
    expect(enumColumn.operators).toEqual(["is", "is not"]);
    const multiEnum = columnAnnotation({
      id: "c",
      name: "c",
      type: "text",
      refKind: "enum",
      refTableId: "t",
      refMany: true,
    });
    expect(multiEnum.valueInput).toBe("enum");
    expect(multiEnum.operators).toEqual(["is", "is not", "empty", "not empty"]);
    const rowLink = columnAnnotation({ id: "c", name: "c", type: "text", refKind: "row", refTableId: "t" });
    expect(rowLink.valueInput).toBe("row-link");
    expect(rowLink.operators).toEqual(["is", "is not"]);
    const rowLinks = columnAnnotation({
      id: "c",
      name: "c",
      type: "text",
      refKind: "row",
      refTableId: "t",
      refMany: true,
    });
    expect(rowLinks.valueInput).toBe("row-link");
    expect(rowLinks.operators).toEqual(["is", "is not", "empty", "not empty"]);
  });
});

describe("parseCellValue — the input validation", () => {
  it("commits a parsed number and rejects a non-number", () => {
    expect(parseCellValue("number", "42")).toEqual({ ok: true, value: 42 });
    expect(parseCellValue("number", "3.5")).toEqual({ ok: true, value: 3.5 });
    expect(parseCellValue("number", "abc").ok).toBe(false);
  });

  it("treats the empty string as a clear (null) for every kind", () => {
    for (const kind of ["number", "date", "datetime", "text", "boolean", "enum", "row-link"] as const) {
      expect(parseCellValue(kind, "")).toEqual({ ok: true, value: null });
    }
  });

  it("validates the date and the datetime", () => {
    expect(parseCellValue("date", "2024-05-17")).toEqual({ ok: true, value: "2024-05-17" });
    expect(parseCellValue("date", "not-a-date").ok).toBe(false);
    expect(parseCellValue("datetime", "2024-05-17T10:30")).toEqual({ ok: true, value: "2024-05-17T10:30" });
    expect(parseCellValue("datetime", "garbage").ok).toBe(false);
  });

  it("passes the text / boolean / ref kinds through", () => {
    expect(parseCellValue("text", "hello")).toEqual({ ok: true, value: "hello" });
    expect(parseCellValue("boolean", "true")).toEqual({ ok: true, value: "true" });
    expect(parseCellValue("enum", "option")).toEqual({ ok: true, value: "option" });
    expect(parseCellValue("row-link", "r-t-1")).toEqual({ ok: true, value: "r-t-1" });
  });
});

describe("conditionMatches — the array values (the many cardinality)", () => {
  it("stands the is / is not over the containment for the array cell values", () => {
    expect(conditionMatches("is", ["a", "b"], "a")).toBe(true);
    expect(conditionMatches("is", ["a", "b"], "z")).toBe(false);
    expect(conditionMatches("is not", ["a", "b"], "z")).toBe(true);
    expect(conditionMatches("is not", ["a", "b"], "a")).toBe(false);
    // The single value keeps the exact stand (the containment stands the
    // array cell only).
    expect(conditionMatches("is", "a", "a")).toBe(true);
    expect(conditionMatches("is", "a", "a,b")).toBe(false);
  });

  it("stands the empty array over the empty operators", () => {
    expect(conditionMatches("empty", [], undefined)).toBe(true);
    expect(conditionMatches("not empty", [], undefined)).toBe(false);
    expect(conditionMatches("empty", ["a"], undefined)).toBe(false);
    expect(conditionMatches("not empty", ["a"], undefined)).toBe(true);
  });
});

describe("conditionMatches — the date-aware before / after", () => {
  it("compares parseable dates by timestamp", () => {
    expect(conditionMatches("before", "2024-05-17T10:00", "2024-05-18T00:00")).toBe(true);
    expect(conditionMatches("after", "2024-05-18T00:00", "2024-05-17T10:00")).toBe(true);
    expect(conditionMatches("before", "2024-05-18", "2024-05-17")).toBe(false);
  });

  it("falls back to the string comparison when the values are not dates", () => {
    expect(conditionMatches("before", "a", "b")).toBe(true);
    expect(conditionMatches("after", "b", "a")).toBe(true);
  });

  it("between is date-aware (the date / datetime bounds stand over the instants)", () => {
    // The date strings (the single-expected form = the degenerate pair).
    expect(conditionMatches("between", "2024-05-17", ["2024-05-01", "2024-05-31"])).toBe(true);
    expect(conditionMatches("between", "2024-06-01", ["2024-05-01", "2024-05-31"])).toBe(false);
    // The datetime pair (the time-of-day stands too).
    expect(conditionMatches("between", "2024-05-17T10:00", ["2024-05-17T00:00", "2024-05-17T12:00"])).toBe(true);
    expect(conditionMatches("between", "2024-05-17T13:00", ["2024-05-17T00:00", "2024-05-17T12:00"])).toBe(false);
    // The bounds order is irrelevant (the range stands over min / max).
    expect(conditionMatches("between", "2024-05-17", ["2024-05-31", "2024-05-01"])).toBe(true);
    // The number path is unchanged (the numeric bounds stand over the numbers).
    expect(conditionMatches("between", 15, [10, 20])).toBe(true);
    expect(conditionMatches("between", 25, [10, 20])).toBe(false);
    // A non-date value against non-date bounds stays the number fallback.
    expect(conditionMatches("between", "abc", ["1", "2"])).toBe(false);
  });
});
