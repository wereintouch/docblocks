// The markdown paste parser (the `text/plain` paste branch): the full
// syntax corpus — the block pass (headings, paragraphs, lists, quotes,
// code, dividers, tables, images, math) and the inline pass (the marks
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

describe("mdToBlocks — math", () => {
  it("the single-line $$ is the latex block", () => {
    const block = single("$$ x^2 $$");
    expect(block.type).toBe("latex");
    expect(textOf(block.runs)).toBe("x^2");
  });

  it("the multi-line $$ block", () => {
    const block = single("$$\na = b\nc = d\n$$");
    expect(block.type).toBe("latex");
    expect(textOf(block.runs)).toBe("a = b\nc = d");
  });

  it("the empty $$ is an empty latex block", () => {
    const block = single("$$\n$$");
    expect(block.type).toBe("latex");
    expect(block.runs).toEqual([]);
  });

  it("the latex content is a plain run (no marks)", () => {
    const block = single("$$ x^2 + y^2 $$");
    expect(block.runs).toEqual([{ text: "x^2 + y^2", marks: {} }]);
  });

  it("the unclosed $$ degrades to the literal text", () => {
    const blocks = mdToBlocks("$$\nabc");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph"]);
    expect(textOf(blocks[0]!.runs)).toBe("$$ abc");
  });

  it("the inline $ is the exclusive math mark", () => {
    const block = single("before $x^2$ after");
    expect(block.type).toBe("paragraph");
    expect(block.runs.map((r) => textOf([r]))).toEqual(["before ", "x^2", " after"]);
    expect(block.runs[1]!.marks.math).toEqual({ tex: "x^2" });
  });

  it("the spaced or the unclosed $ stays literal", () => {
    const spaced = mdToBlocks("$ a $");
    expect(textOf(spaced[0]!.runs)).toBe("$ a $");

    const unclosed = mdToBlocks("price $5");
    expect(textOf(unclosed[0]!.runs)).toBe("price $5");
  });
});

describe("mdToBlocks — inline marks", () => {
  it("the bold (** / __) and the italic (* / _)", () => {
    const blocks = mdToBlocks("**b1** __b2__ *i1* _i2_");
    const block = blocks[0]!;
    expect(block.runs.map((r) => textOf([r]))).toEqual(["b1", " ", "b2", " ", "i1", " ", "i2"]);
    expect(block.runs[0]!.marks).toEqual({ bold: true });
    expect(block.runs[2]!.marks).toEqual({ bold: true });
    expect(block.runs[4]!.marks).toEqual({ italic: true });
    expect(block.runs[6]!.marks).toEqual({ italic: true });
  });

  it("the snake_case identifiers stay literal (the _ word boundary)", () => {
    const block = single("my_var_name and a_b_ and c__d__e");
    expect(block.runs.length).toBe(1);
    expect(textOf(block.runs)).toBe("my_var_name and a_b_ and c__d__e");
  });

  it("the ~~ is the strike", () => {
    const block = single("keep ~~old~~ text");
    expect(block.runs.map((r) => [textOf([r]), r.marks])).toEqual([
      ["keep ", {}],
      ["old", { strike: true }],
      [" text", {}],
    ]);
  });

  it("the nested combinations (**bold *italic***, ***bi***)", () => {
    const block = single("**bold *italic* end**");
    expect(block.runs.map((r) => [textOf([r]), r.marks])).toEqual([
      ["bold ", { bold: true }],
      ["italic", { bold: true, italic: true }],
      [" end", { bold: true }],
    ]);

    const bi = mdToBlocks("***bi***");
    expect(bi[0]!.runs).toEqual([{ text: "bi", marks: { bold: true, italic: true } }]);
  });

  it("the code span is exclusive (no inherited marks)", () => {
    const block = single("**b** `x` **b**");
    expect(block.runs.map((r) => [textOf([r]), r.marks])).toEqual([
      ["b", { bold: true }],
      [" ", {}],
      ["x", { code: true }],
      [" ", {}],
      ["b", { bold: true }],
    ]);
  });

  it("the multi-backtick span keeps the inner backticks", () => {
    const block = single("`` `a` ``");
    expect(block.runs).toEqual([{ text: "`a`", marks: { code: true } }]);
  });

  it("the unbalanced delimiters stay literal", () => {
    const block = single("**bold and _italic");
    expect(textOf(block.runs)).toBe("**bold and _italic");
  });

  it("the whitespace-only emphasis stays literal", () => {
    const block = single("a ** ** b");
    expect(block.runs.length).toBe(1);
    expect(textOf(block.runs)).toBe("a ** ** b");
  });

  it("the link [text](href) and the href with the title", () => {
    const block = single('[t](https://x.com) and [u](https://y.com "T")');
    const linkRuns = block.runs.filter((r) => r.marks.link !== undefined);
    expect(linkRuns.map((r) => [textOf([r]), r.marks.link])).toEqual([
      ["t", { href: "https://x.com" }],
      ["u", { href: "https://y.com" }],
    ]);
  });

  it("the link text carries the nested marks", () => {
    const block = single("[**b**](https://x.com)");
    expect(block.runs).toEqual([{ text: "b", marks: { bold: true, link: { href: "https://x.com" } } }]);
  });

  it("the reference-style link stays literal (the v1 fallback)", () => {
    const block = single("[text][id]");
    expect(textOf(block.runs)).toBe("[text][id]");
  });

  it("the autolink <https://…> and the <mailto:…>", () => {
    const block = single("<https://x.com> and <mailto:a@b.c>");
    const linkRuns = block.runs.filter((r) => r.marks.link !== undefined);
    expect(linkRuns.map((r) => r.marks.link)).toEqual([{ href: "https://x.com" }, { href: "mailto:a@b.c" }]);
  });

  it("the math mark is exclusive: no inherited marks, even nested", () => {
    const block = single("**$x$**");
    expect(block.runs).toEqual([{ text: "x", marks: { math: { tex: "x" } } }]);
  });

  it("the backslash escape keeps the punctuation literal", () => {
    const block = single("\\*star\\* and \\#hash");
    expect(textOf(block.runs)).toBe("*star* and #hash");
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

  it("the raw HTML line degrades to the literal text", () => {
    const block = single("<div>html</div>");
    expect(block.type).toBe("paragraph");
    expect(textOf(block.runs)).toBe("<div>html</div>");
  });
});
