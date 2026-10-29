/**
 * The inline pass of the markdown paste parser: the
 * emphasis/strike/code/link delimiters with nesting and backslash
 * escapes, the inline HTML tag spans (the standard tags map to the v1
 * marks, `<br>` is the soft line break, the other tags drop with their
 * content plain), the autolinks, and the single-pass entity decode.
 */
import type { MarkSet, TextRun } from "docblocks-core";

import { marksEqual } from "../../mark-utils";
import { ENTITY, MARK_HIGHLIGHT, NAMED_ENTITIES, OPEN_TAG, STRAY_CLOSE_TAG, TAG_HREF } from "../models";

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

/**
 * The inline pass: the emphasis/strike/code/link delimiters with
 * nesting and backslash escapes. Emphasis openers require a non-word
 * boundary only for `_`/`__` (the snake_case identifiers stay literal);
 * the `code` span is exclusive (its content carries no
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

      buffer += ch;
      i += 1;
    }
    flush();
  };

  parseSpan(source, {});
  return runs;
}

export { decodeEntities, inlineTagAt, inlineTagMarks, parseInline };
