// @vitest-environment jsdom
// The rich `text/html` paste parse (`htmlToBlocks`): the block structure
// (headings, paragraphs, lists, pre, blockquote, hr, table) becomes paste
// blocks, the inline whitelist becomes the runs' marks, the lenient edges
// (unknown blocks, the excluded metadata, the whitespace). DOMParser — the
// jsdom environment.
import { describe, expect, it } from "vitest";

import type { TextRun } from "docblocks-core";

import { htmlToBlocks, rawTextOfHtml } from "../src/editing/clipboard";
import type { MaterializedBlock } from "../src/editing/clipboard/models";

/** The [type, indent, attrs, runs] view of a block list (the assertion shorthand). */
function viewOf(blocks: MaterializedBlock[]): Array<[string, number, Record<string, unknown>, string[]]> {
  return blocks.map((b) => [b.type, b.indent, b.attrs, b.runs.map((run) => `${run.text}${run.marks.bold ? "b" : ""}`)]);
}

/** The [text, marks] pairs of a run list. */
function runsOf(runs: TextRun[]): Array<[string, TextRun["marks"]]> {
  return runs.map((run) => [run.text, run.marks]);
}

describe("the block structure → the paste blocks", () => {
  it("h1–h6 → the heading with its level", () => {
    for (let level = 1; level <= 6; level += 1) {
      const blocks = htmlToBlocks(`<h${level}>Title</h${level}>`);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.type).toBe("heading");
      expect(blocks[0]!.attrs.level).toBe(level);
      expect(blocks[0]!.runs.map((r) => r.text)).toEqual(["Title"]);
    }
  });

  it("p → paragraphs (one per element)", () => {
    const blocks = htmlToBlocks("<p>a</p><p>b</p>");
    expect(viewOf(blocks)).toEqual([
      ["paragraph", 0, {}, ["a"]],
      ["paragraph", 0, {}, ["b"]],
    ]);
  });

  it("the unknown blocks (div/section) stand the paragraph", () => {
    const blocks = htmlToBlocks("<div>d1</div><section>s1</section>");
    expect(viewOf(blocks)).toEqual([
      ["paragraph", 0, {}, ["d1"]],
      ["paragraph", 0, {}, ["s1"]],
    ]);
  });

  it("the top-level inline content and the bare text stand the paragraph", () => {
    const blocks = htmlToBlocks("lead <b>bold</b> tail");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("paragraph");
    expect(runsOf(blocks[0]!.runs)).toEqual([
      ["lead ", {}],
      ["bold", { bold: true }],
      [" tail", {}],
    ]);
  });

  it("br is the soft line break (the \\n in the run text)", () => {
    const blocks = htmlToBlocks("<p>one<br>two<br/>three</p>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.runs.map((r) => r.text)).toEqual(["one\ntwo\nthree"]);
  });

  it("the inline whitelist maps to the marks (the nesting composes)", () => {
    const blocks = htmlToBlocks("<p>a <b>ab <i>abi</i></b> c <u>u</u> <s>st</s> <code>cd</code></p>");
    expect(blocks).toHaveLength(1);
    expect(runsOf(blocks[0]!.runs)).toEqual([
      ["a ", {}],
      ["ab ", { bold: true }],
      ["abi", { bold: true, italic: true }],
      [" c ", {}],
      ["u", { underline: true }],
      [" ", {}],
      ["st", { strike: true }],
      [" ", {}],
      ["cd", { code: true }],
    ] as Array<[string, TextRun["marks"]]>);
  });

  it("code is exclusive (the subtree carries no other marks)", () => {
    const blocks = htmlToBlocks("<p><b><code>x</code> y</b></p>");
    expect(runsOf(blocks[0]!.runs)).toEqual([
      ["x", { code: true }],
      [" y", { bold: true }],
    ]);
  });

  it("the a[href] survives only the http/https/mailto and the fragment", () => {
    const blocks = htmlToBlocks(
      '<p><a href="https://e.com">ok</a> <a href="javascript:alert(1)">js</a> <a href="/rel">rel</a></p>'
    );
    expect(runsOf(blocks[0]!.runs)).toEqual([
      ["ok", { link: { href: "https://e.com" } }],
      // The rejected links keep their text; the plain runs merge.
      [" js rel", {}],
    ]);
  });

  it("the span's color and highlight stand the marks", () => {
    const blocks = htmlToBlocks(
      '<p><span style="color: rgb(255, 0, 0); border: none">c</span><span style="background-color: yellow">h</span></p>'
    );
    expect(runsOf(blocks[0]!.runs)).toEqual([
      ["c", { color: { value: "rgb(255, 0, 0)" } }],
      ["h", { highlight: { value: "yellow" } }],
    ]);
  });

  it("ul/ol → the list items; the nesting → the deeper indent", () => {
    const blocks = htmlToBlocks("<ul><li>a</li><li>b<ul><li>b1</li></ul></li></ul><ol><li>n1</li></ol>");
    expect(viewOf(blocks)).toEqual([
      ["list-item", 0, { list: "bullet" }, ["a"]],
      ["list-item", 0, { list: "bullet" }, ["b"]],
      ["list-item", 1, { list: "bullet" }, ["b1"]],
      ["list-item", 0, { list: "number" }, ["n1"]],
    ]);
  });

  it("pre → the code block with the raw text (no marks, the lines stand)", () => {
    const blocks = htmlToBlocks("<pre>let a = 1;\n<b>not bold</b>\n  indented</pre>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("code");
    expect(blocks[0]!.runs.map((r) => r.text).join("")).toBe("let a = 1;\nnot bold\n  indented");
    expect(blocks[0]!.runs.every((r) => Object.keys(r.marks).length === 0)).toBe(true);
  });

  it("blockquote → the quote; the nesting → the deeper indent", () => {
    const blocks = htmlToBlocks("<blockquote>q1<blockquote>q2</blockquote></blockquote>");
    expect(viewOf(blocks)).toEqual([
      ["quote", 0, {}, ["q1"]],
      ["quote", 1, {}, ["q2"]],
    ]);
  });

  it("the blockquote's block children stand the quotes (the browser wraps the content in p's)", () => {
    const blocks = htmlToBlocks("<blockquote><p>q1</p><p>q2</p></blockquote>");
    expect(viewOf(blocks)).toEqual([
      ["quote", 0, {}, ["q1"]],
      ["quote", 0, {}, ["q2"]],
    ]);
  });

  it("hr → the divider", () => {
    const blocks = htmlToBlocks("<p>a</p><hr><p>b</p>");
    expect(viewOf(blocks)).toEqual([
      ["paragraph", 0, {}, ["a"]],
      ["divider", 0, {}, []],
      ["paragraph", 0, {}, ["b"]],
    ]);
  });

  it("the table → the table material (the cells' runs; the ragged rows are padded)", () => {
    const blocks = htmlToBlocks("<table><tr><td>c11 <b>c12b</b></td><td>c12</td></tr><tr><td>c21</td></tr></table>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("table");
    expect(blocks[0]!.rows).toHaveLength(2);
    expect(blocks[0]!.rows![0]!.length).toBe(2);
    expect(blocks[0]!.rows![1]!.length).toBe(2); // padded
    expect(runsOf(blocks[0]!.rows![0]![0]!)).toEqual([
      ["c11 ", {}],
      ["c12b", { bold: true }],
    ]);
    expect(blocks[0]!.rows![1]![1]).toEqual([]); // the padded cell is empty
  });
});

describe("the lenient edges", () => {
  it("the script/style/img content is excluded", () => {
    const blocks = htmlToBlocks(
      '<p>before</p><script>var x = 1;</script><style>.a {}</style><img src="x.png"><p>after</p>'
    );
    expect(viewOf(blocks)).toEqual([
      ["paragraph", 0, {}, ["before"]],
      ["paragraph", 0, {}, ["after"]],
    ]);
  });

  it("the line-break anchor never contributes content", () => {
    const blocks = htmlToBlocks('<p>a</p><span data-slot="docblocks/line-anchor"></span><p>b</p>');
    expect(viewOf(blocks)).toEqual([
      ["paragraph", 0, {}, ["a"]],
      ["paragraph", 0, {}, ["b"]],
    ]);
  });

  it("the block edge whitespace keeps the collapse semantics (the word boundaries stand; the whitespace-only block is dropped)", () => {
    const blocks = htmlToBlocks("<p>   padded   </p>");
    expect(blocks).toHaveLength(1);
    // The inline whitespace collapses (the browser's white-space: normal):
    // the word-boundary spaces stand, the run edges are not trimmed.
    expect(blocks[0]!.runs.map((r) => r.text)).toEqual([" padded "]);
    expect(htmlToBlocks("<p>   </p>")).toEqual([]);
  });

  it("the empty payload and the whitespace-only payload yield no blocks", () => {
    expect(htmlToBlocks("")).toEqual([]);
    expect(htmlToBlocks("<div>   </div><p> </p>")).toEqual([]);
  });

  it("the trailing empty paragraph is not materialized", () => {
    const blocks = htmlToBlocks("<p>a</p><p></p>");
    expect(viewOf(blocks)).toEqual([["paragraph", 0, {}, ["a"]]]);
  });

  it("the mixed structure keeps the document order (h2 + p + the list)", () => {
    const blocks = htmlToBlocks("<h2>Head</h2><p>body</p><ul><li>i1</li></ul>");
    expect(viewOf(blocks)).toEqual([
      ["heading", 0, { level: 2 }, ["Head"]],
      ["paragraph", 0, {}, ["body"]],
      ["list-item", 0, { list: "bullet" }, ["i1"]],
    ]);
  });

  it("the malformed list (the list as the list's own child) stands at the same level", () => {
    const blocks = htmlToBlocks("<ul><li>a</li><ul><li>b</li></ul></ul>");
    expect(viewOf(blocks)).toEqual([
      ["list-item", 0, { list: "bullet" }, ["a"]],
      ["list-item", 0, { list: "bullet" }, ["b"]],
    ]);
  });
});

describe("the raw text (the code target)", () => {
  it("the block units stand their own lines (the inline units run together)", () => {
    expect(rawTextOfHtml("<p>a</p><pre>b</pre>")).toBe("a\nb");
    expect(rawTextOfHtml("<div>l1</div><div>l2</div>")).toBe("l1\nl2");
    expect(rawTextOfHtml("lead <b>x</b><p>y</p>")).toBe("lead x\ny");
  });

  it("the wrapper's nested blocks take the newlines (the line structure stands)", () => {
    expect(rawTextOfHtml("<div><p>a</p><p>b</p></div>")).toBe("a\nb");
    expect(rawTextOfHtml("<div><ul><li>x</li><li>y</li></ul></div>")).toBe("x\ny");
  });

  it("the br is the newline (the pre's lines stand)", () => {
    expect(rawTextOfHtml("<pre>l1<br>l2</pre>")).toBe("l1\nl2");
  });
});
