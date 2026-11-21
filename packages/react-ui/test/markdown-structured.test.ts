// The markdown paste parser (the `text/plain` paste branch): the
// structured blocks — the fenced code (the language, the fence's content
// as data), the GFM tables, the image lines — and the whole-document's
// integration (the realistic doc, the CRLF, the wrapper tags). Pure
// function, no DOM — the node environment.
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

describe("mdToBlocks — code", () => {
  it("the fenced code with the language (the info string)", () => {
    const block = single("```rust\nfn main() {}\n```");
    expect(block.type).toBe("code");
    expect(block.attrs.language).toBe("rust");
    expect(textOf(block.runs)).toBe("fn main() {}");
  });

  it("the fence content is data: no inline pass, the multi-line is kept", () => {
    const block = single("```\n**not bold**\n`not code`\n```");
    expect(textOf(block.runs)).toBe("**not bold**\n`not code`");
    expect(block.runs[0]!.marks).toEqual({});
  });

  it("the tilde fence and the long fence run", () => {
    const tilde = mdToBlocks("~~~ py\nx\n~~~");
    expect(tilde[0]!.attrs.language).toBe("py");

    const long = mdToBlocks("````text\nx\n````");
    expect(long[0]!.attrs.language).toBe("text");
  });

  it("the unclosed fence keeps its content (the lenient posture)", () => {
    const block = single("```\na\nb");
    expect(block.type).toBe("code");
    expect(textOf(block.runs)).toBe("a\nb");
  });

  it("the indented code (4 spaces outside the list context)", () => {
    const block = single("    def f():\n    pass");
    expect(block.type).toBe("code");
    expect(block.attrs).toEqual({});
    expect(textOf(block.runs)).toBe("def f():\npass");
  });

  it("the empty fence is an empty code block", () => {
    const block = single("```\n```");
    expect(block.type).toBe("code");
    expect(block.runs).toEqual([]);
  });
});

describe("mdToBlocks — tables", () => {
  it("the GFM table: the header + the rows, the separator row is not inserted", () => {
    const block = single("| H1 | H2 |\n| --- | --- |\n| a | b |\n| c | d |");
    expect(block.type).toBe("table");
    expect(block.rows).toBeDefined();
    expect(block.rows!.map((row) => row.map(textOf))).toEqual([
      ["H1", "H2"],
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("the alignment cells of the separator are ignored", () => {
    const block = single("| a | b |\n| :--- | ---: |\n| x | y |");
    expect(block.rows!.map((row) => row.map(textOf))).toEqual([
      ["a", "b"],
      ["x", "y"],
    ]);
  });

  it("the escaped pipe is the cell content", () => {
    const block = single("| a \\| b | c |\n| --- | --- |\n| x | y |");
    expect(block.rows![0]!.map(textOf)).toEqual(["a | b", "c"]);
  });

  it("the ragged rows are padded to the header width (the lenient posture)", () => {
    const block = single("| a | b | c |\n| --- | --- | --- |\n| 1 | 2 |");
    expect(block.rows![1]!.map(textOf)).toEqual(["1", "2", ""]);
  });

  it("the cells carry the inline marks", () => {
    const block = single("| **b** |\n| --- |\n| *i* |");
    expect(block.rows![0]![0]![0]!.marks.bold).toBe(true);
    expect(block.rows![1]![0]![0]!.marks.italic).toBe(true);
  });

  it("the pipe line without the separator row is a paragraph (the literal text)", () => {
    const block = single("a | b | c");
    expect(block.type).toBe("paragraph");
  });

  it("the header/separator width mismatch is not a table (the setext fall-through)", () => {
    const blocks = mdToBlocks("a | b\n---");
    expect(blocks.map((b) => [b.type, b.attrs.level])).toEqual([["heading", 2]]);
    expect(textOf(blocks[0]!.runs)).toBe("a | b");
  });
});

describe("mdToBlocks — images", () => {
  it("the standalone image line is the image block (the src as-is)", () => {
    const block = single("![alt](img.png)");
    expect(block.type).toBe("image");
    expect(block.attrs.src).toBe("img.png");
    expect(block.runs).toEqual([]);
  });

  it("the optional title is dropped from the src", () => {
    const block = single('![alt](img.png "the title")');
    expect(block.attrs.src).toBe("img.png");
  });

  it("the URL src is kept as-is (the consumer BlobResolver resolves)", () => {
    const block = single("![alt](https://example.com/i.png)");
    expect(block.attrs.src).toBe("https://example.com/i.png");
  });

  it("the inline image in the middle of the line degrades to the literal text", () => {
    const block = single("see ![a](b.png) here");
    expect(block.type).toBe("paragraph");
    expect(textOf(block.runs)).toBe("see ![a](b.png) here");
  });
});

describe("mdToBlocks — the integration", () => {
  it("the realistic document decomposes into the native blocks", () => {
    const md = [
      "# Doc",
      "",
      "A paragraph with **bold** and [a link](https://x.com).",
      "",
      "## Section",
      "- one",
      "  - nested",
      "- [x] done",
      "",
      "> a quote",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "---",
      "",
      "![pic](pic.png)",
    ].join("\n");
    const blocks = mdToBlocks(md);
    expect(blocks.map((b) => [b.type, b.attrs.level ?? b.attrs.list ?? "", textOf(b.runs).slice(0, 20)])).toEqual([
      ["heading", 1, "Doc"],
      ["paragraph", "", "A paragraph with bol"],
      ["heading", 2, "Section"],
      ["list-item", "bullet", "one"],
      ["list-item", "bullet", "nested"],
      ["list-item", "task", "done"],
      ["quote", "", "a quote"],
      ["code", "", "const x = 1;"],
      ["table", "", ""],
      ["divider", "", ""],
      ["image", "", ""],
    ]);
    expect(blocks.map((b) => b.indent)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  });

  it("the CRLF document is normalized", () => {
    const blocks = mdToBlocks("# T\r\n\r\nbody\r\n\r\n- item");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list-item"]);
  });

  it("the wrapper tags drop with the content kept (the inline tag pass)", () => {
    const block = single("<div>html</div>");
    expect(block.type).toBe("paragraph");
    expect(textOf(block.runs)).toBe("html");
  });
});
