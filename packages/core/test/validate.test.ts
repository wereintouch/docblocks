import { describe, expect, it } from "vitest";

import { validateDoc } from "../src/schema";
import type { DocJSON, MarkSet, TextRun } from "../src/schema";

const run = (text: string, marks: MarkSet = {}): TextRun => ({ text, marks });

function makeDoc(overrides: Partial<DocJSON> = {}): DocJSON {
  return {
    v: 1,
    id: "r",
    title: "T",
    createdAt: "2026-10-08T10:00:00Z",
    blocks: { r: { type: "root", children: [] } },
    ...overrides,
  };
}

const expectValid = (doc: unknown) => expect(validateDoc(doc)).toEqual([]);

const expectError = (doc: unknown, path: string, needle: string) => {
  const errors = validateDoc(doc);
  const hit = errors.find((e) => e.path === path && e.message.includes(needle));
  expect(hit, `expected an error at "${path}" mentioning "${needle}"; got ${JSON.stringify(errors)}`).toBeDefined();
};

describe("valid documents", () => {
  it("accepts an empty document (root only)", () => {
    expectValid(makeDoc());
  });

  it("accepts the full v1 catalog: every block type and every mark", () => {
    expectValid(
      makeDoc({
        blocks: {
          r: { type: "root", children: ["p1", "h1", "l1", "c1", "co1", "la1", "t1", "img1", "d1"] },
          p1: {
            type: "paragraph",
            content: [
              run("Hello ", { bold: true }),
              run("world", { link: { href: "/page" }, color: { value: "#0066CC" }, highlight: { value: "#FFFF0080" } }),
              run("code", { code: true }),
              run("x^2", { math: { tex: "x^2" } }),
            ],
          },
          h1: {
            type: "heading",
            attrs: { level: 6 },
            content: [run("H", { italic: true, underline: true, strike: true })],
          },
          l1: { type: "list-item", attrs: { list: "bullet" }, children: ["l2"] },
          l2: { type: "list-item", attrs: { list: "task", checked: true }, content: [run("task")] },
          c1: { type: "callout", attrs: { variant: "warning" }, content: [run("note")] },
          co1: { type: "code", attrs: { language: "js" }, content: [run("const x = 1;")] },
          la1: { type: "latex", attrs: { display: true }, content: [run("e^{i\\pi} + 1 = 0", { bold: true })] },
          t1: { type: "table", attrs: { cols: 2 }, children: ["row1", "row2"] },
          row1: { type: "table-row", children: ["c11", "c12"] },
          row2: { type: "table-row", children: ["c21", "c22"] },
          c11: { type: "table-cell", content: [run("a")], children: ["pc"] },
          pc: { type: "paragraph", content: [run("nested leaf")] },
          c12: { type: "table-cell", content: [] },
          c21: { type: "table-cell", children: ["d2"] },
          d2: { type: "divider" },
          c22: { type: "table-cell", content: [run("b")] },
          img1: { type: "image", attrs: { src: "blob:123", width: null, align: "center" } },
          d1: { type: "divider" },
        },
      })
    );
  });

  it("accepts empty runs and adjacent duplicate runs (normalization is lazy)", () => {
    expectValid(
      makeDoc({
        blocks: {
          r: { type: "root", children: ["p"] },
          p: { type: "paragraph", content: [run(""), run("a"), run("a")] },
        },
      })
    );
  });

  it("accepts a highlight mark without a value", () => {
    expectValid(
      makeDoc({
        blocks: {
          r: { type: "root", children: ["p"] },
          p: { type: "paragraph", content: [run("x", { highlight: {} })] },
        },
      })
    );
  });

  it("accepts a table without rows", () => {
    expectValid(
      makeDoc({ blocks: { r: { type: "root", children: ["t"] }, t: { type: "table", attrs: { cols: 2 } } } })
    );
  });

  it("accepts relative link hrefs, anchors, and http(s) urls", () => {
    expectValid(
      makeDoc({
        blocks: {
          r: { type: "root", children: ["p"] },
          p: {
            type: "paragraph",
            content: [
              run("a", { link: { href: "./rel" } }),
              run("b", { link: { href: "https://example.com" } }),
              run("c", { link: { href: "#anchor" } }),
            ],
          },
        },
      })
    );
  });
});

