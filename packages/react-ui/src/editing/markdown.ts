import type { MarkSet, TextRun } from "docblocks-core";

/**
 * The markdown paste parser (the `text/plain` paste branch): decomposes a
 * pasted markdown document or fragment into the v1 block set — headings,
 * paragraphs, lists (bullet/number/task, nesting via the flat `indent`
 * depth), quotes, fenced/indented code, dividers, GFM tables, standalone
 * images, and `$$` math — with the inline marks (bold, italic, strike,
 * code, link, math).
 *
 * The input is a pragmatic subset of CommonMark + GFM: block boundaries
 * are line-based (fences, the setext-vs-thematic `---` discriminator, the
 * 2–4-space list/quote depth, the GFM table shape), and the inline pass
 * resolves the standard emphasis/strike/code/link/math delimiters with
 * nesting and backslash escapes.
 *
 * Inline HTML tags share the same inline pass (a line resolves markdown
 * delimiters and `<tag>` at once): the standard inline tags map to the v1
 * marks (`b`/`strong`, `i`/`em`, `u`, `s`/`strike`/`del`, `code`, `mark`,
 * `a[href]`), `<br>` is the soft line break, and a line that OPENS with a
 * structural tag (`h1`–`h6`, `p`, `ul`, `ol`, `li`, `blockquote`, `pre`,
 * `table`, `hr`) keeps the tags as literal text (no structure). The `code`
 * span is exclusive (its content is raw and carries no other mark, the
 * backtick span's contract). Any other tag (unknown, wrappers, `img`,
 * `sub`/`sup`, unclosed) is dropped with its content kept plain; `style`
 * and the other attributes are ignored.
 * HTML entities are decoded once, AFTER the tag scan, so the decoded
 * `<`/`>` never re-enters the tag parsing.
 * Everything else the v1 registry cannot express (raw HTML blocks, reference-style links, the inline image in
 * the middle of a line, unbalanced delimiters) degrades to literal text —
 * the paste never fails on valid markdown.
 *
 * Line-join nuance: the paragraph soft break is a space (the CommonMark
 * rendering), while the multi-line quote and the list-item continuation
 * keep the source line structure (the `\n` soft-break join — the GitHub
 * rendering), and the indented line right after a list item joins the
 * item's text even at the 4-space indent (the code-inside-item case
 * flattens to the item text — the data is preserved).
 */

/** The v1 block type a parsed block materializes. */
type MdBlockType = "paragraph" | "heading" | "quote" | "list-item" | "code" | "latex" | "divider" | "image" | "table";

/** A parsed paste block: the v1 type, the nesting depth, the attrs, and the text. */
interface MdPasteBlock {
  type: MdBlockType;
  /** The list/quote nesting depth (0 for the other types). */
  indent: number;
  /** The block attrs (heading `level`, the list `list` kind, `checked`, the code `language`, the image `src`). */
  attrs: Record<string, unknown>;
  /** The text content (empty for divider/image/table). */
  runs: TextRun[];
  /** The table cells (rows → cells → runs); the table type only. */
  rows?: TextRun[][][];
}

const IMAGE_LINE = /^ {0,3}!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)$/;

/** The highlight color of a parsed `<mark>` (the standard HTML `mark` yellow). */
const MARK_HIGHLIGHT = "#ffff00";

/**
 * A line that opens with a structural tag (the lenient paste posture: the
 * tags stay literal text, no structure is born — `h1`–`h6`, `p`, `ul`,
 * `ol`, `li`, `blockquote`, `pre`, `table`, `hr`).
 */
const STRUCTURAL_TAG_LINE = /^<\/?(?:h[1-6]|p|ul|ol|li|blockquote|pre|table|hr)(?=[\s>/])/i;

