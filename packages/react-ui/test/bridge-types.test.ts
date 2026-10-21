import { describe, expect, it } from "vitest";

import { columnAnnotation, conditionMatches, parseCellValue } from "../src/database/bridge";

describe("columnAnnotation — the Postgres type catalog", () => {
  it("maps the text-like types to the text input + the string operators", () => {
    for (const type of ["text", "varchar", "citext", "uuid", "jsonb", "json", "inet", "bytea", "xml"]) {
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

  it("lets the consumer operators override win and the options column take the select input", () => {
    expect(columnAnnotation({ id: "c", name: "c", type: "integer", operators: ["is", "gt"] }).operators).toEqual([
      "is",
      "gt",
    ]);
    const a = columnAnnotation({ id: "c", name: "c", type: "text", options: ["a", "b"] });
    expect(a.valueInput).toBe("select");
    expect(a.operators).toContain("in");
  });
});

describe("parseCellValue — the input validation", () => {
  it("commits a parsed number and rejects a non-number", () => {
    expect(parseCellValue("number", "42")).toEqual({ ok: true, value: 42 });
    expect(parseCellValue("number", "3.5")).toEqual({ ok: true, value: 3.5 });
    expect(parseCellValue("number", "abc").ok).toBe(false);
  });

  it("treats the empty string as a clear (null) for every kind", () => {
    for (const kind of ["number", "date", "datetime", "text", "boolean", "select"] as const) {
      expect(parseCellValue(kind, "")).toEqual({ ok: true, value: null });
    }
  });

  it("validates the date and the datetime", () => {
    expect(parseCellValue("date", "2024-05-17")).toEqual({ ok: true, value: "2024-05-17" });
    expect(parseCellValue("date", "not-a-date").ok).toBe(false);
    expect(parseCellValue("datetime", "2024-05-17T10:30")).toEqual({ ok: true, value: "2024-05-17T10:30" });
    expect(parseCellValue("datetime", "garbage").ok).toBe(false);
  });

  it("passes the text / boolean / select kinds through", () => {
    expect(parseCellValue("text", "hello")).toEqual({ ok: true, value: "hello" });
    expect(parseCellValue("boolean", "true")).toEqual({ ok: true, value: "true" });
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
