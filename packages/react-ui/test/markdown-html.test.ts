// The inline HTML tag pass of the markdown paste parser (the `text/plain`
// branch): the inline tags → the v1 marks, the structural tag lines
// staying literal, the nesting and the unclosed tags, and the html mixed
// with the markdown. Pure function, no DOM — the node environment.
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

describe("the inline tags → the v1 marks", () => {
  it("<b> → bold", () => {
    const block = single("Привет <b>мир</b>!");
    expect(block.type).toBe("paragraph");
    expect(runsOf(block.runs)).toEqual([
      ["Привет ", {}],
      ["мир", { bold: true }],
      ["!", {}],
    ]);
  });

  it("<strong>/<i>/<em>/<u>/<s>/<strike>/<del> → the corresponding marks", () => {
    expect(runsOf(single("<strong>сильный</strong>").runs)).toEqual([["сильный", { bold: true }]]);
    expect(runsOf(single("<i>курсив</i>").runs)).toEqual([["курсив", { italic: true }]]);
    expect(runsOf(single("<em>ещё курсив</em>").runs)).toEqual([["ещё курсив", { italic: true }]]);
    expect(runsOf(single("<u>подчёркнутый</u>").runs)).toEqual([["подчёркнутый", { underline: true }]]);
    expect(runsOf(single("<s>перечёркнутый</s>").runs)).toEqual([["перечёркнутый", { strike: true }]]);
    expect(runsOf(single("<strike>тоже</strike>").runs)).toEqual([["тоже", { strike: true }]]);
    expect(runsOf(single("<del>и ещё</del>").runs)).toEqual([["и ещё", { strike: true }]]);
  });

  it("<a href> → the link mark", () => {
    const block = single('<a href="https://example.com">ссылка</a>');
    expect(runsOf(block.runs)).toEqual([["ссылка", { link: { href: "https://example.com" } }]]);
  });

  it("<code> → the code mark", () => {
    expect(runsOf(single("<code>код</code>").runs)).toEqual([["код", { code: true }]]);
  });

  it("<mark> → the highlight mark with the standard yellow", () => {
    expect(runsOf(single("<mark>выделенный</mark>").runs)).toEqual([
      ["выделенный", { highlight: { value: "#ffff00" } }],
    ]);
  });

  it("the tag name and the attrs are case-insensitive", () => {
    expect(runsOf(single("<B>верхний</B>").runs)).toEqual([["верхний", { bold: true }]]);
    expect(runsOf(single('<b class="x" style="color: red">текст</b>').runs)).toEqual([["текст", { bold: true }]]);
    expect(runsOf(single('<A HREF="X">текст</A>').runs)).toEqual([["текст", { link: { href: "X" } }]]);
  });

  it("<br> / <br/> / <br /> → the soft line break", () => {
    expect(textOf(single("Привет, <br>мир").runs)).toBe("Привет, \nмир");
    expect(textOf(single("Привет, <br/>мир").runs)).toBe("Привет, \nмир");
    expect(textOf(single("Привет, <br />мир").runs)).toBe("Привет, \nмир");
  });

  it("a line opening with <p> keeps the tags literal", () => {
    const block = single("<p>текст</p>");
    expect(block.type).toBe("paragraph");
    expect(textOf(block.runs)).toBe("<p>текст</p>");
  });

  it("unknown tags and wrappers drop with the content kept plain", () => {
    expect(runsOf(single('<div style="font-size: 24px">текст</div>').runs)).toEqual([["текст", {}]]);
    expect(runsOf(single('<span style="color: red">красный</span>').runs)).toEqual([["красный", {}]]);
    expect(runsOf(single("<unknown>текст</unknown>").runs)).toEqual([["текст", {}]]);
  });

  it("sub/sup drop with the content kept plain (the v1 has no such marks)", () => {
    expect(textOf(single("<sub>под</sub> и <sup>над</sup>").runs)).toBe("под и над");
  });

  it("the bare angle brackets stay literal", () => {
    expect(textOf(single("5 < 6 и 7 > 3").runs)).toBe("5 < 6 и 7 > 3");
    expect(textOf(single("a < b").runs)).toBe("a < b");
  });

  it("entities decode once; the decoded text never re-enters the tag scan", () => {
    const block = single("&lt;br&gt; и &amp;lt;br&amp;gt;");
    // The first decodes to the literal text `<br>` (no break), the second to
    // the text `&lt;br&gt;` (the single pass never decodes twice).
    expect(textOf(block.runs)).toBe("<br> и &lt;br&gt;");
  });
});