/** An open inline tag: the name, the raw attrs, the optional self-closing slash. */
const OPEN_TAG = /^<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[\w-]+(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'<>]+))?)*)\s*(\/?)>/;

/** A closing tag (dropped at the level where no opener pairs with it). */
const STRAY_CLOSE_TAG = /^<\/[a-zA-Z][a-zA-Z0-9-]*\s*\/?\s*>/;

/** The `href` attribute value (any quoting, case-insensitive). */
const TAG_HREF = /\bhref\s*=\s*("[^"]*"|'[^']*'|[^\s"'<>]+)/i;

/** The named entities the paste decodes (the pragmatic common set). */
const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "\u0027",
  nbsp: "\u00a0",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  laquo: "\u00ab",
  raquo: "\u00bb",
  middot: "\u00b7",
  bull: "\u2022",
  deg: "\u00b0",
  plusmn: "\u00b1",
  times: "\u00d7",
  divide: "\u00f7",
  euro: "\u20ac",
  pound: "\u00a3",
  cent: "\u00a2",
  yen: "\u00a5",
  szlig: "\u00df",
  sect: "\u00a7",
  para: "\u00b6",
  permil: "\u2030",
  frac12: "\u00bd",
  sup1: "\u00b9",
  sup2: "\u00b2",
  sup3: "\u00b3",
  larr: "\u2190",
  rarr: "\u2192",
  uarr: "\u2191",
  darr: "\u2193",
};

const ENTITY = /&#x([0-9a-f]+);|&#(\d+);|&([a-z][a-z0-9]*);/gi;

/**
 * One decode pass (the lenient posture): numeric and the known named
 * entities decode, the unknown named stays literal. A left-to-right single
 * pass never re-scans a decoded replacement, so `&amp;lt;` decodes to the
 * text `&lt;` (not a further `<`).
 */
function decodeEntities(value: string): string {
  return value.replace(ENTITY, (match, hex, dec, named) => {
    if (hex !== undefined) {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (dec !== undefined) {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[named ?? ""] ?? match;
  });
}

/** The open tag at `i` of `text` (the name lower-cased; `null` for a bare `<`). */
function inlineTagAt(
  text: string,
  i: number
): { name: string; attrs: string; selfClosing: boolean; end: number } | null {
  const m = OPEN_TAG.exec(text.slice(i));
  if (m === null) return null;
  return { name: m[1]!.toLowerCase(), attrs: m[2] ?? "", selfClosing: m[3] === "/", end: i + m[0]!.length };
}

/** The v1 mark an open tag maps to (`null` = the tag drops, content stays plain). */
function inlineTagMarks(tag: { name: string; attrs: string }): MarkSet | null {
  switch (tag.name) {
    case "b":
    case "strong":
      return { bold: true };
    case "i":
    case "em":
      return { italic: true };
    case "u":
      return { underline: true };
    case "s":
    case "strike":
    case "del":
      return { strike: true };
    case "code":
      return { code: true };
    case "mark":
      return { highlight: { value: MARK_HIGHLIGHT } };
    case "a": {
      const m = TAG_HREF.exec(tag.attrs);
      if (m === null) return null;
      let href = m[1]!;
      if (href.startsWith('"') || href.startsWith("'")) href = href.slice(1, -1);
      // The entities decode once, at the run-level pass (the single-pass rule).
      return href !== "" ? { link: { href } } : null;
    }
    default:
      return null;
  }
}

/** Whether a line is a GFM table separator row (`| --- | :---: |` shapes). */
function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("-")) return false;
  const body = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return body.split("|").every((cell) => /^:?-+:?$/.test(cell.trim()));
}

