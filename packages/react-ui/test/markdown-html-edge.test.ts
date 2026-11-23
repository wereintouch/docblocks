// The edge cases of the inline HTML tag pass (the `text/plain` branch):
// attrs, entities, the bare angle brackets. Pure function, no DOM — the
// node environment.
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

/** The [text, marks] pairs of a run list (the assertion shorthand). */
function runsOf(runs: TextRun[]): Array<[string, TextRun["marks"]]> {
  return runs.map((run) => [run.text, run.marks]);
}

describe("the edge cases", () => {
  it("entities: the common named, the decimal and the hex numeric, the unknown stays literal", () => {
    expect(textOf(single("a &amp; b").runs)).toBe("a & b");
    expect(textOf(single("&#72;&#105;").runs)).toBe("Hi");
    expect(textOf(single("&#x41;").runs)).toBe("A");
    expect(textOf(single("&mdash; и &hellip;").runs)).toBe("— и …");
    expect(textOf(single("&unknown; текст").runs)).toBe("&unknown; текст");
  });

  it("the entity decodes once: &amp;lt; is the text &lt; (not a <, not a tag)", () => {
    expect(textOf(single("&amp;lt;").runs)).toBe("&lt;");
  });

  it("the href attrs: the single quotes, the unquoted value, the entities in the href (the single decode pass)", () => {
    expect(runsOf(single("<a href='x'>текст</a>").runs)).toEqual([["текст", { link: { href: "x" } }]]);
    expect(runsOf(single("<a href=bare>текст</a>").runs)).toEqual([["текст", { link: { href: "bare" } }]]);
    expect(runsOf(single('<a href="a?x=1&amp;y=2">т</a>').runs)).toEqual([["т", { link: { href: "a?x=1&y=2" } }]]);
    // the entity decodes ONCE in the href too (no double decode): &amp;lt; is the text &lt;
    expect(runsOf(single('<a href="&amp;lt;">т</a>').runs)).toEqual([["т", { link: { href: "&lt;" } }]]);
  });

  it("<a> without a valid href drops the tag, the content stays plain", () => {
    expect(runsOf(single("<a>без хрефа</a>").runs)).toEqual([["без хрефа", {}]]);
    expect(runsOf(single('<a href="">пустой</a>').runs)).toEqual([["пустой", {}]]);
  });

  it("the consecutive and the nested spans", () => {
    // The adjacent same-mark spans merge into one run (the run merge contract).
    expect(runsOf(single("<b>текст</b><b>ещё</b>").runs)).toEqual([["текстещё", { bold: true }]]);
    expect(runsOf(single("<b>в <i>курсиве</i> и <u>подчёрк</u></b>").runs)).toEqual([
      ["в ", { bold: true }],
      ["курсиве", { bold: true, italic: true }],
      [" и ", { bold: true }],
      ["подчёрк", { bold: true, underline: true }],
    ]);
  });

  it("a wrapper with a nested known tag: the wrapper drops, the inner mark stands", () => {
    expect(runsOf(single("<div><b>вложенный</b></div>").runs)).toEqual([["вложенный", { bold: true }]]);
  });

  it("the stray closing tag drops (no literal </b>)", () => {
    expect(textOf(single("<b>пара</b> и </b> висячий").runs)).toBe("пара и  висячий");
  });

  it("the tags inside the inline code span stay literal", () => {
    expect(runsOf(single("`<b>` и <b>жирный</b>").runs)).toEqual([
      ["<b>", { code: true }],
      [" и ", {}],
      ["жирный", { bold: true }],
    ]);
  });

  it("the autolink and the tag on one line", () => {
    expect(runsOf(single("ссылка <https://a.b> и <b>жирный</b>").runs)).toEqual([
      ["ссылка ", {}],
      ["https://a.b", { link: { href: "https://a.b" } }],
      [" и ", {}],
      ["жирный", { bold: true }],
    ]);
  });

  it("the md emphasis inside a tag span", () => {
    expect(runsOf(single("**<b>x</b>**").runs)).toEqual([["x", { bold: true }]]);
  });

  it("the code span is exclusive (the raw content, no composed marks)", () => {
    expect(runsOf(single("<b><code>x</code></b>").runs)).toEqual([["x", { code: true }]]);
    expect(runsOf(single("<code><b>x</b></code>").runs)).toEqual([["<b>x</b>", { code: true }]]);
    expect(runsOf(single("<code>**x**</code>").runs)).toEqual([["**x**", { code: true }]]);
    expect(runsOf(single("<code><https://a.b></code>").runs)).toEqual([["<https://a.b>", { code: true }]]);
  });

  it("the entities decode in the code block and the literal text too", () => {
    const code = single("```\n&amp;lt;\n```");
    expect(textOf(code.runs)).toBe("&lt;");
    expect(textOf(single("a $x &amp; y$ b").runs)).toBe("a $x & y$ b");
  });
});
