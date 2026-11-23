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

describe("block structure", () => {
  it("rejects unknown block types and non-object blocks", () => {
    expectError(
      { ...makeDoc(), blocks: { r: { type: "root", children: [] }, b: { type: "note" } } },
      "blocks.b",
      'Unknown block type "note"'
    );
    // The removed latex block is rejected as an unknown type (the strict
    // import guard; the lenient reader falls back to a placeholder instead).
    expectError(
      { ...makeDoc(), blocks: { r: { type: "root", children: [] }, b: { type: "latex" } } },
      "blocks.b",
      'Unknown block type "latex"'
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
      { ...makeDoc(), blocks: { r: { type: "root", children: ["d"] }, d: { type: "divider", children: [] } } },
      "blocks.d.children",
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
        t: { type: "table", columnOrder: ["col0"], children: ["row"] },
        row: { type: "table-row", children: ["cell"] },
        cell: { type: "table-cell", attrs: { columnId: "col0" }, children: ["t2"] },
        t2: { type: "table", columnOrder: ["col0"], children: [] },
      },
    };
    expectError(tableInCell, "blocks.cell.children[0]", 'not allowed as a child of "table-cell"');
  });
});

describe("table rows", () => {
  const tableWithRowCells = (cols: number, cells: number) => ({
    ...makeDoc(),
    blocks: {
      r: { type: "root", children: ["t"] },
      t: {
        type: "table",
        columnOrder: Array.from({ length: cols }, (_, i) => `col${i}`),
        children: ["row"],
      },
      row: { type: "table-row", children: Array.from({ length: cells }, (_, i) => `c${i}`) },
      ...Object.fromEntries(
        Array.from({ length: Math.max(cells, 0) }, (_, i) => [
          `c${i}`,
          { type: "table-cell" as const, attrs: { columnId: `col${i}` } },
        ])
      ),
    },
  });

  it("rejects an overfull row; a short row stands the concurrent column-insert residue", () => {
    expectError(tableWithRowCells(2, 3), "blocks.row.children", "must not hold more than 2 cell(s)");
    // A row with fewer cells than columns is a valid race residue (a row
    // created before a concurrent column insert): the read stands the
    // missing cells as placeholders.
    expectValid(tableWithRowCells(2, 1));
    expectValid(tableWithRowCells(2, 2));
  });
});
