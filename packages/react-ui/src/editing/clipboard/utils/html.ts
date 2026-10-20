/**
 * The rich `text/html` paste branch: parsing of a pasted payload into flat
 * runs (the inline-element whitelist), the one-transaction apply to a
 * block, and the plain-text read of a payload.
 *
 * Copy keeps the browser default (the contenteditable DOM is a structural
 * mirror of the runs, so a default copy is already rich). A paste with a
 * `text/html` payload is applied as doc commands in one transaction and the
 * DOM converges store-driven. v1 scope: a whitelist of inline elements
 * (b/strong, i/em, u, s/strike/del, code, a[href], span color and
 * highlight) — everything else contributes its text content only, and
 * `style` is kept for the two mapped properties only. A link href survives
 * only when it is an `http:`, `https:`, or `mailto:` URL or a
 * same-document `#fragment`. Multi-line HTML flattens into one line: a
 * newline between block-level elements becomes a space, `br` is dropped
 * (one block is one line; multi-block paste is a v1.1 feature), and the
 * contents of `script`/`style` are excluded (they are metadata, not
 * content).
 */
import type { BlockId, Doc, MarkSet, TextRun } from "docblocks-core";

import { LINE_ANCHOR_SLOT } from "../../../text/runs-dom";
import { BLOCK_TAGS } from "../models";

/** Whether a link href survives the paste whitelist. */
function allowedHref(href: string): boolean {
  if (href.startsWith("#")) return true;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  if (scheme === undefined) return false; // no scheme: a relative URL is dropped
  return scheme === "http" || scheme === "https" || scheme === "mailto";
}

/** The two style properties a span maps to; every other declaration is dropped. */
function styleMarksOf(style: string | null): { color?: string; highlight?: string } {
  const result: { color?: string; highlight?: string } = {};
  if (style === null) return result;
  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator === -1) continue;
    const name = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (value === "") continue;
    if (name === "color") result.color = value;
    else if (name === "background-color" || name === "background") result.highlight = value;
  }
  return result;
}

/** The mark one whitelisted element adds over its inherited marks; null when it maps to none. */
function elementMarks(element: Element): MarkSet | null {
  switch (element.nodeName.toUpperCase()) {
    case "B":
    case "STRONG":
      return { bold: true };
    case "I":
    case "EM":
      return { italic: true };
    case "U":
      return { underline: true };
    case "S":
    case "STRIKE":
    case "DEL":
      return { strike: true };
    case "A": {
      const href = element.getAttribute("href");
      return href !== null && allowedHref(href) ? { link: { href } } : null;
    }
    case "SPAN": {
      const style = styleMarksOf(element.getAttribute("style"));
      const marks: MarkSet = {};
      if (style.color !== undefined) marks.color = { value: style.color };
      if (style.highlight !== undefined) marks.highlight = { value: style.highlight };
      return Object.keys(marks).length > 0 ? marks : null;
    }
    default:
      return null;
  }
}

/** Whether a pasted element is the editor's line-break anchor (never content). */
function isLineAnchor(element: Element): boolean {
  return element.getAttribute("data-slot") === LINE_ANCHOR_SLOT;
}

/** The flattened text a node contributes, ignoring marks and `br`. */
function flattenedTextOf(node: Node): string {
  let text = "";
  const visit = (current: Node): void => {
    if (current.nodeType === Node.TEXT_NODE) {
      text += current.nodeValue ?? "";
      return;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return;
    if (isLineAnchor(current as Element)) return;
    const tag = current.nodeName.toUpperCase();
    if (tag === "BR" || tag === "SCRIPT" || tag === "STYLE") return;
    for (const child of Array.from(current.childNodes)) visit(child);
  };
  visit(node);
  return text;
}

/** Whether two mark sets are structurally equal (for run merging). */
function marksEqual(a: MarkSet, b: MarkSet): boolean {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return (keysA as (keyof MarkSet)[]).every((key) => key in b && JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

/**
 * Flatten a pasted HTML payload into runs over a whitelist mapping.
 * Adjacent runs with equal marks are merged; empty runs are never emitted.
 */
function htmlToRuns(html: string): TextRun[] {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const runs: TextRun[] = [];

  const pushRun = (text: string, marks: MarkSet): void => {
    if (text === "") return;
    const last = runs[runs.length - 1];
    if (last !== undefined && marksEqual(last.marks, marks)) {
      last.text += text;
      return;
    }
    runs.push({ text, marks });
  };

  const walk = (node: Node, inherited: MarkSet): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushRun(node.nodeValue ?? "", inherited);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (isLineAnchor(element)) return; // rendered-only caret seat, not content
    const tag = element.nodeName.toUpperCase();
    if (tag === "BR" || tag === "SCRIPT" || tag === "STYLE") return; // non-content

    // A block-level boundary: one space between non-empty neighbour lines.
    if (BLOCK_TAGS.has(tag)) {
      const line = flattenedTextOf(element);
      const previous = runs[runs.length - 1]?.text ?? "";
      if (line !== "" && previous !== "" && !/\s$/.test(previous) && !/^\s/.test(line)) {
        pushRun(" ", {});
      }
    }

    // code is exclusive: the subtree carries no other marks.
    const own = tag === "CODE" ? null : elementMarks(element);
    const marks: MarkSet = tag === "CODE" ? { code: true } : own !== null ? { ...inherited, ...own } : inherited;
    for (const child of Array.from(element.childNodes)) walk(child, marks);
  };

  // The body is the fragment root: elements the HTML parser hoists out of a
  // wrapper (table rows) still land among its children and keep their text.
  for (const child of Array.from(parsed.body.childNodes)) walk(child, {});
  return runs;
}

/**
 * Apply a rich paste to a block: delete [from, to) when non-empty, then
 * insert the parsed runs with their marks — one transaction, one undo step.
 * A code block receives the flattened text without marks (core rejects
 * marks there). Returns the number of inserted characters; 0 for an empty
 * payload or a missing block.
 */
function applyRichPaste(doc: Doc, blockId: BlockId, from: number, to: number, html: string): number {
  const block = doc.getBlock(blockId);
  if (block === null) return 0;
  const runs = htmlToRuns(html);
  const isCode = block.type === "code";
  const effective: TextRun[] = isCode ? runs.map((run) => ({ text: run.text, marks: {} })) : runs;
  const length = effective.reduce((sum, run) => sum + run.text.length, 0);
  if (length === 0) return 0;
  doc.transact(() => {
    if (to > from) doc.deleteText(blockId, from, to);
    let cursor = from;
    for (const run of effective) {
      doc.insertText(blockId, cursor, run.text, run.marks);
      cursor += run.text.length;
    }
  });
  return length;
}

/**
 * The text content of a rich payload: the cell paste stands the plain text
 * even for an HTML-only clipboard (the cell's data is plain text — the
 * marks are dropped).
 */
function plainTextOfHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return parsed.body?.textContent ?? "";
}

export { applyRichPaste, htmlToRuns, plainTextOfHtml };
