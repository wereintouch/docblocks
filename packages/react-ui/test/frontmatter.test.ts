// @vitest-environment jsdom
// The markdown frontmatter's stand: the parser's subset, the
// mapping's rules, and the integration over `importDocument` + the
// empty-document's paste (the meta and the body over ONE transaction).
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { Doc } from "docblocks-core";

import { applyMdPaste } from "../src/editing/clipboard";
import { isFreshForMeta, mapFrontmatter, parseFrontmatter } from "../src/editing/frontmatter";
import { ImportDocumentError, importDocument } from "../src/index";

const CREATED_AT = "2026-01-01T00:00:00Z";

const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

const freshDoc = (): Doc => createDoc({ id: "d1", title: "T", createdAt: CREATED_AT, generateId: makeIds("b") });

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

  it("the body stands the source minus the header (no leading `---` residue)", () => {
    const parsed = parseFrontmatter("---\ntitle: a\n---\n# Heading\n\npara")!;
    expect(parsed.body).toBe("# Heading\n\npara");
  });
});

describe("the mapping's rules", () => {
  it("maps the meta keys over the confirmed stand", () => {
    const { entries } = parseFrontmatter(
      [
        "---",
        "title: My Doc",
        "description: The stand",
        "tags: [alpha, beta]",
        "keywords: [beta, gamma]",
        "author: Alice",
        "date: 2026-11-15",
        "draft: true",
        "cover: https://example.com/cover.png",
        "custom: value",
        "---",
        "",
      ].join("\n")
    )!;
    const mapped = mapFrontmatter(entries);
    expect(mapped.title).toBe("My Doc");
    expect(mapped.attributes).toEqual({
      cover: "https://example.com/cover.png",
      createdBy: { id: "Alice" },
      custom: "value",
      description: "The stand",
      publishedAt: "2026-11-15T00:00:00.000Z",
      status: "draft",
      tags: ["alpha", "beta", "gamma"],
    });
    // The `cover` preset (the file id's stand) is NOT over the raw URL —
    // the URL stands the custom key under its own name.
    expect(mapped.attributes.cover).toBe("https://example.com/cover.png");
    expect("createdBy" in mapped.attributes).toBe(true);
  });

  it("the unparseable date stands the custom key under its name", () => {
    const { entries } = parseFrontmatter("---\ndate: last week\n---\n")!;
    const mapped = mapFrontmatter(entries);
    expect(mapped.attributes.date).toBe("last week");
    expect(mapped.attributes.publishedAt).toBeUndefined();
  });

  it("the nested objects stand the JSON string (the data's loss stand)", () => {
    const { entries } = parseFrontmatter("---\nmeta:\n  author: Bob\n  city: Paris\n---\n")!;
    const mapped = mapFrontmatter(entries);
    expect(mapped.attributes.meta).toBe(JSON.stringify({ author: "Bob", city: "Paris" }));
  });

  it("the `published: true` and the `createdBy` reference's stands (the id-only form over the aliases)", () => {
    const published = mapFrontmatter(parseFrontmatter("---\npublished: true\n---\n")!.entries);
    expect(published.attributes.status).toBe("published");
    // The name object's stand (the id-only reference — the label's snapshot
    // stands dropped, the consumer's resolution's stand).
    const author = mapFrontmatter(parseFrontmatter("---\nauthor:\n  name: Bob\n---\n")!.entries);
    expect(author.attributes.createdBy).toEqual({ id: "Bob" });
    // The `created_by` / `createdBy` aliases stand the same reference.
    const alias = mapFrontmatter(parseFrontmatter("---\ncreated_by: u2\n---\n")!.entries);
    expect(alias.attributes.createdBy).toEqual({ id: "u2" });
  });
});

describe("the empty-document's gate", () => {
  it("the empty room and the single empty starter paragraph's seat stand fresh", () => {
    const empty = freshDoc();
    expect(isFreshForMeta(empty)).toBe(true);

    const withSeat = freshDoc();
    const seat = withSeat.insertBlock("paragraph");
    expect(isFreshForMeta(withSeat, seat)).toBe(true);
    expect(isFreshForMeta(withSeat)).toBe(false); // the seat's absent stand (the import's gate)

    withSeat.insertText(seat, 0, "text");
    expect(isFreshForMeta(withSeat, seat)).toBe(false); // the non-empty seat
  });
});