describe("metadata", () => {
  it("rejects an unsupported schema version", () => {
    expectError({ ...makeDoc(), v: 2 }, "v", "Unsupported schema version");
  });

  it("reports a missing blocks map", () => {
    const doc = makeDoc();
    delete (doc as Partial<DocJSON>).blocks;
    expectError(doc, "blocks", "Missing required field");
  });

  it("rejects unknown top-level fields", () => {
    expectError({ ...makeDoc(), foo: 1 }, "foo", "Unknown field");
  });

  it("rejects an empty or non-string id", () => {
    expectError({ ...makeDoc(), id: "" }, "id", "non-empty string");
    expectError({ ...makeDoc(), id: 5 }, "id", "non-empty string");
  });

  it("rejects a non-string title", () => {
    expectError({ ...makeDoc(), title: 5 }, "title", "must be a string");
  });

  it("rejects non-ISO createdAt values", () => {
    expectError({ ...makeDoc(), createdAt: "10/05/2026" }, "createdAt", "ISO 8601");
    expectError({ ...makeDoc(), createdAt: "2026-13-01T00:00:00Z" }, "createdAt", "ISO 8601");
    expectError({ ...makeDoc(), createdAt: "2026-10-08" }, "createdAt", "ISO 8601");
  });

  it("rejects a non-object document and a non-object blocks map", () => {
    expect(validateDoc([])).toEqual([{ path: "", message: "The document must be a plain object (got [])." }]);
    expectError(null, "", "plain object");
    expectError({ ...makeDoc(), blocks: [] }, "blocks", "must be a plain object");
    expectError({ ...makeDoc(), blocks: null }, "blocks", "must be a plain object");
  });

  it("accepts an empty title and a createdAt with a numeric offset", () => {
    expectValid({ ...makeDoc(), title: "" });
    expectValid({ ...makeDoc(), createdAt: "2026-10-08T10:00:00+03:00" });
  });
});