/** The cells of a table row (unescaped pipes only; the edge pipes are dropped). */
function tableCellsOf(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  return body.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

/** The emphasis/strike/caret-safe mark equality (the run merge). */
function marksEqual(a: MarkSet, b: MarkSet): boolean {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return (keysA as (keyof MarkSet)[]).every((key) => key in b && JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

/**
 * The inline pass: the emphasis/strike/code/link/math delimiters with
 * nesting and backslash escapes. Emphasis openers require a non-word
 * boundary only for `_`/`__` (the snake_case identifiers stay literal);
 * the `code` and `math` spans are exclusive (their content carries no
 * other marks). Unmatched delimiters stay literal.
 */
function parseInline(source: string): TextRun[] {
  const runs: TextRun[] = [];

  const push = (text: string, marks: MarkSet): void => {
    if (text === "") return;
    const last = runs[runs.length - 1];
    if (last !== undefined && marksEqual(last.marks, marks)) {
      last.text += text;
      return;
    }
    runs.push({ text, marks });
  };

  /** Whether `_`-style emphasis may open/close at `at` of `text` (the word boundary; the `_` is a word character). */
  const underscoreBoundary = (text: string, at: number, opener: boolean): boolean => {
    const other = opener ? text.charAt(at - 1) : text.charAt(at);
    if (other === "") return true;
    return !/[A-Za-z0-9_]/.test(other);
  };

  /** The link href between `( ... )` after the `]` at `close` of `text`: the URL minus the optional title. */
  const linkHrefAfter = (text: string, close: number): string | null => {
    if (text.charAt(close + 1) !== "(") return null;
    const end = text.indexOf(")", close + 2);
    if (end === -1) return null;
    const href = text.slice(close + 2, end).trim();
    if (href === "") return null;
    // A quoted title: `href "title"` → the URL is the first token.
    const space = href.indexOf(" ");
    if (space !== -1 && href.slice(space + 1).startsWith('"')) return href.slice(0, space);
    return href;
  };

  /** Recurse over a span with the accumulated marks. */
  const parseSpan = (text: string, marks: MarkSet): void => {
    let i = 0;
    let buffer = "";
    const flush = (): void => {
      if (buffer !== "") {
        push(buffer, marks);
        buffer = "";
      }
    };
    while (i < text.length) {
      const ch = text.charAt(i);

      // Backslash escape: the next punctuation stays literal.
      if (ch === "\\" && i + 1 < text.length && /[\p{P}]/u.test(text.charAt(i + 1))) {
        buffer += text.charAt(i + 1);
        i += 2;
        continue;
      }

      // Inline code span: a backtick run matched by the same run.
      if (ch === "`") {
        let ticks = 0;
        while (ticks < text.length && text.charAt(i + ticks) === "`") ticks++;
        const close = text.indexOf("`".repeat(ticks), i + ticks);
        if (close !== -1) {
          let content = text.slice(i + ticks, close);
          if (content.startsWith(" ") && content.endsWith(" ") && content.trim() !== "") content = content.slice(1, -1);
          flush();
          push(content, { code: true });
          i = close + ticks;
          continue;
        }
        buffer += ch;
        i += 1;
        continue;
      }

      // The inline HTML tag: a stray closing tag drops (no opener at this
      // level); `<br>` is the soft break, the known inline tags are mark
      // spans (a closed pair only — the unclosed open degrades to the plain
      // content), and any other tag (unknown, wrappers, `img`, structural,
      // self-closing) drops with its content kept on the current marks. A
      // bare `<` falls through to the autolink / literal.
      if (ch === "<") {
        const strayClose = STRAY_CLOSE_TAG.exec(text.slice(i));
        if (strayClose !== null) {
          i += strayClose[0]!.length;
          continue;
        }
        const tag = inlineTagAt(text, i);
        if (tag !== null) {
          if (tag.name === "br") {
            flush();
            push("\n", marks);
            i = tag.end;
            continue;
          }
          if (tag.selfClosing) {
            i = tag.end;
            continue;
          }
          const innerMark = inlineTagMarks(tag);
          const close = new RegExp(`</${tag.name}\\s*/?\\s*>`, "i").exec(text.slice(tag.end));
          if (close !== null) {
            const contentEnd = tag.end + close.index;
            if (tag.name === "code") {
              // The code span is exclusive: the content is raw and carries
              // no other mark (the backtick span's contract; core rejects
              // the exclusive mark composed with others).
              flush();
              push(text.slice(tag.end, contentEnd), { code: true });
              i = contentEnd + close[0]!.length;
              continue;
            }
            flush();
            parseSpan(text.slice(tag.end, contentEnd), innerMark !== null ? { ...marks, ...innerMark } : marks);
            i = contentEnd + close[0]!.length;
            continue;
          }
          // The unclosed open tag: drop it, the content keeps the current marks.
          i = tag.end;
          continue;
        }

        // The autolink: <https://…> / <mailto:…> (the http/https/mailto schemes only).
        const end = text.indexOf(">", i + 1);
        if (end !== -1) {
          const href = text.slice(i + 1, end);
          if (/^(https?:|mailto:)/i.test(href) && !href.includes(" ")) {
            flush();
            push(href, { ...marks, link: { href } });
            i = end + 1;
            continue;
          }
        }
      }

      // The inline image in the middle of a line degrades to the literal text.
      if (ch === "!" && text.charAt(i + 1) === "[") {
        const bracket = text.indexOf("]", i + 2);
        const href = bracket !== -1 ? linkHrefAfter(text, bracket) : null;
        if (href !== null) {
          const end = text.indexOf(")", bracket + 1);
          buffer += text.slice(i, end === -1 ? text.length : end + 1);
          i = end === -1 ? text.length : end + 1;
          continue;
        }
      }

      // The link: [text](href); a `]` without `(…)` (the reference style) stays literal.
      if (ch === "[") {
        const bracket = text.indexOf("]", i + 1);
        const href = bracket !== -1 ? linkHrefAfter(text, bracket) : null;
        if (href !== null) {
          flush();
          parseSpan(text.slice(i + 1, bracket), { ...marks, link: { href } });
          i = text.indexOf(")", bracket + 1) + 1;
          continue;
        }
      }

      // The emphasis / strike openers (the longer tokens first; the `***` is the
      // bold+italic nesting shorthand).
      const token =
        ch === "*" && text.charAt(i + 1) === "*" && text.charAt(i + 2) === "*"
          ? "***"
          : ch === "*" && text.charAt(i + 1) === "*"
            ? "**"
            : ch === "_" && text.charAt(i + 1) === "_"
              ? "__"
              : ch === "~" && text.charAt(i + 1) === "~"
                ? "~~"
                : ch;
      if (token === "***" || token === "**" || token === "__" || token === "*" || token === "_" || token === "~~") {
        const underscore = token === "_" || token === "__";
        if (!underscore || underscoreBoundary(text, i, true)) {
          const close = text.indexOf(token, i + token.length);
          const content = close !== -1 ? text.slice(i + token.length, close) : "";
          if (content.trim() !== "" && (!underscore || underscoreBoundary(text, close + token.length, false))) {
            flush();
            const inner: MarkSet =
              token === "***"
                ? { ...marks, bold: true, italic: true }
                : token === "**" || token === "__"
                  ? { ...marks, bold: true }
                  : token === "~~"
                    ? { ...marks, strike: true }
                    : { ...marks, italic: true };
            parseSpan(content, inner);
            i = close + token.length;
            continue;
          }
        }
      }

      // The inline math: $…$ (exclusive; the delimiters are not spaced).
      if (ch === "$" && text.charAt(i + 1) !== "" && text.charAt(i + 1) !== " ") {
        const close = text.indexOf("$", i + 1);
        if (close > i + 1 && text.charAt(close - 1) !== " ") {
          flush();
          push(text.slice(i + 1, close), { math: { tex: text.slice(i + 1, close) } });
          i = close + 1;
          continue;
        }
      }

      buffer += ch;
      i += 1;
    }
    flush();
  };

  parseSpan(source, {});
  return runs;
}

/** A paragraph line with the structural-tag literal flag (the line keeps its tags as text). */
interface MdParagraphLine {
  text: string;
  literal: boolean;
}

/** The paragraph join: the soft break is a space, the hard break (two spaces / `\`) is a `\n`. */
function joinParagraphLines(lines: MdParagraphLine[]): TextRun[] {
  const runs: TextRun[] = [];
  const hardBreakAt = (text: string): boolean => /(?: {2,}|\\)$/.test(text);
  lines.forEach((line, index) => {
    // The hard break belongs to the line that ENDS at the break (the previous one).
    if (index > 0) runs.push({ text: hardBreakAt(lines[index - 1]!.text) ? "\n" : " ", marks: {} });
    // The structural-tag line keeps the whole text verbatim (no inline pass).
    if (line.literal) {
      runs.push({ text: line.text, marks: {} });
      return;
    }
    const body = hardBreakAt(line.text) ? line.text.replace(/(?: {2,}|\\)$/, "") : line.text;
    runs.push(...parseInline(body.trim()));
  });
  // Re-merge the adjacent equal-mark runs the line joins may have split.
  const merged: TextRun[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last !== undefined && marksEqual(last.marks, run.marks)) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged;
}

/** The fenced-code opening: the backtick run (info string without backticks) or the tilde run. */
function fenceOpenOf(line: string): { char: "`" | "~"; length: number; info: string } | null {
  const backtick = /^ {0,3}(`{3,})([^`]*)$/.exec(line);
  if (backtick !== null) return { char: "`", length: backtick[1]!.length, info: backtick[2]!.trim() };
  const tilde = /^ {0,3}(~{3,})(.*)$/.exec(line);
  if (tilde !== null) return { char: "~", length: tilde[1]!.length, info: tilde[2]!.trim() };
  return null;
}

/** The paste decomposition of a markdown document or fragment. */
function mdToBlocks(markdown: string): MdPasteBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();

  const blocks: MdPasteBlock[] = [];
  let paragraph: MdParagraphLine[] = [];
  const closeParagraph = (): void => {
    if (paragraph.length === 0) return;
    const text = paragraph.map((l) => l.text).join("\n");
    if (text.trim() !== "")
      blocks.push({ type: "paragraph", indent: 0, attrs: {}, runs: joinParagraphLines(paragraph) });
    paragraph = [];
  };
  const lastBlock = (): MdPasteBlock | undefined => blocks[blocks.length - 1];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (trimmed === "") {
      closeParagraph();
      i += 1;
      continue;
    }

    // The fenced code block (the content is data: no inline pass).
    const fence = fenceOpenOf(line);
    if (fence !== null) {
      closeParagraph();
      const closePattern = new RegExp(`^ {0,3}${fence.char.repeat(fence.length)}{1,}\\s*$`);
      const content: string[] = [];
      i += 1;
      while (i < lines.length && closePattern.test(lines[i] ?? "") === false) {
        content.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // the closing fence (or the end of the input: the unclosed fence keeps its content)
      const language = fence.info.split(/\s+/)[0] ?? "";
      blocks.push({
        type: "code",
        indent: 0,
        attrs: language !== "" ? { language } : {},
        runs: content.length > 0 ? [{ text: content.join("\n"), marks: {} }] : [],
      });
      continue;
    }

    // The $$ math block (single-line or up to the closing line).
    if (trimmed.startsWith("$$")) {
      closeParagraph();
      const single = trimmed.match(/^\$\$(.*)\$\$$/);
      if (single !== null) {
        blocks.push({ type: "latex", indent: 0, attrs: {}, runs: [{ text: single[1]!.trim(), marks: {} }] });
        i += 1;
        continue;
      }
      const content: string[] = trimmed.slice(2).trim() === "" ? [] : [trimmed.slice(2).trim()];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        const body = (lines[i] ?? "").trim();
        if (body === "$$" || body.endsWith("$$")) {
          if (body !== "$$") content.push(body.slice(0, -2));
          closed = true;
          i += 1;
          break;
        }
        content.push(lines[i] ?? "");
        i += 1;
      }
      if (!closed) {
        // The unclosed $$ degrades to literal text (the lenient posture).
        paragraph.push({ text: "$$", literal: false });
        for (const c of content) paragraph.push({ text: c, literal: false });
        continue;
      }
      blocks.push({
        type: "latex",
        indent: 0,
        attrs: {},
        runs: content.every((l) => l.trim() === "") ? [] : [{ text: content.join("\n"), marks: {} }],
      });
      continue;
    }

    // The GFM table: the header row + the separator row of the SAME width, then the `|` rows.
    if (trimmed.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1] ?? "")) {
      closeParagraph();
      const headerCells = tableCellsOf(trimmed);
      if (tableCellsOf(lines[i + 1] ?? "").length !== headerCells.length) {
        // The width mismatch: not a table (the `---` line falls through to the
        // setext/thematic-break pass below).
        paragraph.push({ text: trimmed, literal: false });
        i += 1;
        continue;
      }
      const cellsOf = (row: string): TextRun[][] => tableCellsOf(row).map((cell) => parseInline(cell));
      const rows: TextRun[][][] = [cellsOf(trimmed)];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim() !== "") {
        // Pad/truncate the ragged rows to the header width (the lenient posture).
        let row = tableCellsOf(lines[i] ?? "");
        if (row.length < headerCells.length) row = [...row, ...Array<string>(headerCells.length - row.length).fill("")];
        else row = row.slice(0, headerCells.length);
        rows.push(row.map((cell) => parseInline(cell)));
        i += 1;
      }
      blocks.push({ type: "table", indent: 0, attrs: {}, runs: [], rows });
      continue;
    }

    // The ATX heading (a space after the `#`s is required — `#hashtag` is a paragraph).
    const atx = /^ {0,3}(#{1,6})(?:\s+(.*))?\s*$/.exec(line);
    if (atx !== null) {
      closeParagraph();
      const text = (atx[2] ?? "").replace(/\s+#+\s*$/, "").trim();
      blocks.push({
        type: "heading",
        indent: 0,
        attrs: { level: atx[1]!.length },
        runs: text !== "" ? parseInline(text) : [],
      });
      i += 1;
      continue;
    }

    // The setext heading / the thematic break (the `---` discriminator).
    const only = trimmed.replace(/\s+/g, "");
    if (/^={3,}$/.test(only) || /^-{3,}$/.test(only) || /^\*{3,}$/.test(only) || /^_{3,}$/.test(only)) {
      if (only.startsWith("=") && paragraph.length > 0) {
        const runs = joinParagraphLines(paragraph);
        paragraph = [];
        blocks.push({ type: "heading", indent: 0, attrs: { level: 1 }, runs });
      } else if (only.startsWith("-") && paragraph.length > 0) {
        const runs = joinParagraphLines(paragraph);
        paragraph = [];
        blocks.push({ type: "heading", indent: 0, attrs: { level: 2 }, runs });
      } else {
        closeParagraph();
        blocks.push({ type: "divider", indent: 0, attrs: {}, runs: [] });
      }
      i += 1;
      continue;
    }

    // The list item (bullet / number / task; the depth is the 2-space step).
    const item = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
    if (item !== null) {
      closeParagraph();
      const depth = Math.floor(item[1]!.length / 2);
      const content = item[3] ?? "";
      const task = /^\[([ xX])\]\s+(.*)$/.exec(content);
      const kind: "bullet" | "number" | "task" =
        task !== null ? "task" : /^[.*+-]$/.test(item[2]!) ? "bullet" : "number";
      const body = (task !== null ? task[2] : content) ?? "";
      const block: MdPasteBlock = {
        type: "list-item",
        indent: depth,
        attrs: { list: kind, ...(task !== null ? { checked: task[1]!.toLowerCase() === "x" } : {}) },
        runs: body !== "" ? parseInline(body) : [],
      };
      blocks.push(block);
      i += 1;
      continue;
    }

    // The list-item continuation: the indented line right after an item joins its text.
    const continuation = /^(\s{1,})(\S.*)$/.exec(line);
    const continuationTarget = lastBlock();
    if (continuation !== null && continuationTarget !== undefined && continuationTarget.type === "list-item") {
      const continuationText = continuation[2]!;
      continuationTarget.runs = [
        ...continuationTarget.runs,
        { text: "\n", marks: {} },
        ...(STRUCTURAL_TAG_LINE.test(continuationText)
          ? [{ text: continuationText.trim(), marks: {} }]
          : parseInline(continuationText)),
      ];
      i += 1;
      continue;
    }

    // The quote (the `>` count is the depth; the multi-line content is a soft-break join).
    const firstQuote = /^(\s*)(>+)\s?(.*)$/.exec(line);
    if (firstQuote !== null) {
      closeParagraph();
      const depth = firstQuote[2]!.length - 1; // the single `>` is the depth 0
      const content: string[] = [firstQuote[3]!.trim()];
      i += 1;
      while (i < lines.length && /^(\s*)>/.test(lines[i] ?? "") && (lines[i] ?? "").trim() !== "") {
        content.push((/(\s*)>+(\s?)(.*)$/.exec(lines[i] ?? "")?.[3] ?? "").trim());
        i += 1;
      }
      const text = content.join("\n");
      blocks.push({ type: "quote", indent: depth, attrs: {}, runs: text !== "" ? parseInline(text) : [] });
      continue;
    }

    // The standalone image line.
    const image = IMAGE_LINE.exec(line);
    if (image !== null) {
      closeParagraph();
      blocks.push({ type: "image", indent: 0, attrs: { src: image[2] }, runs: [] });
      i += 1;
      continue;
    }

    // The indented code block (4-space lines outside the list context).
    if (/^ {4,}\S/.test(line)) {
      closeParagraph();
      const content: string[] = [];
      while (i < lines.length && /^ {4,}\S/.test(lines[i] ?? "")) {
        content.push((lines[i] ?? "").slice(4));
        i += 1;
      }
      blocks.push({
        type: "code",
        indent: 0,
        attrs: {},
        runs: content.length > 0 ? [{ text: content.join("\n"), marks: {} }] : [],
      });
      continue;
    }

    // The paragraph accumulation (the structural-tag line is flagged literal).
    paragraph.push({ text: line.replace(/^ {0,3}/, ""), literal: STRUCTURAL_TAG_LINE.test(line.trim()) });
    i += 1;
  }
  closeParagraph();
  return blocks.map(decodeBlockEntities);
}

/** The one-pass entity decode over a run list (the text, the link href, the math tex). */
function decodeRuns(runs: TextRun[]): TextRun[] {
  return runs.map((run) => {
    const marks: MarkSet = { ...run.marks };
    if (marks.link !== undefined) marks.link = { href: decodeEntities(marks.link.href) };
    if (marks.math !== undefined) marks.math = { tex: decodeEntities(marks.math.tex) };
    return { text: decodeEntities(run.text), marks };
  });
}

/** The entity decode over a parsed block (the runs, the table cells, the image src). */
function decodeBlockEntities(block: MdPasteBlock): MdPasteBlock {
  const attrs: Record<string, unknown> = { ...block.attrs };
  if (block.type === "image" && typeof attrs.src === "string") attrs.src = decodeEntities(attrs.src);
  return {
    ...block,
    attrs,
    runs: decodeRuns(block.runs),
    rows: block.rows !== undefined ? block.rows.map((row) => row.map(decodeRuns)) : undefined,
  };
}

export { mdToBlocks };
export type { MdBlockType, MdPasteBlock };
