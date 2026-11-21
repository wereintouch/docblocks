// The markdown paste parser (the `text/plain` paste branch): the full
// syntax corpus — the block pass (headings, paragraphs, lists, quotes,
// code, dividers, tables, images) and the inline pass (the marks
// with nesting, the escapes, the lenient fallbacks). Pure function, no
// DOM — the node environment.
import { describe, expect, it } from "vitest";

import type { TextRun } from "docblocks-core";

import { mdToBlocks } from "../src/editing/markdown";
import type { MdPasteBlock } from "../src/editing/markdown";

/** The plain text of a run list (the marks-agnostic content). */
function textOf(runs: TextRun[]): string {
  return runs.map((run) => run.text).join("");
}

/** The single block a fragment decomposes into (the one-block corpus cases). */
function single(markdown: string): MdPasteBlock {
  const blocks = mdToBlocks(markdown);
  if (blocks.length !== 1) throw new Error(`expected 1 block, got ${blocks.length}`);
  return blocks[0]!;
}

/** The first run of a block (the tests assert the dominant run). */
function firstRun(block: MdPasteBlock): TextRun {
  return block.runs[0]!;
}

describe("mdToBlocks — headings", () => {
  it("the ATX levels 1–6", () => {
    const blocks = mdToBlocks("# A\n## B\n### C\n#### D\n##### E\n###### F");
    expect(blocks.map((b) => [b.type, b.attrs.level])).toEqual([
      ["heading", 1],
      ["heading", 2],
      ["heading", 3],
      ["heading", 4],
      ["heading", 5],
      ["heading", 6],
    ]);
    expect(blocks.map((b) => textOf(b.runs))).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("the trailing hashes are dropped", () => {
    const block = single("## Title ##");
    expect(block.type).toBe("heading");
    expect(textOf(block.runs)).toBe("Title");
  });

  it("the heading carries the inline marks", () => {
    const block = single("## **Bold** heading with `code`");
    expect(block.attrs.level).toBe(2);
    expect(block.runs.map((r) => [textOf([r]), r.marks])).toEqual([
      ["Bold", { bold: true }],
      [" heading with ", {}],
      ["code", { code: true }],
    ]);
  });

  it("the `#` without a space is a paragraph (the hashtag)", () => {
    const block = single("#hashtag");
    expect(block.type).toBe("paragraph");
    expect(textOf(block.runs)).toBe("#hashtag");
  });

  it("the empty ATX heading is an empty heading", () => {
    const block = single("### ");
    expect(block.type).toBe("heading");
    expect(block.attrs.level).toBe(3);
    expect(block.runs).toEqual([]);
  });

  it("the setext headings (= h1, - h2)", () => {
    const blocks = mdToBlocks("Title\n===\nSub\n---");
    expect(blocks.map((b) => [b.type, b.attrs.level, textOf(b.runs)])).toEqual([
      ["heading", 1, "Title"],
      ["heading", 2, "Sub"],
    ]);
  });

  it("the `---` discriminator: right after the paragraph line it is the setext h2, after the blank line — the divider", () => {
    const setext = mdToBlocks("para\n---");
    expect(setext.map((b) => [b.type, b.attrs.level, textOf(b.runs)])).toEqual([["heading", 2, "para"]]);

    const thematic = mdToBlocks("para\n\n---\nafter");
    expect(thematic.map((b) => b.type)).toEqual(["paragraph", "divider", "paragraph"]);
  });

  it("the `***` and `___` thematic breaks", () => {
    const blocks = mdToBlocks("a\n\n***\nb\n\n___\nc");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "divider", "paragraph", "divider", "paragraph"]);
  });
});

describe("mdToBlocks — paragraphs", () => {
  it("the single line is a paragraph", () => {
    const block = single("Hello");
    expect(block.type).toBe("paragraph");
    expect(textOf(block.runs)).toBe("Hello");
  });

  it("the blank lines separate the paragraphs", () => {
    const blocks = mdToBlocks("a\n\nb\n\n\nc");
    expect(blocks.map((b) => textOf(b.runs))).toEqual(["a", "b", "c"]);
  });

  it("the soft break is a space, the hard break (two spaces / backslash) is a line break", () => {
    const soft = mdToBlocks("line1\nline2");
    expect(soft.length).toBe(1);
    expect(textOf(soft[0]!.runs)).toBe("line1 line2");

    const spaces = mdToBlocks("line1  \nline2");
    expect(textOf(spaces[0]!.runs)).toBe("line1\nline2");

    const backslash = mdToBlocks("line1\\\nline2");
    expect(textOf(backslash[0]!.runs)).toBe("line1\nline2");
  });

  it("the up-to-three-space indent is stripped", () => {
    const block = single("   indented text");
    expect(textOf(block.runs)).toBe("indented text");
  });

  it("the whitespace-only document is empty", () => {
    expect(mdToBlocks("  \n\n  ")).toEqual([]);
  });
});

describe("mdToBlocks — lists", () => {
  it("the bullet markers (-, *, +) and the number markers (.))", () => {
    const blocks = mdToBlocks("- a\n* b\n+ c\n1. d\n2) e");
    expect(blocks.map((b) => [b.type, b.attrs.list, textOf(b.runs)])).toEqual([
      ["list-item", "bullet", "a"],
      ["list-item", "bullet", "b"],
      ["list-item", "bullet", "c"],
      ["list-item", "number", "d"],
      ["list-item", "number", "e"],
    ]);
  });

  it("the task items (the [x] is checked)", () => {
    const blocks = mdToBlocks("- [ ] open\n- [X] done\n- plain");
    expect(blocks.map((b) => [b.attrs.list, b.attrs.checked, textOf(b.runs)])).toEqual([
      ["task", false, "open"],
      ["task", true, "done"],
      ["bullet", undefined, "plain"],
    ]);
  });

  it("the nesting depth is the 2-space step", () => {
    const blocks = mdToBlocks("- a\n  - b\n    - c");
    expect(blocks.map((b) => b.indent)).toEqual([0, 1, 2]);

    const four = mdToBlocks("- a\n    - b");
    expect(four.map((b) => b.indent)).toEqual([0, 2]);
  });

  it("the empty item is an empty list-item", () => {
    const block = single("- ");
    expect(block.type).toBe("list-item");
    expect(block.runs).toEqual([]);
  });

  it("the item carries the inline marks", () => {
    const block = single("- **bold** and `code`");
    expect(block.runs.map((r) => textOf([r]))).toEqual(["bold", " and ", "code"]);
    expect(block.runs[0]!.marks.bold).toBe(true);
    expect(block.runs[2]!.marks.code).toBe(true);
  });

  it("the indented line right after the item joins its text (the soft break)", () => {
    const block = single("- item\n    continuation");
    expect(textOf(block.runs)).toBe("item\ncontinuation");
  });
});

describe("mdToBlocks — quotes", () => {
  it("the single quote and the multi-line soft-break join", () => {
    const block = single("> line1\n> line2");
    expect(block.type).toBe("quote");
    expect(block.indent).toBe(0);
    expect(textOf(block.runs)).toBe("line1\nline2");
  });

  it("the `>>` nesting is the quote depth", () => {
    const block = single(">> nested");
    expect(block.type).toBe("quote");
    expect(block.indent).toBe(1);
  });

  it("the empty quote is an empty quote block", () => {
    const block = single(">");
    expect(block.type).toBe("quote");
    expect(block.runs).toEqual([]);
  });

  it("the quote carries the inline marks", () => {
    const block = single("> **q**");
    expect(firstRun(block).marks.bold).toBe(true);
    expect(textOf(block.runs)).toBe("q");
  });
});