describe("block structure", () => {
  it("rejects unknown block types and non-object blocks", () => {
    expectError(
      { ...makeDoc(), blocks: { r: { type: "root", children: [] }, b: { type: "note" } } },
      "blocks.b",
      'Unknown block type "note"'
    );
    expectError({ ...makeDoc(), blocks: { r: { type: "root", children: [] }, b: null } }, "blocks.b", "plain object");
  });

  it("requires exactly one root", () => {
    expectError({ ...makeDoc(), blocks: { p: { type: "paragraph" } } }, "blocks", "must contain a root block");
    const twoRoots = {
      ...makeDoc(),
      blocks: { r1: { type: "root", children: ["r2"] }, r2: { type: "root", children: [] } },
    };
    expectError(twoRoots, "blocks.r2", "exactly one root block");
    expectError(twoRoots, "blocks.r1.children[0]", 'not allowed as a child of "root"');
  });

  it("rejects orphan blocks, dangling ids, and non-string child ids", () => {
    expectError(
      { ...makeDoc(), blocks: { r: { type: "root", children: [] }, p: { type: "paragraph" } } },
      "blocks.p",
      "Orphan block"
    );
    expectError(
      { ...makeDoc(), blocks: { r: { type: "root", children: ["nope"] } } },
      "blocks.r.children[0]",
      "Dangling child id"
    );
    expectError(
      { ...makeDoc(), blocks: { r: { type: "root", children: [5] } } },
      "blocks.r.children[0]",
      "must be a string"
    );
  });

  it("rejects a block referenced more than once", () => {
    const twiceInOneList = {
      ...makeDoc(),
      blocks: { r: { type: "root", children: ["p", "p"] }, p: { type: "paragraph" } },
    };
    expectError(twiceInOneList, "blocks.r.children[1]", "referenced more than once");
    const twoParents = {
      ...makeDoc(),
      blocks: {
        r: { type: "root", children: ["l1", "l2"] },
        l1: { type: "list-item", attrs: { list: "bullet" }, children: ["l2"] },
        l2: { type: "list-item", attrs: { list: "bullet" } },
      },
    };
    expectError(twoParents, "blocks.l1.children[0]", "referenced more than once");
  });

  it("rejects a multi-node cycle", () => {
    const cycle = {
      ...makeDoc(),
      blocks: {
        r: { type: "root", children: ["l1"] },
        l1: { type: "list-item", attrs: { list: "bullet" }, children: ["l2"] },
        l2: { type: "list-item", attrs: { list: "bullet" }, children: ["l1"] },
      },
    };
    expectError(cycle, "blocks.l2.children[0]", "referenced more than once");
  });

  it("rejects a block that is its own child", () => {
    const doc = {
      ...makeDoc(),
      blocks: {
        r: { type: "root", children: ["l1"] },
        l1: { type: "list-item", attrs: { list: "bullet" }, children: ["l1"] },
      },
    };
    expectError(doc, "blocks.l1.children[0]", "cannot be its own child");
  });

  it("rejects content on non-text types and children on leaf types", () => {
    expectError(
      {
        ...makeDoc(),
        blocks: {
          r: { type: "root", children: ["i"] },
          i: { type: "image", attrs: { src: "k" }, content: [run("x")] },
        },
      },
      "blocks.i.content",
      "has no content"
    );
    expectError(
      { ...makeDoc(), blocks: { r: { type: "root", children: ["p"] }, p: { type: "paragraph", children: [] } } },
      "blocks.p.children",
      "has no children"
    );
  });

  it("requires a children array on the root block", () => {
    expectError({ ...makeDoc(), blocks: { r: { type: "root" } } }, "blocks.r.children", "must have a children array");
  });

  it("accepts a root block keyed by the document id", () => {
    expectValid({
      v: 1,
      id: "d1",
      title: "T",
      createdAt: "2026-10-08T10:00:00Z",
      blocks: { d1: { type: "root", children: [] } },
    });
  });

  it("rejects a root block keyed differently from the document id", () => {
    expectError({ ...makeDoc(), id: "doc1" }, "blocks.r", 'keyed by the document id "doc1"');
  });

  it("rejects non-array content and children", () => {
    expectError(
      { ...makeDoc(), blocks: { r: { type: "root", children: ["p"] }, p: { type: "paragraph", content: "x" } } },
      "blocks.p.content",
      "must be an array of runs"
    );
    expectError(
      {
        ...makeDoc(),
        blocks: {
          r: { type: "root", children: ["l1"] },
          l1: { type: "list-item", attrs: { list: "bullet" }, children: 5 },
        },
      },
      "blocks.l1.children",
      "must be an array of block ids"
    );
  });

  it("enforces allowed child types per parent", () => {
    expectError(
      { ...makeDoc(), blocks: { r: { type: "root", children: ["row"] }, row: { type: "table-row", children: [] } } },
      "blocks.r.children[0]",
      'not allowed as a child of "root"'
    );
    const tableInCell = {
      ...makeDoc(),
      blocks: {
        r: { type: "root", children: ["t"] },
        t: { type: "table", attrs: { cols: 1 }, children: ["row"] },
        row: { type: "table-row", children: ["cell"] },
        cell: { type: "table-cell", children: ["t2"] },
        t2: { type: "table", attrs: { cols: 1 }, children: [] },
      },
    };
    expectError(tableInCell, "blocks.cell.children[0]", 'not allowed as a child of "table-cell"');
  });
});

