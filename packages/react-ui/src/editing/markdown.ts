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
 * nesting and backslash escapes. Everything the v1 registry cannot
 * express (raw HTML blocks, reference-style links, the inline image in
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

      // The autolink: <https://…> / <mailto:…> (the http/https/mailto schemes only).
      if (ch === "<") {
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

/** The paragraph join: the soft break is a space, the hard break (two spaces / `\`) is a `\n`. */
function joinParagraphLines(lineTexts: string[]): TextRun[] {
  const runs: TextRun[] = [];
  const hardBreakAt = (text: string): boolean => /(?: {2,}|\\)$/.test(text);
  lineTexts.forEach((text, index) => {
    // The hard break belongs to the line that ENDS at the break (the previous one).
    if (index > 0) runs.push({ text: hardBreakAt(lineTexts[index - 1]!) ? "\n" : " ", marks: {} });
    const body = hardBreakAt(text) ? text.replace(/(?: {2,}|\\)$/, "") : text;
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
  let paragraph: string[] = [];
  const closeParagraph = (): void => {
    if (paragraph.length === 0) return;
    const text = paragraph.join("\n");
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
        paragraph.push("$$");
        for (const c of content) paragraph.push(c);
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
        paragraph.push(trimmed);
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
      continuationTarget.runs = [
        ...continuationTarget.runs,
        { text: "\n", marks: {} },
        ...parseInline(continuation[2]!),
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

    // The paragraph accumulation.
    paragraph.push(line.replace(/^ {0,3}/, ""));
    i += 1;
  }
  closeParagraph();
  return blocks;
}

export { mdToBlocks };
export type { MdBlockType, MdPasteBlock };
