/**
 * The block-level pass of the markdown paste parser: the GFM table shape,
 * the paragraph join, the fenced-code opening, the whole-document
 * decomposition (mdToBlocks), and the one-pass entity decode over the
 * parsed blocks.
 */
import type { MarkSet, TextRun } from "docblocks-core";

import { marksEqual } from "../../mark-utils";
import { IMAGE_LINE, STRUCTURAL_TAG_LINE } from "../constants";
import type { MdParagraphLine, MdPasteBlock } from "../models";
import { decodeEntities, parseInline } from "./inline";

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

/** The one-pass entity decode over a run list (the text, the link href). */
function decodeRuns(runs: TextRun[]): TextRun[] {
  return runs.map((run) => {
    const marks: MarkSet = { ...run.marks };
    if (marks.link !== undefined) marks.link = { href: decodeEntities(marks.link.href) };
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
