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

describe("attributes", () => {
  const withBlock = (id: string, block: unknown) => ({
    ...makeDoc(),
    blocks: { r: { type: "root", children: [id] }, [id]: block },
  });

  it("validates enum domains and required attributes", () => {
    expectError(withBlock("h", { type: "heading", attrs: { level: 7 } }), "blocks.h.attrs.level", "one of");
    expectError(withBlock("h", { type: "heading" }), "blocks.h.attrs.level", "required");
    expectError(withBlock("e", { type: "embed" }), "blocks.e.attrs.kind", "required");
    expectError(withBlock("t", { type: "table" }), "blocks.t.columnOrder", "columnOrder");
    expectError(withBlock("i", { type: "image", attrs: {} }), "blocks.i.attrs.src", "required");
  });

  it("rejects unknown attributes and attributes on attribute-less types", () => {
    expectError(
      withBlock("h", { type: "heading", attrs: { level: 2, foo: 1 } }),
      "blocks.h.attrs.foo",
      "Unknown attribute"
    );
    expectError(
      {
        ...makeDoc(),
        blocks: {
          r: { type: "root", children: ["t"] },
          t: { type: "table", columnOrder: ["col0"], children: ["row"] },
          row: { type: "table-row", children: ["c"], attrs: {} },
          c: { type: "table-cell", attrs: { columnId: "col0" } },
        },
      },
      "blocks.row.attrs",
      "has no attributes"
    );
    // The indent on a structural-context type is an unknown attribute.
    expectError(withBlock("d", { type: "divider", attrs: { indent: -1 } }), "blocks.d.attrs.indent", "must be >= 0");
    expectError(
      withBlock("l", { type: "list-item", attrs: { list: "bullet", indent: 1.5 } }),
      "blocks.l.attrs.indent",
      "must be an integer"
    );
  });

  it("validates attribute value kinds", () => {
    expectError(
      withBlock("t", { type: "table", columnOrder: ["c1"], attrs: { columnWidths: [40] } }),
      "blocks.t.attrs.columnWidths[0]",
      "must be >= 50"
    );
    expectError(withBlock("i", { type: "image", attrs: { src: "k", width: 0 } }), "blocks.i.attrs.width", "positive");
    expectError(withBlock("t", { type: "table", columnOrder: ["c1", "c1"] }), "blocks.t.columnOrder", "unique");
    expectError(withBlock("i", { type: "image", attrs: { src: "" } }), "blocks.i.attrs.src", "non-empty");
    expectError(withBlock("i", { type: "image", attrs: { src: "k", width: -5 } }), "blocks.i.attrs.width", "positive");
    expectError(
      withBlock("i", { type: "image", attrs: { src: "k", width: "100" } }),
      "blocks.i.attrs.width",
      "number or null"
    );
    // Non-finite numbers are rejected: they are not JSON-representable
    // (JSON.stringify stands them as null) and would hand an infinite size
    // to the renderer / layout.
    expectError(
      withBlock("i", { type: "image", attrs: { src: "k", width: Infinity } }),
      "blocks.i.attrs.width",
      "finite number"
    );
    expectError(
      withBlock("i", { type: "image", attrs: { src: "k", width: -Infinity } }),
      "blocks.i.attrs.width",
      "finite number"
    );
    expectError(
      withBlock("i", { type: "image", attrs: { src: "k", width: NaN } }),
      "blocks.i.attrs.width",
      "finite number"
    );
    expectError(
      withBlock("t", { type: "table", columnOrder: ["c1"], attrs: { columnWidths: [Infinity] } }),
      "blocks.t.attrs.columnWidths[0]",
      "finite number"
    );
    expectError(withBlock("i", { type: "image", attrs: { src: "k", align: "up" } }), "blocks.i.attrs.align", "one of");
    expectError(withBlock("p", { type: "paragraph", attrs: { align: "up" } }), "blocks.p.attrs.align", "one of");
    expectError(
      withBlock("l", { type: "list-item", attrs: { list: "bullet", align: "justify" } }),
      "blocks.l.attrs.align",
      "one of"
    );
    expectError(
      withBlock("co", { type: "code", attrs: { language: 5 } }),
      "blocks.co.attrs.language",
      "must be a string"
    );
    expectError(withBlock("c", { type: "callout", attrs: { variant: "error" } }), "blocks.c.attrs.variant", "one of");
    expectError(withBlock("l", { type: "list-item", attrs: { list: "star" } }), "blocks.l.attrs.list", "one of");
    expectError(withBlock("q", { type: "quote", attrs: { align: "justify" } }), "blocks.q.attrs.align", "one of");
  });

  it("callout color/icon: hex/name/null stand; an invalid hex and an unknown name are rejected (strict)", () => {
    // Absent (the preset default), a valid hex, and an explicit null = the
    // preset (the null idiom).
    expectValid(withBlock("c", { type: "callout", attrs: { variant: "info" } }));
    expectValid(withBlock("c", { type: "callout", attrs: { variant: "info", color: "#ff0000" } }));
    expectValid(withBlock("c", { type: "callout", attrs: { variant: "info", color: null } }));
    expectValid(withBlock("c", { type: "callout", attrs: { variant: "info", icon: "info" } }));
    expectValid(withBlock("c", { type: "callout", attrs: { variant: "info", icon: null } }));
    expectValid(
      withBlock("c", { type: "callout", attrs: { variant: "warning", color: "#ff0000", icon: "lightbulb" } })
    );
    // An invalid hex color is rejected.
    expectError(withBlock("c", { type: "callout", attrs: { color: "red" } }), "blocks.c.attrs.color", "hex color");
    expectError(withBlock("c", { type: "callout", attrs: { color: 5 } }), "blocks.c.attrs.color", "must be a string");
    // An unknown icon name and a non-string icon are rejected (strict).
    expectError(withBlock("c", { type: "callout", attrs: { icon: "not-an-icon" } }), "blocks.c.attrs.icon", "one of");
    expectError(withBlock("c", { type: "callout", attrs: { icon: 5 } }), "blocks.c.attrs.icon", "one of");
  });

  it("accepts a code block with the display attrs (incl. the empty-string caption)", () => {
    expectValid(
      withBlock("co", {
        type: "code",
        attrs: {
          language: "ts",
          collapsed: true,
          caption: "",
          lineNumbers: false,
          wrap: false,
          mermaidMode: "preview",
        },
        content: [run("a")],
      })
    );
    expectValid(withBlock("co", { type: "code", attrs: { mermaidMode: "code" }, content: [run("a")] }));
  });

  it("accepts the code block's diagram viewport attrs (the persisted view + the stretched height)", () => {
    expectValid(
      withBlock("co", {
        type: "code",
        attrs: { language: "mermaid", mermaidMode: "preview", zoom: 0.5, panX: -10, panY: 12.5, height: 320 },
        content: [run("a")],
      })
    );
    // The null idiom's stand (the view cleared / the auto's height).
    expectValid(
      withBlock("co", {
        type: "code",
        attrs: { zoom: null, panX: null, panY: null, height: null },
        content: [run("a")],
      })
    );
  });

  it("rejects out-of-domain values on the code viewport attrs", () => {
    expectError(withBlock("co", { type: "code", attrs: { zoom: 0 } }), "blocks.co.attrs.zoom", "positive");
    expectError(withBlock("co", { type: "code", attrs: { height: -5 } }), "blocks.co.attrs.height", "positive");
    expectError(withBlock("co", { type: "code", attrs: { panX: "left" } }), "blocks.co.attrs.panX", "number");
  });

  it("rejects out-of-domain values on the code display attrs", () => {
    expectError(
      withBlock("co", { type: "code", attrs: { collapsed: "yes" } }),
      "blocks.co.attrs.collapsed",
      "must be a boolean"
    );
    expectError(
      withBlock("co", { type: "code", attrs: { caption: 5 } }),
      "blocks.co.attrs.caption",
      "must be a string"
    );
    expectError(withBlock("co", { type: "code", attrs: { wrap: null } }), "blocks.co.attrs.wrap", "must be a boolean");
    expectError(
      withBlock("co", { type: "code", attrs: { mermaidMode: "zoom" } }),
      "blocks.co.attrs.mermaidMode",
      "one of"
    );
  });

  it("accepts a quote with the shared text attrs", () => {
    expectValid(withBlock("q", { type: "quote", content: [run("borrowed")] }));
    expectValid(withBlock("q", { type: "quote", attrs: { align: "center" }, content: [run("a\nb")] }));
  });
});
