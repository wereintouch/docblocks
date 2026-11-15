// @vitest-environment jsdom
// The headless whole-document import (`importDocument`): the markdown / HTML
// payload fills a FRESH doc (the empty root) over the paste parsers'
// materialization — one transaction (one undo step, one wire update), the
// indents absolute (the jump-rule clamp, no seat), the empty payload the
// no-op, the non-fresh doc the typed rejection. The goldens are the full
// `toJSON()` over a deterministic doc (the counter `generateId` — the
// determinism criterion: the command sequence stands the stable JSON). The
// HTML kind needs the DOM (the `DOMParser` over the jsdom environment).
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { Change, Doc } from "docblocks-core";

import { ImportDocumentError, importDocument } from "../src/index";

const CREATED_AT = "2026-01-01T00:00:00.000Z";

/** The fresh doc: the empty root, the deterministic ids (the counter). */
function freshDoc(): Doc {
  let n = 0;
  return createDoc({
    id: "doc1",
    title: "",
    createdAt: CREATED_AT,
    generateId: () => `b${String(++n).padStart(3, "0")}`,
  });
}

// === The markdown golden =================================================

const MD_SOURCE = [
  "# H1",
  "## H2",
  "### H3",
  "#### H4",
  "##### H5",
  "###### H6",
  "",
  "Paragraph with **bold**, *italic*, ~~strike~~, `code`, [link](https://example.com/a).",
  "",
  "- bullet one",
  "  - bullet two",
  "1. number one",
  "2. number two",
  "- [ ] task open",
  "- [X] task done",
  "",
  "> quote one",
  "> quote two",
  "",
  "```py",
  "let a = 1;",
  "```",
  "",
  "| A | B |",
  "| --- | --- |",
  "| a1 | b1 |",
  "| a2 | b2 |",
  "",
  "---",
  "",
  "![alt](img.png)",
  "",
].join("\n");

const MD_GOLDEN = {
  v: 1,
  id: "doc1",
  title: "",
  createdAt: CREATED_AT,
  blocks: {
    doc1: {
      type: "root",
      children: [
        "b001",
        "b002",
        "b003",
        "b004",
        "b005",
        "b006",
        "b007",
        "b008",
        "b009",
        "b010",
        "b011",
        "b012",
        "b013",
        "b014",
        "b015",
        "b016",
        "b034",
        "b035",
      ],
    },
    b001: { type: "heading", attrs: { level: 1, indent: 0 }, content: [{ text: "H1", marks: {} }] },
    b002: { type: "heading", attrs: { level: 2, indent: 0 }, content: [{ text: "H2", marks: {} }] },
    b003: { type: "heading", attrs: { level: 3, indent: 0 }, content: [{ text: "H3", marks: {} }] },
    b004: { type: "heading", attrs: { level: 4, indent: 0 }, content: [{ text: "H4", marks: {} }] },
    b005: { type: "heading", attrs: { level: 5, indent: 0 }, content: [{ text: "H5", marks: {} }] },
    b006: { type: "heading", attrs: { level: 6, indent: 0 }, content: [{ text: "H6", marks: {} }] },
    b007: {
      type: "paragraph",
      content: [
        { text: "Paragraph with ", marks: {} },
        { text: "bold", marks: { bold: true } },
        { text: ", ", marks: {} },
        { text: "italic", marks: { italic: true } },
        { text: ", ", marks: {} },
        { text: "strike", marks: { strike: true } },
        { text: ", ", marks: {} },
        { text: "code", marks: { code: true } },
        { text: ", ", marks: {} },
        { text: "link", marks: { link: { href: "https://example.com/a" } } },
        { text: ".", marks: {} },
      ],
    },
    b008: {
      type: "list-item",
      attrs: { list: "bullet", indent: 0 },
      content: [{ text: "bullet one", marks: {} }],
    },
    b009: {
      type: "list-item",
      attrs: { list: "bullet", indent: 1 },
      content: [{ text: "bullet two", marks: {} }],
    },
    b010: {
      type: "list-item",
      attrs: { list: "number", indent: 0 },
      content: [{ text: "number one", marks: {} }],
    },
    b011: {
      type: "list-item",
      attrs: { list: "number", indent: 0 },
      content: [{ text: "number two", marks: {} }],
    },
    b012: {
      type: "list-item",
      attrs: { list: "task", checked: false, indent: 0 },
      content: [{ text: "task open", marks: {} }],
    },
    b013: {
      type: "list-item",
      attrs: { list: "task", checked: true, indent: 0 },
      content: [{ text: "task done", marks: {} }],
    },
    b014: { type: "quote", content: [{ text: "quote one\nquote two", marks: {} }] },
    b015: {
      type: "code",
      attrs: { language: "py", indent: 0 },
      content: [{ text: "let a = 1;", marks: {} }],
    },
    b016: {
      type: "table",
      columnOrder: ["b017", "b018"],
      attrs: { columnWidths: [100, 100], indent: 0 },
      children: ["b019", "b024", "b029"],
    },
    b019: { type: "table-row", children: ["b020", "b022"] },
    b020: {
      type: "table-cell",
      attrs: { columnId: "b017" },
      children: ["b021"],
      content: [],
    },
    b021: { type: "paragraph", content: [{ text: "A", marks: {} }] },
    b022: {
      type: "table-cell",
      attrs: { columnId: "b018" },
      children: ["b023"],
      content: [],
    },
    b023: { type: "paragraph", content: [{ text: "B", marks: {} }] },
    b024: { type: "table-row", children: ["b025", "b027"] },
    b025: {
      type: "table-cell",
      attrs: { columnId: "b017" },
      children: ["b026"],
      content: [],
    },
    b026: { type: "paragraph", content: [{ text: "a1", marks: {} }] },
    b027: {
      type: "table-cell",
      attrs: { columnId: "b018" },
      children: ["b028"],
      content: [],
    },
    b028: { type: "paragraph", content: [{ text: "b1", marks: {} }] },
    b029: { type: "table-row", children: ["b030", "b032"] },
    b030: {
      type: "table-cell",
      attrs: { columnId: "b017" },
      children: ["b031"],
      content: [],
    },
    b031: { type: "paragraph", content: [{ text: "a2", marks: {} }] },
    b032: {
      type: "table-cell",
      attrs: { columnId: "b018" },
      children: ["b033"],
      content: [],
    },
    b033: { type: "paragraph", content: [{ text: "b2", marks: {} }] },
    b034: { type: "divider" },
    b035: { type: "image", attrs: { src: "img.png", indent: 0 } },
  },
};

