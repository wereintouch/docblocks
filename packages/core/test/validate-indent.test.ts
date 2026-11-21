import { describe, expect, it } from "vitest";

import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

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

describe("the flat page model (indent)", () => {
  const withSequence = (ids: string[], blocks: Record<string, unknown>) => ({
    ...makeDoc(),
    blocks: { r: { type: "root", children: ids }, ...blocks },
  });

  it("accepts the flat form: the nesting is the indent attr", () => {
    expectValid(
      withSequence(["a", "b", "c"], {
        a: { type: "paragraph", content: [{ text: "a", marks: {} }] },
        b: { type: "list-item", attrs: { list: "bullet", indent: 1 }, content: [{ text: "b", marks: {} }] },
        c: { type: "list-item", attrs: { list: "bullet" }, content: [{ text: "c", marks: {} }] },
      })
    );
    // The indent is allowed on every page-sequence type (incl. table, image, divider).
    expectValid(
      withSequence(["a", "t", "img", "d"], {
        a: { type: "paragraph" },
        t: { type: "table", columnOrder: ["col0"], attrs: { indent: 1 } },
        img: { type: "image", attrs: { src: "k", indent: 1 } },
        d: { type: "divider", attrs: { indent: 2 } },
      })
    );
  });

  it("accepts the legacy form: the nesting in the remodeled types' children (the old child rules apply)", () => {
    expectValid(
      withSequence(["p", "li"], {
        p: { type: "paragraph", content: [{ text: "c", marks: {} }], children: ["q"] },
        q: { type: "paragraph", content: [{ text: "n", marks: {} }] },
        li: { type: "list-item", attrs: { list: "bullet" }, children: ["li2"] },
        li2: { type: "list-item", attrs: { list: "bullet" } },
      })
    );
    // Legacy child-type rules stand: a list item nests only list items...
    const listChild = withSequence(["li"], {
      li: { type: "list-item", attrs: { list: "bullet" }, children: ["p2"] },
      p2: { type: "paragraph" },
    });
    expectError(listChild, "blocks.li.children[0]", 'not allowed as a child of "list-item"');
    // ...and a text container holds the page set (a table row is not one).
    const rowChild = withSequence(["p"], {
      p: { type: "paragraph", children: ["row"] },
      row: { type: "table-row", children: [] },
    });
    expectError(rowChild, "blocks.p.children[0]", 'not allowed as a child of "paragraph"');
    // And `children` stays rejected on the non-legacy types.
    expectError(
      withSequence(["img"], { img: { type: "image", attrs: { src: "k" }, children: [] } }),
      "blocks.img.children",
      "has no children"
    );
  });

  it("rejects an indent jump of more than one level within the root sequence", () => {
    const doc = withSequence(["a", "b"], {
      a: { type: "paragraph" },
      b: { type: "paragraph", attrs: { indent: 2 } },
    });
    expectError(doc, "blocks.b.attrs.indent", "by more than 1");
  });

  it("rejects a first block with a non-zero indent", () => {
    const doc = withSequence(["a"], { a: { type: "paragraph", attrs: { indent: 1 } } });
    expectError(doc, "blocks.a.attrs.indent", "must have indent 0");
  });

  it("rejects an indent jump in the cell mini-doc sequence", () => {
    const cell = {
      ...makeDoc(),
      blocks: {
        r: { type: "root", children: ["t"] },
        t: { type: "table", columnOrder: ["col0"], children: ["row"] },
        row: { type: "table-row", children: ["cell"] },
        cell: { type: "table-cell", attrs: { columnId: "col0" }, children: ["c1", "c2"] },
        c1: { type: "paragraph" },
        c2: { type: "paragraph", attrs: { indent: 2 } },
      },
    };
    expectError(cell, "blocks.c2.attrs.indent", "by more than 1");

    // Structural order ignores indent: a jump there is not a violation.
    const surface = {
      ...makeDoc(),
      blocks: {
        r: { type: "root", children: ["s"] },
        s: { type: "surface", children: ["sh1", "sh2"] },
        sh1: { type: "shape", attrs: { variant: "rect", indent: 0 } },
        sh2: { type: "shape", attrs: { variant: "ellipse", indent: 3 } },
      },
    };
    expectError(surface, "blocks.sh1.attrs.indent", "Unknown attribute"); // shapes are not page types
    const rowJump = {
      ...makeDoc(),
      blocks: {
        r: { type: "root", children: ["t"] },
        t: { type: "table", columnOrder: ["col0", "col1"], children: ["row"] },
        row: { type: "table-row", children: ["ra", "rb"] },
        ra: { type: "table-cell", attrs: { columnId: "col0" } },
        rb: { type: "table-cell", attrs: { columnId: "col1", indent: 3 } },
      },
    };
    expectError(rowJump, "blocks.rb.attrs.indent", "Unknown attribute");
  });

  it("lets a subtree return to a shallower level (a one-step jump down is fine)", () => {
    expectValid(
      withSequence(["a", "b", "c", "d"], {
        a: { type: "paragraph" },
        b: { type: "paragraph", attrs: { indent: 1 } },
        c: { type: "paragraph", attrs: { indent: 2 } },
        d: { type: "paragraph", attrs: { indent: 0 } },
      })
    );
  });
});
