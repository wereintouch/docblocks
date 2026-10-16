import { describe, expect, it } from "vitest";

import { flattenDoc, validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

/**
 * flattenDoc : the legacy nesting form (depth) as the flat form
 * (indent). Pure JSON -> JSON, no CRDT; the writer's contract for the
 * legacy-to-flat conversion (used by fromJSON / loadDoc and by tests).
 */

const CREATED_AT = "2026-10-08T10:00:00Z";

const doc = (blocks: DocJSON["blocks"]): DocJSON => ({
  v: 1,
  id: "r",
  title: "T",
  createdAt: CREATED_AT,
  blocks,
});

const text = (value: string) => [{ text: value, marks: {} }];

const list = (kind: "bullet" | "number" | "task" = "bullet") => ({ list: kind });

describe("flattenDoc — the page sequences", () => {
  it("a nested bullet/number/task tree (depth > 3) becomes a flat run of indents", () => {
    const input = doc({
      r: { type: "root", children: ["l1"] },
      l1: { type: "list-item", attrs: list("bullet"), children: ["l2"] },
      l2: { type: "list-item", attrs: list("number"), children: ["l3"] },
      l3: { type: "list-item", attrs: list("task"), children: ["l4"] },
      l4: { type: "list-item", attrs: list("task") },
    });
    const flat = flattenDoc(input);
    expect(flat.blocks.r).toEqual({ type: "root", children: ["l1", "l2", "l3", "l4"] });
    expect(flat.blocks.l1).toEqual({ type: "list-item", attrs: list("bullet") });
    expect((flat.blocks.l2 as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    expect((flat.blocks.l3 as { attrs?: { indent?: number } }).attrs?.indent).toBe(2);
    expect((flat.blocks.l4 as { attrs?: { indent?: number } }).attrs?.indent).toBe(3);
    expect(validateDoc(flat)).toEqual([]);
  });

  it("the text-type children (the 10-13 shape) inline in reading order, a container inside included", () => {
    const input = doc({
      r: { type: "root", children: ["p", "after"] },
      p: { type: "paragraph", content: text("outer"), children: ["q", "t", "li"] },
      q: { type: "paragraph", content: text("mid"), children: ["deep"] },
      deep: { type: "heading", attrs: { level: 2 }, content: text("deep") },
      t: { type: "table", attrs: { cols: 1 }, children: ["row"] },
      row: { type: "table-row", children: ["cell"] },
      cell: { type: "table-cell", content: text("cell") },
      li: { type: "list-item", attrs: list(), content: text("li") },
      after: { type: "paragraph", content: text("after") },
    });
    const flat = flattenDoc(input);
    // Reading order: p, then its subtree (q, q's child deep, t, li) before "after".
    expect(flat.blocks.r).toEqual({ type: "root", children: ["p", "q", "deep", "t", "li", "after"] });
    expect((flat.blocks.q as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    expect((flat.blocks.deep as { attrs?: { indent?: number } }).attrs?.indent).toBe(2);
    // The structural container is NOT expanded: the table stays one entry,
    // its internals untouched; like any inlined child it derives the indent
    // from the depth (the legacy form nested it under p).
    expect(flat.blocks.t).toEqual({ type: "table", attrs: { cols: 1, indent: 1 }, children: ["row"] });
    expect(flat.blocks.row).toEqual({ type: "table-row", children: ["cell"] });
    // A list item among the inlined content derives its indent too.
    expect((flat.blocks.li as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    expect("children" in (flat.blocks.p as object)).toBe(false);
    expect(validateDoc(flat)).toEqual([]);
  });

  it("the cell mini-doc and the frame nested page flatten within their own sequences", () => {
    const input = doc({
      r: { type: "root", children: ["t", "s"] },
      t: { type: "table", attrs: { cols: 2 }, children: ["row"] },
      row: { type: "table-row", children: ["c1", "c2"] },
      c1: { type: "table-cell", children: ["a", "b"] },
      a: { type: "paragraph", content: text("a"), children: ["a1"] },
      a1: { type: "paragraph", content: text("a1") },
      b: { type: "paragraph", content: text("b") },
      c2: { type: "table-cell", content: [] },
      s: { type: "surface", children: ["f", "sh"] },
      f: { type: "frame", children: ["f1", "f2"] },
      f1: { type: "paragraph", content: text("f1") },
      f2: { type: "paragraph", content: text("f2"), children: ["f3"] },
      f3: { type: "paragraph", content: text("f3") },
      sh: { type: "shape", attrs: { variant: "rect" } },
    });
    const flat = flattenDoc(input);
    // The cell sequence: a, its child, then b — within the cell.
    expect(flat.blocks.c1).toEqual({ type: "table-cell", children: ["a", "a1", "b"] });
    expect((flat.blocks.a1 as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    // The frame's nested page: f1, f2, its child — within the frame.
    expect(flat.blocks.f).toEqual({ type: "frame", children: ["f1", "f2", "f3"] });
    expect((flat.blocks.f3 as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    // The surface z-order keeps its entries (the shape untouched).
    expect(flat.blocks.s).toEqual({ type: "surface", children: ["f", "sh"] });
    expect(validateDoc(flat)).toEqual([]);
  });

  it("a legacy subtree inside a surface z-order inlines after its parent entry there", () => {
    const input = doc({
      r: { type: "root", children: ["s"] },
      s: { type: "surface", children: ["p", "sh"] },
      p: { type: "paragraph", content: text("p"), children: ["p1"] },
      p1: { type: "paragraph", content: text("p1") },
      sh: { type: "shape", attrs: { variant: "rect" } },
    });
    const flat = flattenDoc(input);
    expect(flat.blocks.s).toEqual({ type: "surface", children: ["p", "p1", "sh"] });
    expect((flat.blocks.p1 as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    expect("children" in (flat.blocks.p as object)).toBe(false);
  });
});

describe("flattenDoc — the lenient clamps", () => {
  it("an indent jump of the first block is clamped to 0 (the sequence anchor)", () => {
    const input = doc({
      r: { type: "root", children: ["a", "b"] },
      a: { type: "paragraph", attrs: { indent: 2 } },
      b: { type: "paragraph" },
    });
    const flat = flattenDoc(input);
    expect((flat.blocks.a as { attrs?: { indent?: number } }).attrs?.indent).toBe(0);
    expect(validateDoc(flat)).toEqual([]);
  });

  it("an indent jump after a shallower block is clamped to preceding + 1", () => {
    const input = doc({
      r: { type: "root", children: ["a", "b", "c"] },
      a: { type: "paragraph" },
      b: { type: "paragraph", attrs: { indent: 3 } },
      c: { type: "paragraph", attrs: { indent: 1 } },
    });
    const flat = flattenDoc(input);
    // b clamps to 1 (a + 1); c keeps 1 (b + 0).
    expect((flat.blocks.b as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    expect((flat.blocks.c as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    expect(validateDoc(flat)).toEqual([]);
  });

  it("a mixed doc (legacy nesting with stored indents) clamps the derived values", () => {
    const input = doc({
      r: { type: "root", children: ["p", "q"] },
      p: { type: "paragraph", attrs: { indent: 0 }, children: ["x"] },
      x: { type: "paragraph", attrs: { indent: 5 } }, // depth wins + clamp
      q: { type: "paragraph", attrs: { indent: 2 } }, // a jump over x's tail
    });
    const flat = flattenDoc(input);
    // x: the depth derivation (p + 1 = 1) clamped against p (0) -> 1; the
    // stored 5 does not stand. q: clamped against x's tail (1) -> 1... no:
    // q's stored 2 vs preceding x (1) -> 2 is a jump of 1, it stands.
    expect((flat.blocks.x as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    expect((flat.blocks.q as { attrs?: { indent?: number } }).attrs?.indent).toBe(2);
    expect(validateDoc(flat)).toEqual([]);
  });
});

describe("flattenDoc — purity and byte-stability", () => {
  it("is byte-stable on the flat shape (idempotent, the bytes stand)", () => {
    const flat = doc({
      r: { type: "root", children: ["a", "b", "c"] },
      a: { type: "paragraph", content: text("a") },
      b: { type: "list-item", attrs: { list: "bullet", indent: 1 }, content: text("b") },
      c: { type: "divider", attrs: { indent: 0 } },
    });
    expect(JSON.stringify(flattenDoc(flat))).toBe(JSON.stringify(flat));
    expect(JSON.stringify(flattenDoc(flattenDoc(flat)))).toBe(JSON.stringify(flat));
  });

  it("returns plain JSON (no live structures) and does not mutate the input", () => {
    const legacy = doc({
      r: { type: "root", children: ["p"] },
      p: { type: "paragraph", content: text("p"), children: ["q"] },
      q: { type: "paragraph", content: text("q") },
    });
    const before = JSON.stringify(legacy);
    const flat = flattenDoc(legacy);
    expect(JSON.stringify(legacy)).toBe(before);
    expect(JSON.parse(JSON.stringify(flat))).toEqual(flat);
    // The legacy children field is dropped (the content is inlined into the
    // root sequence); a derived indent is a fresh attrs object.
    expect(flat.blocks.p).toEqual({ type: "paragraph", content: text("p") });
    expect("children" in (flat.blocks.p as object)).toBe(false);
    expect(flat.blocks.q).toEqual({ type: "paragraph", content: text("q"), attrs: { indent: 1 } });
  });
});

describe("flattenDoc — the quote legacy form", () => {
  it("normalizes the quote's legacy nested form to the flat indent (the page types' shared rule)", () => {
    const input = doc({
      r: { type: "root", children: ["q1"] },
      q1: { type: "quote", content: text("outer"), children: ["q2"] },
      q2: { type: "quote", content: text("inner") },
    });
    const flat = flattenDoc(input);
    expect(flat.blocks.r).toEqual({ type: "root", children: ["q1", "q2"] });
    expect(flat.blocks.q1).toEqual({ type: "quote", content: text("outer") });
    expect((flat.blocks.q2 as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
  });
});
