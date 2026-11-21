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
          r: { type: "root", children: ["p1", "h1", "l1", "c1", "co1", "t1", "img1", "d1"] },
          p1: {
            type: "paragraph",
            content: [
              run("Hello ", { bold: true }),
              run("world", { link: { href: "/page" }, color: { value: "#0066CC" }, highlight: { value: "#FFFF0080" } }),
              run("code", { code: true }),
            ],
          },
          h1: {
            type: "heading",
            attrs: { level: 6, align: "center" },
            content: [run("H", { italic: true, underline: true, strike: true })],
          },
          l1: { type: "list-item", attrs: { list: "bullet" }, children: ["l2"] },
          l2: { type: "list-item", attrs: { list: "task", checked: true }, content: [run("task")] },
          c1: { type: "callout", attrs: { variant: "warning" }, content: [run("note")] },
          co1: { type: "code", attrs: { language: "js" }, content: [run("const x = 1;")] },
          t1: { type: "table", columnOrder: ["col0", "col1"], children: ["row1", "row2"] },
          row1: { type: "table-row", children: ["c11", "c12"] },
          row2: { type: "table-row", children: ["c21", "c22"] },
          c11: { type: "table-cell", attrs: { columnId: "col0" }, content: [run("a")], children: ["pc"] },
          pc: { type: "paragraph", content: [run("nested leaf")] },
          c12: { type: "table-cell", attrs: { columnId: "col1" }, content: [] },
          c21: { type: "table-cell", attrs: { columnId: "col0" }, children: ["d2"] },
          d2: { type: "divider" },
          c22: { type: "table-cell", attrs: { columnId: "col1" }, content: [run("b")] },
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
      makeDoc({ blocks: { r: { type: "root", children: ["t"] }, t: { type: "table", columnOrder: ["col0", "col1"] } } })
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

  it("accepts the optional avatar (a string) and its absence", () => {
    expectValid(makeDoc()); // absent avatar is valid
    expectValid({ ...makeDoc(), avatar: "🦊" });
    expectValid({ ...makeDoc(), avatar: "" }); // the empty string is a valid (cleared) stand
  });

  it("rejects a non-string avatar", () => {
    expectError({ ...makeDoc(), avatar: 5 }, "avatar", "must be a string");
    expectError({ ...makeDoc(), avatar: { x: 1 } }, "avatar", "must be a string");
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