describe("attributes", () => {
  const withBlock = (id: string, block: unknown) => ({
    ...makeDoc(),
    blocks: { r: { type: "root", children: [id] }, [id]: block },
  });

  it("validates enum domains and required attributes", () => {
    expectError(withBlock("h", { type: "heading", attrs: { level: 7 } }), "blocks.h.attrs.level", "one of");
    expectError(withBlock("h", { type: "heading" }), "blocks.h.attrs.level", "required");
    expectError(withBlock("la", { type: "latex" }), "blocks.la.attrs.display", "required");
    expectError(withBlock("t", { type: "table" }), "blocks.t.attrs.cols", "required");
    expectError(withBlock("i", { type: "image", attrs: {} }), "blocks.i.attrs.src", "required");
  });

  it("rejects unknown attributes and attributes on attribute-less types", () => {
    expectError(
      withBlock("h", { type: "heading", attrs: { level: 2, foo: 1 } }),
      "blocks.h.attrs.foo",
      "Unknown attribute"
    );
    expectError(withBlock("p", { type: "paragraph", attrs: {} }), "blocks.p.attrs", "has no attributes");
  });

  it("validates attribute value kinds", () => {
    expectError(withBlock("t", { type: "table", attrs: { cols: 0 } }), "blocks.t.attrs.cols", "must be >= 1");
    expectError(withBlock("t", { type: "table", attrs: { cols: 1.5 } }), "blocks.t.attrs.cols", "integer");
    expectError(withBlock("t", { type: "table", attrs: { cols: Infinity } }), "blocks.t.attrs.cols", "integer");
    expectError(withBlock("i", { type: "image", attrs: { src: "k", width: 0 } }), "blocks.i.attrs.width", "positive");
    expectError(withBlock("t", { type: "table", attrs: { cols: "2" } }), "blocks.t.attrs.cols", "must be a number");
    expectError(withBlock("i", { type: "image", attrs: { src: "" } }), "blocks.i.attrs.src", "non-empty");
    expectError(withBlock("i", { type: "image", attrs: { src: "k", width: -5 } }), "blocks.i.attrs.width", "positive");
    expectError(
      withBlock("i", { type: "image", attrs: { src: "k", width: "100" } }),
      "blocks.i.attrs.width",
      "number or null"
    );
    expectError(withBlock("i", { type: "image", attrs: { src: "k", align: "up" } }), "blocks.i.attrs.align", "one of");
    expectError(
      withBlock("co", { type: "code", attrs: { language: 5 } }),
      "blocks.co.attrs.language",
      "must be a string"
    );
    expectError(withBlock("c", { type: "callout", attrs: { variant: "error" } }), "blocks.c.attrs.variant", "one of");
    expectError(withBlock("l", { type: "list-item", attrs: { list: "star" } }), "blocks.l.attrs.list", "one of");
  });
});