// === The HTML golden =====================================================

const HTML_SOURCE = [
  "<h1>H1</h1>",
  "<h2>H2</h2>",
  "<h3>H3</h3>",
  "<h4>H4</h4>",
  "<h5>H5</h5>",
  "<h6>H6</h6>",
  '<p>Paragraph with <b>bold</b>, <i>italic</i>, <u>under</u>, <s>strike</s>, <code>code</code>, <a href="https://example.com/a">link</a>, <a href="javascript:alert(1)">bad</a>.</p>',
  "<ul><li>item one<ul><li>item two</li></ul></li><li>item three</li></ul>",
  "<ol><li>num one</li><li>num two</li></ol>",
  "<pre>let a = 1;</pre>",
  "<blockquote>quote one<blockquote>quote two</blockquote></blockquote>",
  "<hr>",
  "<table><tr><td>A</td><td>B</td></tr><tr><td>a1</td><td>b1</td></tr></table>",
  '<img src="img.png">',
  "<p>tail</p>",
].join("");

const HTML_GOLDEN = {
  v: 1,
  id: "doc1",
  title: "",
  createdAt: CREATED_AT,
  blocks: {
    doc1: {
      type: "root",
      children: [
        "b001",
        "b002",
        "b003",
        "b004",
        "b005",
        "b006",
        "b007",
        "b008",
        "b009",
        "b010",
        "b011",
        "b012",
        "b013",
        "b014",
        "b015",
        "b016",
        "b017",
        "b030",
      ],
    },
    b001: { type: "heading", attrs: { level: 1, indent: 0 }, content: [{ text: "H1", marks: {} }] },
    b002: { type: "heading", attrs: { level: 2, indent: 0 }, content: [{ text: "H2", marks: {} }] },
    b003: { type: "heading", attrs: { level: 3, indent: 0 }, content: [{ text: "H3", marks: {} }] },
    b004: { type: "heading", attrs: { level: 4, indent: 0 }, content: [{ text: "H4", marks: {} }] },
    b005: { type: "heading", attrs: { level: 5, indent: 0 }, content: [{ text: "H5", marks: {} }] },
    b006: { type: "heading", attrs: { level: 6, indent: 0 }, content: [{ text: "H6", marks: {} }] },
    b007: {
      type: "paragraph",
      content: [
        { text: "Paragraph with ", marks: {} },
        { text: "bold", marks: { bold: true } },
        { text: ", ", marks: {} },
        { text: "italic", marks: { italic: true } },
        { text: ", ", marks: {} },
        { text: "under", marks: { underline: true } },
        { text: ", ", marks: {} },
        { text: "strike", marks: { strike: true } },
        { text: ", ", marks: {} },
        { text: "code", marks: { code: true } },
        { text: ", ", marks: {} },
        { text: "link", marks: { link: { href: "https://example.com/a" } } },
        { text: ", bad.", marks: {} },
      ],
    },
    b008: {
      type: "list-item",
      attrs: { list: "bullet", indent: 0 },
      content: [{ text: "item one", marks: {} }],
    },
    b009: {
      type: "list-item",
      attrs: { list: "bullet", indent: 1 },
      content: [{ text: "item two", marks: {} }],
    },
    b010: {
      type: "list-item",
      attrs: { list: "bullet", indent: 0 },
      content: [{ text: "item three", marks: {} }],
    },
    b011: {
      type: "list-item",
      attrs: { list: "number", indent: 0 },
      content: [{ text: "num one", marks: {} }],
    },
    b012: {
      type: "list-item",
      attrs: { list: "number", indent: 0 },
      content: [{ text: "num two", marks: {} }],
    },
    b013: {
      type: "code",
      attrs: { indent: 0 },
      content: [{ text: "let a = 1;", marks: {} }],
    },
    b014: { type: "quote", content: [{ text: "quote one", marks: {} }] },
    b015: { type: "quote", attrs: { indent: 1 }, content: [{ text: "quote two", marks: {} }] },
    b016: { type: "divider" },
    b017: {
      type: "table",
      columnOrder: ["b018", "b019"],
      attrs: { columnWidths: [100, 100], indent: 0 },
      children: ["b020", "b025"],
    },
    b020: { type: "table-row", children: ["b021", "b023"] },
    b021: {
      type: "table-cell",
      attrs: { columnId: "b018" },
      children: ["b022"],
      content: [],
    },
    b022: { type: "paragraph", content: [{ text: "A", marks: {} }] },
    b023: {
      type: "table-cell",
      attrs: { columnId: "b019" },
      children: ["b024"],
      content: [],
    },
    b024: { type: "paragraph", content: [{ text: "B", marks: {} }] },
    b025: { type: "table-row", children: ["b026", "b028"] },
    b026: {
      type: "table-cell",
      attrs: { columnId: "b018" },
      children: ["b027"],
      content: [],
    },
    b027: { type: "paragraph", content: [{ text: "a1", marks: {} }] },
    b028: {
      type: "table-cell",
      attrs: { columnId: "b019" },
      children: ["b029"],
      content: [],
    },
    b029: { type: "paragraph", content: [{ text: "b1", marks: {} }] },
    b030: { type: "paragraph", content: [{ text: "tail", marks: {} }] },
  },
};

