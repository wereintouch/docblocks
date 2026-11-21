import { describe, expect, it } from "vitest";

import { InvalidAttributeError, createDoc, fromJSON } from "../src/core";
import type { CreateDocOptions, Doc } from "../src/core";
import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

/** The document-attributes boundary validation (the reserved keys, the value forms, the strict / lenient postures). */

const CREATED_AT = "2026-01-01T00:00:00Z";

const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

const freshDoc = (attributes?: Record<string, unknown>): Doc =>
  createDoc({
    id: "d1",
    title: "T",
    createdAt: CREATED_AT,
    generateId: makeIds("b"),
    ...(attributes !== undefined ? { attributes: attributes as CreateDocOptions["attributes"] } : {}),
  });

describe("the boundary validation", () => {
  it("rejects a reserved doc-meta key at setAttribute / removeAttribute / createDoc", () => {
    const doc = freshDoc();
    for (const key of ["v", "id", "title", "avatar", "createdAt", "updatedAt"]) {
      expect(() => doc.setAttribute(key, "x")).toThrow(InvalidAttributeError);
      expect(() => doc.removeAttribute(key)).toThrow(InvalidAttributeError);
      expect(() => freshDoc({ [key]: "x" })).toThrow(InvalidAttributeError);
    }
  });

  it("rejects an Object.prototype key (the JSON round-trip would lose it)", () => {
    const doc = freshDoc();
    for (const key of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(() => doc.setAttribute(key, "x")).toThrow(InvalidAttributeError);
    }
    expect(() => freshDoc({ toString: "x" })).toThrow(InvalidAttributeError);
  });

  it("rejects an empty key", () => {
    const doc = freshDoc();
    expect(() => doc.setAttribute("", "x")).toThrow(InvalidAttributeError);
  });

  it("rejects an unsupported value shape (objects, number lists, non-finite numbers)", () => {
    const doc = freshDoc();
    expect(() => doc.setAttribute("obj", { nested: true } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("nums", [1, 2] as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("mixed", ["a", 2] as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("nan", Number.NaN as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("inf", Number.POSITIVE_INFINITY as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("undef", undefined as never)).toThrow(InvalidAttributeError);
  });

  it("accepts the supported value forms (incl. the id-only mention reference + the typed value)", () => {
    const doc = freshDoc();
    doc.setAttribute("s", "text");
    doc.setAttribute("n", 42);
    doc.setAttribute("b", false);
    doc.setAttribute("list", ["a", "b"]);
    doc.setAttribute("createdBy", { id: "u1" });
    doc.setAttribute("legacy", { id: "u1", label: "Alice" });
    doc.setAttribute("t-string", { type: "string", value: "v" });
    doc.setAttribute("t-number", { type: "number", value: 1.5 });
    doc.setAttribute("t-boolean", { type: "boolean", value: true });
    doc.setAttribute("t-list", { type: "list", value: ["x"] });
    doc.setAttribute("t-mention", { type: "mention", value: { id: "u9" } });
    expect(doc.meta.attributes).toEqual({
      "t-boolean": { type: "boolean", value: true },
      "t-list": { type: "list", value: ["x"] },
      "t-mention": { type: "mention", value: { id: "u9" } },
      "t-number": { type: "number", value: 1.5 },
      "t-string": { type: "string", value: "v" },
      b: false,
      createdBy: { id: "u1" },
      legacy: { id: "u1", label: "Alice" },
      list: ["a", "b"],
      n: 42,
      s: "text",
    });
  });

  it("the typed value round-trips over toJSON / fromJSON (the value's form per its type)", () => {
    const json = {
      v: 1,
      id: "doc-1",
      title: "",
      createdAt: CREATED_AT,
      blocks: { "doc-1": { type: "root", children: [] } },
      attributes: {
        note: { type: "string", value: "hello" },
        rank: { type: "number", value: 3 },
        done: { type: "boolean", value: true },
        tags: { type: "list", value: ["a", "b"] },
        owner: { type: "mention", value: { id: "u1" } },
      },
    };
    const doc = fromJSON(json as never);
    expect(doc.meta.attributes).toEqual(json.attributes);
    expect(doc.toJSON().attributes).toEqual(json.attributes);
  });

  it("rejects a malformed mention reference (the id-only / legacy label form)", () => {
    const doc = freshDoc();
    expect(() => doc.setAttribute("author", { id: "u1", label: "A", extra: 1 } as never)).toThrow(
      InvalidAttributeError
    );
    expect(() => doc.setAttribute("author", { id: 1 } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("author", { id: "" } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("author", { id: "u1", label: 5 } as never)).toThrow(InvalidAttributeError);
  });

  it("rejects a malformed typed value (the type's enum + the value's form per the type)", () => {
    const doc = freshDoc();
    // The type's enum + the value's form (a type/value mismatch is a rejection).
    expect(() => doc.setAttribute("a", { type: "bogus", value: 1 } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("b", { type: "number", value: "x" } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("c", { type: "string", value: 1 } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("d", { type: "list", value: [1] } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("e", { type: "mention", value: { id: "" } } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("f", { type: "boolean" } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("g", { type: "string", value: "v", extra: 1 } as never)).toThrow(
      InvalidAttributeError
    );
  });

  it("rejects the unsupported shapes over the strict validator and tolerates them leniently", () => {
    const json: DocJSON = {
      v: 1,
      id: "r",
      title: "T",
      createdAt: CREATED_AT,
      blocks: { r: { type: "root", children: [] } },
      attributes: { ok: "v", nested: { deep: 1 } },
    } as unknown as DocJSON;
    const strict = validateDoc(json);
    expect(strict.some((error) => error.path === "attributes.nested")).toBe(true);

    // The cross-minor (lenient) load preserves the unsupported value as-is.
    expect(validateDoc(json, true)).toEqual([]);
    const doc = fromJSON(json);
    expect(doc.meta.attributes?.nested).toEqual({ deep: 1 });
    // The preservation survives the export (no data loss over the round-trip).
    expect(doc.toJSON().attributes?.nested).toEqual({ deep: 1 });
  });

  it("rejects a non-object attributes record", () => {
    const json = {
      v: 1,
      id: "r",
      title: "T",
      createdAt: CREATED_AT,
      blocks: { r: { type: "root", children: [] } },
      attributes: ["a", "b"],
    };
    expect(validateDoc(json).some((error) => error.path === "attributes")).toBe(true);
  });

  it("rejects the broken attributesOrder over the strict validator (the non-array / the stale entry / the duplicate / the orphan) and tolerates the lenient load", () => {
    const base = {
      v: 1,
      id: "r",
      title: "T",
      createdAt: CREATED_AT,
      blocks: { r: { type: "root", children: [] } },
      attributes: { a: "1", b: "2" },
    };
    // The non-array's stand (both postures).
    expect(
      validateDoc({ ...base, attributesOrder: "nope" } as unknown as DocJSON).some(
        (error) => error.path === "attributesOrder"
      )
    ).toBe(true);
    expect(
      validateDoc({ ...base, attributesOrder: "nope" } as unknown as DocJSON, true).some(
        (error) => error.path === "attributesOrder"
      )
    ).toBe(true);
    // The stale entry / the duplicate / the missing key (the strict's permutation's stand).
    const stale = { ...base, attributesOrder: ["a", "a", "zz"] } as unknown as DocJSON;
    const strict = validateDoc(stale);
    expect(strict.some((error) => error.path === "attributesOrder")).toBe(true);
    expect(strict.some((error) => error.path === "attributesOrder.zz")).toBe(true);
    expect(strict.some((error) => error.path === "attributesOrder.b")).toBe(true);
    // The orphan's stand (the order over the absent record).
    expect(
      validateDoc({ ...base, attributes: undefined, attributesOrder: ["a"] } as unknown as DocJSON).some(
        (error) => error.path === "attributesOrder"
      )
    ).toBe(true);
    // The valid permutation stands the no-error over both postures.
    expect(validateDoc({ ...base, attributesOrder: ["b", "a"] } as unknown as DocJSON)).toEqual([]);
    expect(validateDoc({ ...base, attributesOrder: ["b", "a"] } as unknown as DocJSON, true)).toEqual([]);
  });
});
