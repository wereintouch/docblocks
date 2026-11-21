// @vitest-environment jsdom
// The markdown frontmatter's parser: the subset's shapes (the scalars, the
// lists, the block scalars, the one-level objects), the header's strip, and
// the reserved key's drop (the prototype chain's stand).
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { parseFrontmatter } from "../src/editing/frontmatter";
import { importDocument } from "../src/index";

const CREATED_AT = "2026-01-01T00:00:00Z";

const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

const freshDoc = () => createDoc({ id: "d1", title: "T", createdAt: CREATED_AT, generateId: makeIds("b") });

describe("the parser's subset", () => {
  it("returns null over the absent / the unclosed header", () => {
    expect(parseFrontmatter("# No header\n\ntext")).toBeNull();
    expect(parseFrontmatter("---\ntitle: a\n# no close")).toBeNull();
    expect(parseFrontmatter("---\ntitle: a\n---\ntext")).not.toBeNull();
  });

  it("parses the scalars (the plain / quoted strings, the booleans, the numbers, the comments)", () => {
    const { entries } = parseFrontmatter(
      [
        "---",
        "plain: hello world",
        'quoted: "a \\" b"',
        "single: 'it''s'",
        "bool: true",
        "num: 42",
        "float: -1.5",
        "commented: value # the rest is a comment",
        "empty:",
        "---",
        "body",
      ].join("\n")
    )!;
    expect(entries.plain).toBe("hello world");
    expect(entries.quoted).toBe('a " b');
    expect(entries.single).toBe("it's");
    expect(entries.bool).toBe(true);
    expect(entries.num).toBe(42);
    expect(entries.float).toBe(-1.5);
    expect(entries.commented).toBe("value");
    expect(entries.empty).toBe("");
  });

  it("parses the inline / the block string lists", () => {
    const { entries } = parseFrontmatter(
      ["---", "inline: [a, b, c]", "block:", "  - one", "  - two", "---", ""].join("\n")
    )!;
    expect(entries.inline).toEqual(["a", "b", "c"]);
    expect(entries.block).toEqual(["one", "two"]);
  });

  it("parses the one-level nested objects and the block scalars", () => {
    const { entries } = parseFrontmatter(
      [
        "---",
        "nested:",
        "  name: Alice",
        "  role: admin",
        "literal: |",
        "  line one",
        "  line two",
        "folded: >",
        "  folded line",
        "---",
        "",
      ].join("\n")
    )!;
    expect(entries.nested).toEqual({ name: "Alice", role: "admin" });
    expect(entries.literal).toBe("line one\nline two");
    expect(entries.folded).toBe("folded line");
  });

  it("the `__proto__` key stands dropped (the prototype chain stays intact)", () => {
    const parsed = parseFrontmatter(
      [
        "---",
        "__proto__: polluted",
        "__proto__block:",
        "  poisoned: yes",
        "nested:",
        "  __proto__: nested-polluted",
        "  key: v",
        "---",
        "body",
      ].join("\n")
    )!;
    // The reserved key stands no own entry: the assignment would have
    // written the prototype chain instead of a value.
    expect(Object.hasOwn(parsed.entries, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(parsed.entries)).toBe(Object.prototype);
    expect(parsed.entries.title).toBeUndefined();
    // The nested object's stand: its own reserved key is dropped too, the
    // sibling keys parse.
    expect(parsed.entries.nested).toEqual({ key: "v" });
    // The nested-blocked reserved key: the value stands no own entry over
    // the sibling's stand.
    const blocked = parseFrontmatter("---\n__proto__:\n  poisoned: yes\n  key: v\ntitle: T\n---\nbody")!;
    expect(Object.hasOwn(blocked.entries, "key")).toBe(false);
    expect(blocked.entries.key).toBeUndefined();
    expect(Object.getPrototypeOf(blocked.entries)).toBe(Object.prototype);
    expect(blocked.entries.title).toBe("T");
    // The import's meta stands the sound keys only.
    const doc = freshDoc();
    importDocument(doc, `---\n__proto__: polluted\ntitle: T\n---\nbody text`, "markdown");
    expect(doc.meta.title).toBe("T");
    expect(Object.hasOwn(doc.meta.attributes ?? {}, "__proto__")).toBe(false);
  });

  it("the body stands the source minus the header (no leading `---` residue)", () => {
    const parsed = parseFrontmatter("---\ntitle: a\n---\n# Heading\n\npara")!;
    expect(parsed.body).toBe("# Heading\n\npara");
  });
});