// === The tests ===========================================================

describe("importDocument — the goldens (the full toJSON())", () => {
  it("the markdown payload fills the fresh doc (the parser's corpus)", () => {
    const doc = freshDoc();
    importDocument(doc, MD_SOURCE, "markdown");
    expect(doc.toJSON()).toEqual(MD_GOLDEN);
  });

  it("the HTML payload fills the fresh doc (the block structure + the inline whitelist)", () => {
    const doc = freshDoc();
    importDocument(doc, HTML_SOURCE, "html");
    expect(doc.toJSON()).toEqual(HTML_GOLDEN);
  });
});

describe("importDocument — the indents (absolute, the jump-rule clamp)", () => {
  it("the parser's nesting stands as the indents (the no re-base)", () => {
    const doc = freshDoc();
    importDocument(doc, "- a\n  - b\n    - c\n", "markdown");
    const ids = doc.getChildren(doc.meta.id);
    expect(doc.toJSON().blocks[ids[0]!]).toMatchObject({ type: "list-item", attrs: { indent: 0 } });
    expect(doc.toJSON().blocks[ids[1]!]).toMatchObject({ type: "list-item", attrs: { indent: 1 } });
    expect(doc.toJSON().blocks[ids[2]!]).toMatchObject({ type: "list-item", attrs: { indent: 2 } });
  });

  it("the dropped-parent gap clamps (the first block anchors at 0, the core's jump rule)", () => {
    // The whitespace-only parents are dropped by the parser: the deep item
    // would land at indent 2 over the empty root (the core rejects the
    // first block's indent > 0 — the whole import would roll back); the
    // clamp keeps the content at the anchored indent 0.
    const doc = freshDoc();
    importDocument(doc, "<ul><li>  <ul><li>  <ul><li>deep</li></ul></li></ul></li></ul>", "html");
    const [id] = doc.getChildren(doc.meta.id);
    expect(doc.toJSON().blocks[id!]).toMatchObject({ type: "list-item", attrs: { indent: 0 } });
  });

  it("a gap in the middle of the sequence clamps to the predecessor + 1", () => {
    // The nested ul under a whitespace-only item is dropped: "deep" stands
    // at the parser's indent 1 over the anchor (the +1 cap holds — no
    // violation), and the deeper gap over it clamps.
    const doc = freshDoc();
    importDocument(doc, "<ul><li>anchor</li><li>  <ul><li>  <ul><li>deep</li></ul></li></ul></li></ul>", "html");
    const ids = doc.getChildren(doc.meta.id);
    expect(doc.toJSON().blocks[ids[0]!]).toMatchObject({ type: "list-item", attrs: { indent: 0 } });
    expect(doc.toJSON().blocks[ids[1]!]).toMatchObject({ type: "list-item", attrs: { indent: 1 } });
  });
});