describe("the structural tag lines stay literal", () => {
  it.each([
    "<h1>Заголовок 1</h1> … отдельно <h6>Заголовок 6</h6>",
    "<p>Первый абзац</p><p>Второй абзац</p>",
    "<ul><li>пункт 1</li><li>пункт 2</li></ul>",
    "<ol><li>один</li><li>два</li></ol>",
    "<ul><li>вложенный<ul><li>глубже</li></ul></li><li>после</li></ul>",
    "<blockquote>цитата</blockquote>",
    "<table><tr><td>a</td><td>b</td></tr></table> (таблица; тоже — проверить отдельно)",
    "<hr> / <hr/> (разделитель)",
    '<p style="text-align: center">по центру</p> (стили блоков: выравнивание, цвет фона?)',
  ])("keeps the line literal: %s", (line) => {
    const block = single(line);
    expect(block.type).toBe("paragraph");
    expect(textOf(block.runs)).toBe(line);
  });

  it("a multi-line <pre> chunk: the first line literal, the indented continuation is code", () => {
    const blocks = mdToBlocks("<pre>строка 1\n    строка 2 с отступами</pre> (код-блок; сохраняется ли отступ)");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "code"]);
    expect(textOf(blocks[0]!.runs)).toBe("<pre>строка 1");
    expect(textOf(blocks[1]!.runs)).toBe("строка 2 с отступами</pre> (код-блок; сохраняется ли отступ)");
  });

  it("<img> drops with the following text kept", () => {
    const block = single('<img src="https://www.example.com/x.png"> (картинка — подгрузится? alt?)');
    expect(block.type).toBe("paragraph");
    expect(textOf(block.runs).trim()).toBe("(картинка — подгрузится? alt?)");
  });

  it("div/section wrappers drop, the text stays", () => {
    const block = single("<div>текст в div</div> и <section>текст в section</section> (обёртки)");
    expect(textOf(block.runs)).toBe("текст в div и текст в section (обёртки)");
    expect(textOf(single("<span>просто span без стилей</span>").runs)).toBe("просто span без стилей");
  });
});

describe("the nesting and the unclosed tags", () => {
  it("a structural line stays literal even with inline tags inside", () => {
    const lines = [
      "<p>текст с <b>жирным</b> и <code>кодом</code></p>",
      "<ul><li>пункт с <b>жирным</b></li></ul> (inline внутри пункта)",
      "<h2>Заголовок с <b>жирным</b></h2>",
      "<pre>код с <b>тегом</b> внутри</pre> (тег внутри pre — парсится или литерал?)",
    ];
    for (const line of lines) {
      const block = single(line);
      expect(block.type).toBe("paragraph");
      expect(textOf(block.runs)).toBe(line);
    }
  });

  it("the unclosed open tag drops; no mark, the content stays plain", () => {
    const block = single("<b>незакрытый жирный до конца (незакрытый тег — жирный до конца текста/страницы?)");
    expect(runsOf(block.runs)).toEqual([
      ["незакрытый жирный до конца (незакрытый тег — жирный до конца текста/страницы?)", {}],
    ]);
  });

  it("a line opening with <li> stays literal", () => {
    const block = single("<li>незакрытый пункт</li><li>и ещё (незакрытые списки)");
    expect(textOf(block.runs)).toBe("<li>незакрытый пункт</li><li>и ещё (незакрытые списки)");
  });

  it("the nested tags compose the marks", () => {
    const block = single("<b><i>жирный+курсив вложенные</i></b>");
    expect(runsOf(block.runs)).toEqual([["жирный+курсив вложенные", { bold: true, italic: true }]]);
  });
  it("the mismatched pair drops both tags, the content stays plain", () => {
    expect(runsOf(single("<b>текст</i>").runs)).toEqual([["текст", {}]]);
  });
});

describe("the html mixed with the markdown", () => {
  it("the md heading and the inline tags resolve together", () => {
    const block = single("# Заголовок с <b>жирным</b> (md-заголовок + html inline)");
    expect(block.type).toBe("heading");
    expect(block.attrs.level).toBe(1);
    expect(runsOf(block.runs)).toEqual([
      ["Заголовок с ", {}],
      ["жирным", { bold: true }],
      [" (md-заголовок + html inline)", {}],
    ]);
  });

  it("<br> inside a md list item is the soft break", () => {
    const block = single("- пункт с <br> внутри (md-список + br)");
    expect(block.type).toBe("list-item");
    expect(textOf(block.runs)).toBe("пункт с \n внутри (md-список + br)");
  });

  it("the md emphasis and the html tags on one line both become marks", () => {
    const block = single("**жирный md** и <b>жирный html</b> в одной строке");
    expect(runsOf(block.runs)).toEqual([
      ["жирный md", { bold: true }],
      [" и ", {}],
      ["жирный html", { bold: true }],
      [" в одной строке", {}],
    ]);
  });

  it("a line opening with <p>/<ul> stays literal, the inner md does not apply", () => {
    expect(
      textOf(single("<p># это заголовок или markdown-заголовок?</p> (md внутри html-блока — парсится md?)").runs)
    ).toBe("<p># это заголовок или markdown-заголовок?</p> (md внутри html-блока — парсится md?)");
    expect(textOf(single("<ul><li># хеш не заголовок, а пункт?</li></ul>").runs)).toBe(
      "<ul><li># хеш не заголовок, а пункт?</li></ul>"
    );
  });

  it("the md table cells parse the inline tags", () => {
    const block = single("| a | b |\n| --- | --- |\n| <b>жирная ячейка</b> | <code>код</code> |");
    expect(block.type).toBe("table");
    expect(block.rows![1]![0]![0]!).toEqual({ text: "жирная ячейка", marks: { bold: true } });
    expect(block.rows![1]![1]![0]!).toEqual({ text: "код", marks: { code: true } });
  });

  it("<br> before a md list: the break line + the real bullet list", () => {
    const blocks = mdToBlocks("<br> перед markdown-списком:\n- пункт 1\n- пункт 2");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "list-item", "list-item"]);
    expect(blocks[0]!.runs[0]!.text).toBe("\n перед markdown-списком:");
    expect(blocks[1]!.attrs).toMatchObject({ list: "bullet" });
  });
});