describe("runs and marks", () => {
  const withContent = (content: unknown) => ({
    ...makeDoc(),
    blocks: { r: { type: "root", children: ["p"] }, p: { type: "paragraph", content } },
  });

  it("validates run shape", () => {
    expectValid(withContent([run("x")]));
    expectError(withContent([{ marks: {} }]), "blocks.p.content[0].text", "must be a string");
    expectError(withContent([{ text: 5, marks: {} }]), "blocks.p.content[0].text", "must be a string");
    expectError(withContent([{ text: "x" }]), "blocks.p.content[0].marks", "run.marks is required");
    expectError(withContent([{ text: "x", marks: "x" }]), "blocks.p.content[0].marks", "plain object");
    expectError(withContent(["x"]), "blocks.p.content[0]", "plain object");
  });

  it("validates mark names, values, and exclusive rules", () => {
    expectError(
      withContent([{ text: "x", marks: { strikethrough: true } }]),
      "blocks.p.content[0].marks.strikethrough",
      "Unknown mark"
    );
    expectError(withContent([{ text: "x", marks: { bold: false } }]), "blocks.p.content[0].marks.bold", "must be true");
    expectError(withContent([{ text: "x", marks: { bold: {} } }]), "blocks.p.content[0].marks.bold", "must be true");
    expectError(withContent([run("x", { link: { href: "mailto:a@b.c" } })]), "blocks.p.content[0].marks.link", "href");
    expectError(withContent([{ text: "x", marks: { link: {} } }]), "blocks.p.content[0].marks.link", "href");
    expectError(
      withContent([{ text: "x", marks: { link: { href: "https://e.com", title: "t" } } }]),
      "blocks.p.content[0].marks.link.title",
      "Unknown attribute"
    );
    expectError(withContent([run("x", { color: { value: "#123" } })]), "blocks.p.content[0].marks.color", "hex color");
    expectError(
      withContent([run("x", { highlight: { value: "abc" } })]),
      "blocks.p.content[0].marks.highlight",
      "hex color"
    );
    expectError(
      withContent([{ text: "x", marks: { math: { tex: 5 } } }]),
      "blocks.p.content[0].marks.math",
      "tex string"
    );
    expectError(
      withContent([{ text: "x", marks: { color: {} } }]),
      "blocks.p.content[0].marks.color",
      "requires a value"
    );
    expectError(withContent([{ text: "x", marks: { link: { href: "" } } }]), "blocks.p.content[0].marks.link", "href");
    expectError(
      withContent([{ text: "x", marks: { bold: "true" } }]),
      "blocks.p.content[0].marks.bold",
      "must be true"
    );
    expectError(withContent([{ text: "x", marks: { bold: null } }]), "blocks.p.content[0].marks.bold", "must be true");
    expectError(withContent([run("x", { code: true, bold: true })]), "blocks.p.content[0].marks", "exclusive");
    expectError(
      withContent([run("x", { math: { tex: "x" }, italic: true })]),
      "blocks.p.content[0].marks",
      "exclusive"
    );
  });

  it("forbids marks inside code blocks but allows them in latex", () => {
    expectError(
      {
        ...makeDoc(),
        blocks: { r: { type: "root", children: ["co"] }, co: { type: "code", content: [run("x", { bold: true })] } },
      },
      "blocks.co.content[0].marks",
      "code block must not carry marks"
    );
    expectValid({
      ...makeDoc(),
      blocks: {
        r: { type: "root", children: ["la"] },
        la: { type: "latex", attrs: { display: false }, content: [run("x", { bold: true })] },
      },
    });
  });
});

describe("table rows", () => {
  const tableWithRowCells = (cols: number, cells: number) => ({
    ...makeDoc(),
    blocks: {
      r: { type: "root", children: ["t"] },
      t: { type: "table", attrs: { cols }, children: ["row"] },
      row: { type: "table-row", children: Array.from({ length: cells }, (_, i) => `c${i}`) },
      ...Object.fromEntries(
        Array.from({ length: Math.max(cells, 0) }, (_, i) => [`c${i}`, { type: "table-cell" as const }])
      ),
    },
  });

  it("requires exactly `cols` cells per row", () => {
    expectError(tableWithRowCells(2, 1), "blocks.row.children", "exactly 2 cell(s)");
    expectError(tableWithRowCells(2, 0), "blocks.row.children", "exactly 2 cell(s)");
    expectError(tableWithRowCells(2, 3), "blocks.row.children", "exactly 2 cell(s)");
    expectValid(tableWithRowCells(2, 2));
  });
});

describe("error reporting", () => {
  it("reports all violations in document order with stable messages", () => {
    const doc = {
      ...makeDoc(),
      blocks: {
        r: { type: "root", children: ["p", "missing"] },
        p: { type: "paragraph", content: [{ text: "x", marks: { bold: false } }] },
      },
    };
    expect(validateDoc(doc)).toEqual([
      { path: "blocks.r.children[1]", message: 'Dangling child id "missing" (no such block).' },
      { path: "blocks.p.content[0].marks.bold", message: 'Toggle mark "bold" must be true (got false).' },
    ]);
  });
});