describe("importDocument over the frontmatter", () => {
  const SOURCE = ["---", "title: Imported", "tags: [a, b]", "date: 2026-11-01", "---", "# Head", "", "para"].join("\n");

  it("writes the meta and the body over ONE undo step; the header stands stripped", () => {
    const doc = freshDoc();
    importDocument(doc, SOURCE, "markdown");

    expect(doc.meta.title).toBe("Imported");
    expect(doc.meta.attributes).toEqual({
      publishedAt: "2026-11-01T00:00:00.000Z",
      tags: ["a", "b"],
    });
    // The body: the heading + the paragraph (the header's `---` is not a
    // divider / the setext's stand — it stood stripped).
    const blocks = Object.values(doc.toJSON().blocks);
    expect(blocks.filter((block) => block.type === "divider")).toEqual([]);
    expect(blocks.some((block) => block.type === "heading")).toBe(true);
    expect(blocks.some((block) => block.type === "paragraph")).toBe(true);

    // ONE undo step: the undo restores the fresh doc (no meta, no blocks).
    expect(doc.canUndo).toBe(true);
    doc.undo();
    expect(doc.meta.title).toBe("T");
    expect(doc.meta.attributes).toBeUndefined();
    expect(doc.getChildren(doc.meta.id)).toEqual([]);
  });

  it("the frontmatter WITHOUT a body is a meta-only import (not a no-op)", () => {
    const doc = freshDoc();
    importDocument(doc, "---\ntitle: Meta only\ndescription: d\n---\n", "markdown");
    expect(doc.meta.title).toBe("Meta only");
    expect(doc.meta.attributes).toEqual({ description: "d" });
    expect(doc.getChildren(doc.meta.id)).toEqual([]);
    expect(doc.canUndo).toBe(true);
  });

  it("the empty body WITHOUT a frontmatter stays a no-op (the unchanged stand)", () => {
    const doc = freshDoc();
    const wire = { count: 0 };
    const off = doc.onChange(() => {
      wire.count += 1;
    });
    importDocument(doc, "   \n  \n", "markdown");
    expect(wire.count).toBe(0);
    expect(doc.meta.title).toBe("T");
    off();
  });

  it("the non-fresh document throws (the unchanged stand)", () => {
    const doc = freshDoc();
    doc.insertBlock("paragraph");
    expect(() => importDocument(doc, SOURCE, "markdown")).toThrow(ImportDocumentError);
  });

  it("the HTML kind stands no frontmatter handling (the unchanged stand)", () => {
    const doc = freshDoc();
    importDocument(doc, "<p>hello</p>", "html");
    expect(doc.meta.title).toBe("T");
    expect(doc.meta.attributes).toBeUndefined();
    expect(doc.getChildren(doc.meta.id)).toHaveLength(1);
  });
});

describe("the empty-document's paste over the frontmatter", () => {
  const SOURCE = ["---", "title: Pasted", "tags: [x]", "---", "body text"].join("\n");

  it("the fresh seat's paste stands the meta + the body over ONE undo step", () => {
    const doc = freshDoc();
    const seat = doc.insertBlock("paragraph");
    const landing = applyMdPaste(doc, seat, 0, 0, SOURCE);
    expect(landing).not.toBeNull();

    expect(doc.meta.title).toBe("Pasted");
    expect(doc.meta.attributes).toEqual({ tags: ["x"] });
    const blocks = Object.values(doc.toJSON().blocks);
    expect(blocks.filter((block) => block.type === "divider")).toEqual([]);
    expect(blocks.some((block) => block.type === "paragraph")).toBe(true);

    expect(doc.canUndo).toBe(true);
    doc.undo();
    expect(doc.meta.title).toBe("T");
    expect(doc.meta.attributes).toBeUndefined();
  });

  it("the non-fresh document's paste stands the header as content (the divider's stand)", () => {
    const doc = freshDoc();
    const seat = doc.insertBlock("paragraph");
    doc.insertText(seat, 0, "seed");
    const landing = applyMdPaste(doc, seat, 0, 0, SOURCE);
    expect(landing).not.toBeNull();
    // The header stands the plain markdown (the divider's / the setext's
    // discriminator): the meta is untouched.
    expect(doc.meta.title).toBe("T");
    expect(doc.meta.attributes).toBeUndefined();
    const blocks = Object.values(doc.toJSON().blocks);
    expect(blocks.some((block) => block.type === "divider")).toBe(true);
  });
});