describe("importDocument — the fresh-doc precondition", () => {
  it("the non-fresh doc (the root has children) throws the typed error", () => {
    const doc = freshDoc();
    doc.insertBlock("paragraph", undefined, { parent: doc.meta.id });
    expect(() => importDocument(doc, "# T", "markdown")).toThrow(ImportDocumentError);
    // The doc stands: the single seeded paragraph, nothing imported.
    expect(doc.getChildren(doc.meta.id)).toHaveLength(1);
  });

  it("the import stands once: the second import throws (the root is no longer empty)", () => {
    const doc = freshDoc();
    importDocument(doc, "# T", "markdown");
    expect(() => importDocument(doc, "# Again", "markdown")).toThrow(ImportDocumentError);
    expect(doc.getChildren(doc.meta.id)).toHaveLength(1);
  });
});

describe("importDocument — the empty payload (the no-op)", () => {
  // The emptiness is per kind: the structural-tag payload is the literal
  // text over the markdown (the parser's degrade) and the nothing over the
  // HTML (the whitespace-only stand) — the cases stand per kind.
  const cases: Array<[string, "markdown" | "html"]> = [
    ["", "markdown"],
    ["   ", "markdown"],
    ["\n\n  \n", "markdown"],
    ["", "html"],
    ["<p>   </p>", "html"],
    ["<div>  </div>", "html"],
  ];
  it.each(cases)("the empty / whitespace-only payload (%s) writes nothing and runs no transaction", (source, kind) => {
    const doc = freshDoc();
    const changes: Change[] = [];
    const off = doc.onChange((change) => changes.push(change));
    importDocument(doc, source, kind);
    off();
    expect(doc.getChildren(doc.meta.id)).toHaveLength(0);
    expect(changes).toHaveLength(0);
  });
});

describe("importDocument — the single transaction", () => {
  it("the non-empty import runs ONE transact (one onChange emission)", () => {
    const doc = freshDoc();
    const changes: Change[] = [];
    const off = doc.onChange((change) => changes.push(change));
    importDocument(doc, MD_SOURCE, "markdown");
    off();
    expect(changes).toHaveLength(1);
    // Every block's snapshot changed in the one transaction (the new
    // blocks + the parents' children lists, the root included).
    expect(new Set(changes[0]!.blockIds)).toEqual(new Set(Object.keys(MD_GOLDEN.blocks)));
  });
});
