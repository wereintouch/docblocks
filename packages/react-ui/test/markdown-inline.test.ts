// The markdown paste parser (the `text/plain` paste branch): the inline
// pass — the `$$`/`$` math syntax's literal-text degrade and the inline
// marks (the bold/italic, the strike, the nesting, the code span, the
// links over the safe href's contract, the escapes, the lenient
// fallbacks). Pure function, no DOM — the node environment.
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

describe("mdToBlocks — the `$$`/`$` math syntax (the literal-text degrade)", () => {
  it("the single-line $$ degrades to the literal paragraph text", () => {
    const block = single("$$ x^2 $$");
    expect(block.type).toBe("paragraph");
    expect(block.runs).toEqual([{ text: "$$ x^2 $$", marks: {} }]);
  });

  it("the multi-line $$ degrades to the literal paragraph lines", () => {
    const blocks = mdToBlocks("$$\na = b\nc = d\n$$");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph"]);
    expect(textOf(blocks[0]!.runs)).toBe("$$ a = b c = d $$");
  });

  it("the empty $$ degrades to the literal paragraph text", () => {
    const blocks = mdToBlocks("$$\n$$");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph"]);
    expect(textOf(blocks[0]!.runs)).toBe("$$ $$");
  });

  it("the inline $ stays literal (no math mark)", () => {
    const block = single("before $x^2$ after");
    expect(block.type).toBe("paragraph");
    expect(block.runs).toEqual([{ text: "before $x^2$ after", marks: {} }]);
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

  it("the autolink <https://…> stands the link; the <mailto:…> degrades to the literal (the data model's link contract)", () => {
    const block = single("<https://x.com> and <mailto:a@b.c>");
    const linkRuns = block.runs.filter((r) => r.marks.link !== undefined);
    expect(linkRuns.map((r) => r.marks.link)).toEqual([{ href: "https://x.com" }]);
    // The mailto's degrade: the text keeps the literal (the core's
    // InvalidMarkError would abort the paste over the mark).
    expect(textOf(block.runs)).toBe("https://x.com and <mailto:a@b.c>");
  });

  it("the link's href over the other scheme (the javascript) degrades to the literal; the mailto stands the mark (the data model's link contract)", () => {
    const block = single("[a](mailto:a@b.c) and [b](javascript:alert(1))");
    const linkRuns = block.runs.filter((r) => r.marks.link !== undefined);
    expect(linkRuns.map((r) => [textOf([r]), r.marks.link])).toEqual([["a", { href: "mailto:a@b.c" }]]);
    expect(textOf(block.runs)).toBe("a and [b](javascript:alert(1))");
  });

  it("the inline <a> tag's href stands the link contract (the safe href's mark, the unsafe's degrade)", () => {
    // The safe href stands the mark (the tag drops, the content keeps it).
    const safe = single('visit <a href="https://x.com">site</a> now');
    const safeLink = safe.runs.filter((r) => r.marks.link !== undefined);
    expect(safeLink.map((r) => [textOf([r]), r.marks.link])).toEqual([["site", { href: "https://x.com" }]]);
    expect(textOf(safe.runs)).toBe("visit site now");
    // The unsafe scheme stands the degrade (the content stays plain — the
    // mark would abort the paste over the core's strict rejection).
    const unsafe = single('mail <a href="javascript:alert(1)">me</a> now');
    expect(unsafe.runs.filter((r) => r.marks.link !== undefined)).toEqual([]);
    expect(textOf(unsafe.runs)).toBe("mail me now");
    // The mailto's href stands the safe's contract (the mark's stand).
    const mailto = single('mail <a href="mailto:a@b.c">me</a> now');
    expect(mailto.runs.filter((r) => r.marks.link !== undefined).map((r) => r.marks.link)).toEqual([
      { href: "mailto:a@b.c" },
    ]);
    expect(textOf(mailto.runs)).toBe("mail me now");
  });

  it("the href's entity decode re-stands the link contract (the exposed scheme degrades the run)", () => {
    // The raw stand does not see the scheme (the entity hides it); the
    // decoded value exposes it — the re-gate over the decode's run pass
    // degrades the run to plain text instead of the core's paste abort
    // (the link syntax cuts at the first `)`: the trailing one stays the
    // literal's residue).
    const block = single("[x](jav&#x61;script:alert(1))");
    expect(block.runs.filter((r) => r.marks.link !== undefined)).toEqual([]);
    expect(textOf(block.runs)).toBe("x)");
  });

  it("the href's leading C0 control stands the writer's trimmed stand (the core's mirror, the degrade)", () => {
    // The browser trims the leading C0 controls before the scheme's
    // detection — the core's contract checks the trimmed form. The
    // parser's mirror stands the identical gate (the pass-through over
    // the core's isSafeLinkHref): a quoted href with the entity-hidden
    // leading tab decodes to the scheme's form and degrades the run
    // (the strict writer would otherwise reject the run and abort the
    // whole multi-block paste over it).
    const block = single('mail <a href="&#9;javascript:alert(1)">me</a> now');
    expect(block.runs.filter((r) => r.marks.link !== undefined)).toEqual([]);
    expect(textOf(block.runs)).toBe("mail me now");
    // The literal (non-entity) stand: the quoted href with the literal
    // leading space.
    const block2 = single('mail <a href=" javascript:alert(1)">me</a> now');
    expect(block2.runs.filter((r) => r.marks.link !== undefined)).toEqual([]);
    expect(textOf(block2.runs)).toBe("mail me now");
  });

  it("the href's mid-string control stands the writer's normalized stand (the core's mirror, the degrade)", () => {
    // The WHATWG URL parser removes ASCII tab / LF / CR from ANY position
    // before the scheme's detection — the core's gate mirrors the full
    // normalization, so a mid-string control cannot hide the scheme
    // ("java\tscript:…" resolves as "javascript:…" in the browser). The
    // mirror stands the degrade over the pass-through.
    const block = single('mail <a href="java\tscript:alert(1)">me</a> now');
    expect(block.runs.filter((r) => r.marks.link !== undefined)).toEqual([]);
    expect(textOf(block.runs)).toBe("mail me now");
    // The entity-hidden stand: the raw parse does not see the control (the
    // entity hides it); the decoded value exposes the scheme — the re-gate
    // over the decode's run pass degrades the run (the link syntax cuts at
    // the first `)`).
    const block2 = single("[x](java&#9;script:alert(1))");
    expect(block2.runs.filter((r) => r.marks.link !== undefined)).toEqual([]);
    expect(textOf(block2.runs)).toBe("x)");
  });

  it("the backslash escape keeps the punctuation literal", () => {
    const block = single("\\*star\\* and \\#hash");
    expect(textOf(block.runs)).toBe("*star* and #hash");
  });
});
