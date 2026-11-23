/**
 * The rich paste's inline → runs machinery (the `./html`'s sibling): the
 * whitelist's mark mapping (the emphasis tags, the link's href, the span's
 * color/highlight), the inline whitespace semantics, the block-level tag
 * set, the subtree's runs walk, the table's rows, the block content's
 * runs, and the pre's language.
 */
import type { MarkSet, TextRun } from "docblocks-core";
import { isHexColor } from "docblocks-core";

import { LINE_ANCHOR_SLOT } from "../../../text/runs-dom";
import { appendRun, tagEmphasisMarks } from "../../mark-utils";

/** Whether a link href survives the paste whitelist (the data model's link
 *  contract — the core's rejection stand: the mailto / the javascript / any
 *  custom scheme stands the degrade, the text without the mark). */
function allowedHref(href: string): boolean {
  if (href.startsWith("#")) return true;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  if (scheme === undefined) return false; // no scheme: a relative URL is dropped
  return scheme === "http" || scheme === "https";
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
    // Only hex colors stand the marks (the data model's `color` / `highlight`
    // are hex). The browser's default copy serializes the rendered color as a
    // computed `oklch()` / `rgb()` value (the theme's foreground, not a user-
    // applied mark) — a non-hex value is not a mark and is dropped, so a
    // copy of the editor's own text pastes clean instead of failing the insert.
    if (!isHexColor(value)) continue;
    if (name === "color") result.color = value;
    else if (name === "background-color" || name === "background") result.highlight = value;
  }
  return result;
}

/** The mark one whitelisted element adds over its inherited marks; null when it maps to none. */
function elementMarks(element: Element): MarkSet | null {
  const simple = tagEmphasisMarks(element.nodeName);
  if (simple !== null) return simple;
  switch (element.nodeName.toUpperCase()) {
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

/** Appends a run to the list, merging it into the neighbor when the marks are equal. */
function pushRun(runs: TextRun[], text: string, marks: MarkSet): void {
  appendRun(runs, text, marks);
}

/**
 * The inline whitespace semantics (the browser's `white-space: normal`):
 * the whitespace runs collapse to a single space. The raw mode (the pre
 * content) keeps the text verbatim.
 */
function inlineTextOf(raw: string, rawMode: boolean): string {
  return rawMode ? raw : raw.replace(/\s+/g, " ");
}

/** Drops the whitespace-only runs at the block's edges (the markup padding). */
function dropEdgeWhitespaceRuns(runs: TextRun[]): TextRun[] {
  let start = 0;
  let end = runs.length;
  while (start < end && runs[start]!.text.trim() === "") start += 1;
  while (end > start && runs[end - 1]!.text.trim() === "") end -= 1;
  return runs.slice(start, end);
}

/** The tags that close the surrounding block and contribute their content at the next level. */
const BLOCK_LEVEL_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TD",
  "TH",
  "TR",
  "UL",
]);

/** Walks the subtree collecting runs (the inline whitelist over the inherited marks). */
function runsOf(node: Node, inherited: MarkSet, raw: boolean): TextRun[] {
  const runs: TextRun[] = [];
  const visit = (current: Node, marks: MarkSet): void => {
    if (current.nodeType === Node.TEXT_NODE) {
      pushRun(runs, inlineTextOf(current.nodeValue ?? "", raw), marks);
      return;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return;
    const element = current as Element;
    if (isLineAnchor(element)) return; // rendered-only caret seat, not content
    const tag = element.nodeName.toUpperCase();
    if (tag === "BR") {
      pushRun(runs, "\n", marks);
      return;
    }
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "IMG") return; // non-content
    // code is exclusive: the subtree carries the code mark only (the
    // ancestor marks do not compose over it; the raw mode carries none).
    if (tag === "CODE") {
      for (const child of Array.from(element.childNodes)) visit(child, raw ? {} : { code: true });
      return;
    }
    const own = elementMarks(element);
    const childMarks: MarkSet = raw ? {} : own !== null ? { ...marks, ...own } : marks;
    for (const child of Array.from(element.childNodes)) visit(child, childMarks);
  };
  // The document fragment (the list item's content) is walked over its children.
  const roots: Node[] = node.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? Array.from(node.childNodes) : [node];
  for (const root of roots) visit(root, raw ? {} : inherited);
  // The edge drop is the block's run-list edge (the block's content starts
  // and ends clean); a bare text node keeps its text as collapsed (the word
  // boundaries stand even when the node is whitespace-only). A bare BR
  // element stands the line break itself — its single run is the content,
  // not the padding, so the edge drop must not erase it (the non-browser
  // serializers — the .docx converters — stand the <br> between the block's text nodes
  // without the p's wrapper).
  if (node.nodeType === Node.TEXT_NODE) return runs;
  if (node.nodeType === Node.ELEMENT_NODE && (node as Element).nodeName.toUpperCase() === "BR") return runs;
  return dropEdgeWhitespaceRuns(runs);
}

/** The table's rows (the parser hoists the tr into the implicit tbody). */
function tableRowsOf(table: Element): Element[] {
  const rows: Element[] = [];
  const collect = (parent: Element): void => {
    for (const child of Array.from(parent.children)) {
      const tag = child.nodeName.toUpperCase();
      if (tag === "TR") rows.push(child);
      else if (tag === "TBODY" || tag === "THEAD" || tag === "TFOOT") collect(child);
    }
  };
  collect(table);
  return rows;
}

/** The runs of one pasted block element's content (raw for pre/code). */
function blockRunsOf(element: Element, type: string): TextRun[] {
  if (type === "PRE") return runsOf(element, {}, true);
  return runsOf(element, {}, false);
}

/** The PRE's language's attrs (the `language-*` class over the element or
 * its code's child — the producer's convention's read; the absent stands
 * the plain). */
function preLanguageAttrsOf(element: Element): Record<string, unknown> {
  const language = languageClassOf(element) ?? languageClassOf(element.querySelector("code"));
  return language === undefined ? {} : { language };
}

/** The `language-*` class's name over the element (the absent's stand —
 * the undefined). */
function languageClassOf(element: Element | null): string | undefined {
  if (element === null) return undefined;
  for (const cls of Array.from(element.classList)) {
    if (cls.startsWith("language-") && cls.length > "language-".length) {
      return cls.slice("language-".length);
    }
  }
  return undefined;
}

export {
  BLOCK_LEVEL_TAGS,
  blockRunsOf,
  dropEdgeWhitespaceRuns,
  inlineTextOf,
  isLineAnchor,
  preLanguageAttrsOf,
  pushRun,
  runsOf,
  tableRowsOf,
};
