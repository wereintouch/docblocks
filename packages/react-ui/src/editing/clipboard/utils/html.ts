/**
 * The rich `text/html` paste branch: the whitelist-mapped inline elements
 * (b/strong, i/em, u, s/strike/del, code, a[href], span color and
 * highlight) become runs, and the block structure (h1–h6, p, ul/ol, pre,
 * blockquote, hr, table) becomes blocks — the payload materializes through
 * the same multi-block pipeline as the markdown paste (one transaction,
 * one undo step, one wire update). Everything outside the inline whitelist
 * contributes its text content only; `style` is kept for the two mapped
 * properties. A link href survives only when it is an `http:`, `https:`,
 * or `mailto:` URL or a same-document `#fragment`. `br` is a soft line
 * break (the `\n` in the run text); `script`/`style` are metadata, not
 * content; `img` is dropped (the schema's image source is an opaque blob
 * key, not an external URL). The generic wrappers (div/section/...) are
 * transparent to the structure (their block-level children stand as blocks
 * at the same level); the blockquote's content keeps the quote type (the
 * browser wraps it in p's). The inline whitespace keeps the browser's
 * collapse semantics (the whitespace runs become a single space; the raw
 * pre content stands verbatim), and the whitespace-only content is not
 * materialized. A code target takes the raw text with the line structure
 * — no parsing, no marks.
 */
import type { BlockId, Doc, MarkSet, TextRun } from "docblocks-core";

import { LINE_ANCHOR_SLOT } from "../../../text/runs-dom";
import type { MaterializedBlock } from "../models";
import { materializePaste } from "./materialize";

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

/** Whether two mark sets are structurally equal (for run merging). */
function marksEqual(a: MarkSet, b: MarkSet): boolean {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return (keysA as (keyof MarkSet)[]).every((key) => key in b && JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

/** Appends a run to the list, merging it into the neighbor when the marks are equal. */
function pushRun(runs: TextRun[], text: string, marks: MarkSet): void {
  if (text === "") return;
  const last = runs[runs.length - 1];
  if (last !== undefined && marksEqual(last.marks, marks)) {
    last.text += text;
    return;
  }
  runs.push({ text, marks: { ...marks } });
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
  // boundaries stand even when the node is whitespace-only).
  if (node.nodeType === Node.TEXT_NODE) return runs;
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
/**
 * The raw text of a payload for the code target: each top-level block
 * element stands its own line (the inline units run together on a line,
 * the nested block boundaries and `br` become newlines), the marks are
 * dropped.
 */
function rawTextOfHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");

  // The line text of a subtree: the inline content runs together, the
  // nested block boundaries and the br take their newlines.
  const lineTextOf = (node: Node): string => {
    let out = "";
    const visit = (current: Node): void => {
      if (current.nodeType === Node.TEXT_NODE) {
        out += current.nodeValue ?? "";
        return;
      }
      if (current.nodeType !== Node.ELEMENT_NODE) return;
      const element = current as Element;
      if (isLineAnchor(element)) return;
      const tag = element.nodeName.toUpperCase();
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "IMG") return;
      if (tag === "BR") {
        out += "\n";
        return;
      }
      if (BLOCK_LEVEL_TAGS.has(tag)) {
        // The block boundary closes the current line before the block's
        // content (the edge trim of the unit would eat a trailing newline).
        if (out !== "" && !out.endsWith("\n")) out += "\n";
        for (const child of Array.from(element.childNodes)) visit(child);
        return;
      }
      for (const child of Array.from(element.childNodes)) visit(child);
    };
    visit(node);
    return out;
  };

  // The top-level units: the block elements stand their own line, the
  // inline content (the text and the inline elements) runs together.
  const units: Array<{ text: string; block: boolean }> = [];
  for (const child of Array.from(parsed.body.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      units.push({ text: lineTextOf(child), block: false });
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as Element;
    if (isLineAnchor(element)) continue;
    const tag = element.nodeName.toUpperCase();
    if (tag === "SCRIPT" || tag === "STYLE") continue;
    const block = BLOCK_LEVEL_TAGS.has(tag);
    const text = block ? lineTextOf(element).replace(/^[ \t\n]+|[ \t\n]+$/g, "") : lineTextOf(element);
    units.push({ text, block });
  }

  let text = "";
  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i]!;
    if (unit.text === "") continue;
    if (text === "") {
      text = unit.text;
      continue;
    }
    // The newline between the units when a block boundary separates them.
    const previous = units[i - 1]!;
    text += (previous.block || unit.block ? "\n" : "") + unit.text;
  }
  return text.replace(/\n{2,}/g, "\n");
}

/** The runs of one pasted block element's content (raw for pre/code). */
function blockRunsOf(element: Element, type: string): TextRun[] {
  if (type === "PRE") return runsOf(element, {}, true);
  return runsOf(element, {}, false);
}

/**
 * Parses a list element into list-item materials (the indent is the
 * nesting level; a list that is the list's own direct child — the
 * malformed but parseable shape — stands at the same level).
 */
function listMaterialsOf(list: Element, indent: number, out: MaterializedBlock[]): void {
  for (const child of Array.from(list.children)) {
    const tag = child.nodeName.toUpperCase();
    if (tag === "UL" || tag === "OL") {
      listMaterialsOf(child, indent, out);
      continue;
    }
    if (tag !== "LI") continue;
    // The item's own content: everything except the nested lists.
    const itemContent: Node[] = [];
    for (const node of Array.from(child.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE && (node.nodeName === "UL" || node.nodeName === "OL")) continue;
      itemContent.push(node);
    }
    const content = document.createDocumentFragment();
    for (const node of itemContent) content.appendChild(node);
    const runs = runsOf(content, {}, false);
    if (runs.length > 0) {
      out.push({
        type: "list-item",
        indent,
        attrs: { list: list.nodeName === "OL" ? "number" : "bullet" },
        runs,
      });
    }
    // The nested lists: the items at the next level (the document order is
    // the content order, so the nesting follows the item it belongs to).
    for (const nested of Array.from(child.children)) {
      const nestedTag = nested.nodeName.toUpperCase();
      if (nestedTag === "UL" || nestedTag === "OL") listMaterialsOf(nested, indent + 1, out);
    }
  }
}

/**
 * Parses a pasted HTML payload into paste blocks: the top-level block
 * structure (h1–h6 → heading, p → paragraph, ul/ol → list items, pre →
 * code, blockquote → quote, hr → divider, table → the table with its
 * cells) with the inline whitelist over the runs. The indents are relative
 * to the paste (0 = the top level) — the materialization re-bases them to
 * the caret block's level. An empty payload yields no blocks.
 */
function htmlToBlocks(html: string): MaterializedBlock[] {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const blocks: MaterializedBlock[] = [];

  // The pending top-level inline content (a bare text node or an inline
  // element between blocks) accumulates into one paragraph.
  let pending: TextRun[] = [];
  const flushPending = (): void => {
    // The whitespace-only pending content is not content; the whitespace-
    // only edge runs are the paste's edges (the word-boundary spaces stand).
    const runs = dropEdgeWhitespaceRuns(pending);
    pending = [];
    if (runs.length > 0) blocks.push({ type: "paragraph", indent: 0, attrs: {}, runs });
  };

  const pushBlock = (
    type: MaterializedBlock["type"],
    indent: number,
    attrs: Record<string, unknown>,
    runs: TextRun[]
  ): void => {
    // The trailing empty paragraph is not materialized (the paste does not
    // leave a blank block at the end — the trailing-paragraph contract of
    // the non-text landing).
    if (type === "paragraph" && runs.length === 0) return;
    blocks.push({ type, indent, attrs, runs });
  };

  const visitBlock = (element: Element, indent: number): void => {
    const tag = element.nodeName.toUpperCase();
    switch (tag) {
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6":
        pushBlock("heading", indent, { level: Number(tag[1]) }, blockRunsOf(element, tag));
        return;
      case "PRE":
        pushBlock("code", indent, {}, blockRunsOf(element, tag));
        return;
      case "HR":
        pushBlock("divider", indent, {}, []);
        return;
      case "BLOCKQUOTE": {
        // The quote's content stands the quote (the browser's clipboard
        // serialization wraps it in p's — the content keeps the quote type,
        // not the wrapper's); the nested blockquote is the deeper quote
        // level. The inline content between the blocks stands the quote
        // paragraph (the document order stands).
        let pending: TextRun[] = [];
        const flushPendingQuote = (): void => {
          const runs = dropEdgeWhitespaceRuns(pending);
          pending = [];
          if (runs.length > 0) blocks.push({ type: "quote", indent, attrs: {}, runs });
        };
        for (const child of Array.from(element.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE) {
            const text = inlineTextOf(child.nodeValue ?? "", false);
            if (text !== "") pushRun(pending, text, {});
            continue;
          }
          if (child.nodeType !== Node.ELEMENT_NODE) continue;
          const childElement = child as Element;
          const childTag = childElement.nodeName.toUpperCase();
          if (isLineAnchor(childElement)) continue;
          if (childTag === "SCRIPT" || childTag === "STYLE") continue;
          if (childTag === "BLOCKQUOTE") {
            flushPendingQuote();
            visitBlock(childElement, indent + 1);
            continue;
          }
          if (BLOCK_LEVEL_TAGS.has(childTag)) {
            flushPendingQuote();
            const runs = blockRunsOf(childElement, childTag);
            if (runs.length > 0) blocks.push({ type: "quote", indent, attrs: {}, runs });
            continue;
          }
          for (const run of runsOf(childElement, {}, false)) pushRun(pending, run.text, run.marks);
        }
        flushPendingQuote();
        return;
      }
      case "UL":
      case "OL":
        listMaterialsOf(element, indent, blocks);
        return;
      case "TABLE": {
        const rows: TextRun[][][] = [];
        for (const tr of tableRowsOf(element)) {
          const cells: TextRun[][] = [];
          for (const cell of Array.from(tr.children)) {
            const cellTag = cell.nodeName.toUpperCase();
            if (cellTag !== "TD" && cellTag !== "TH") continue;
            cells.push(runsOf(cell, {}, false));
          }
          if (cells.length > 0) rows.push(cells);
        }
        if (rows.length === 0) return;
        // The ragged rows are padded to the widest (the materialization's
        // table contract is even rows).
        const cols = Math.max(...rows.map((row) => row.length));
        for (const row of rows) {
          while (row.length < cols) row.push([]);
        }
        blocks.push({ type: "table", indent, attrs: { cols }, runs: [], rows });
        return;
      }
      case "P":
        // The paragraph: the content stands as-is (an empty p is dropped
        // by the pushBlock guard).
        pushBlock("paragraph", indent, {}, blockRunsOf(element, tag));
        return;
      case "ADDRESS":
      case "ARTICLE":
      case "ASIDE":
      case "DD":
      case "DIV":
      case "DL":
      case "DT":
      case "FIELDSET":
      case "FIGCAPTION":
      case "FIGURE":
      case "FOOTER":
      case "HEADER":
      case "MAIN":
      case "NAV":
      case "SECTION": {
        // The generic wrapper is transparent to the structure (the browser's
        // rendering does the same — the copied document body is usually such
        // a wrapper around the paragraphs): the block-level children stand
        // as blocks at the same level, the inline content between them
        // stands the paragraph (the document order stands).
        let inline: TextRun[] = [];
        const flushInline = (): void => {
          const runs = dropEdgeWhitespaceRuns(inline);
          inline = [];
          if (runs.length > 0) pushBlock("paragraph", indent, {}, runs);
        };
        for (const child of Array.from(element.childNodes)) {
          if (child.nodeType === Node.ELEMENT_NODE) {
            const childElement = child as Element;
            const childTag = childElement.nodeName.toUpperCase();
            if (isLineAnchor(childElement)) continue;
            if (childTag === "SCRIPT" || childTag === "STYLE") continue;
            if (BLOCK_LEVEL_TAGS.has(childTag)) {
              flushInline();
              visitBlock(childElement, indent);
              continue;
            }
            for (const run of runsOf(childElement, {}, false)) pushRun(inline, run.text, run.marks);
          } else if (child.nodeType === Node.TEXT_NODE) {
            const text = inlineTextOf(child.nodeValue ?? "", false);
            if (text !== "") pushRun(inline, text, {});
          }
        }
        flushInline();
        return;
      }
      default:
        break;
    }
    // The unrecognized blocks: the content is the paragraph (the lenient
    // stand — the content is preserved).
    const runs = blockRunsOf(element, tag);
    if (runs.length > 0) pushBlock("paragraph", indent, {}, runs);
  };

  for (const node of Array.from(parsed.body.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      // The top-level text is the inline content (the word-boundary spaces
      // stand; the whitespace-only edges are dropped by the flush).
      const text = inlineTextOf(node.nodeValue ?? "", false);
      if (text !== "") pushRun(pending, text, {});
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as Element;
    if (isLineAnchor(element)) continue;
    const tag = element.nodeName.toUpperCase();
    if (tag === "SCRIPT" || tag === "STYLE") continue;
    if (BLOCK_LEVEL_TAGS.has(tag)) {
      flushPending();
      visitBlock(element, 0);
    } else {
      // The top-level inline content joins the pending paragraph.
      const runs = runsOf(element, {}, false);
      for (const run of runs) pushRun(pending, run.text, run.marks);
    }
  }
  flushPending();
  return blocks;
}

/**
 * The text content of a rich payload (the cell paste stands the plain text
 * even for an HTML-only clipboard — the cell's data is plain text and the
 * marks are dropped).
 */
function plainTextOfHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return parsed.body?.textContent ?? "";
}

/**
 * Apply a rich paste: the code target takes the raw text (no parsing, no
 * marks); the page targets materialize the parsed blocks through the
 * shared multi-block pipeline (the caret block split; the merge; the
 * demotion; the re-based indents) — one transaction, one undo step.
 * Returns the caret landing, or `null` when nothing was pasted.
 */
function applyRichPaste(
  doc: Doc,
  blockId: BlockId,
  from: number,
  to: number,
  html: string,
  opts?: { keepSeat?: boolean }
): { blockId: BlockId; offset: number } | null {
  const block = doc.getBlock(blockId);
  if (block === null) return null;

  if (block.type === "code") {
    const raw = rawTextOfHtml(html).replace(/\r\n?/g, "\n");
    if (raw === "") return null;
    doc.transact(() => {
      if (to > from) doc.deleteText(blockId, from, to);
      doc.insertText(blockId, from, raw);
    });
    return { blockId, offset: from + raw.length };
  }

  return materializePaste(doc, blockId, from, to, htmlToBlocks(html), opts);
}

export { applyRichPaste, htmlToBlocks, plainTextOfHtml, rawTextOfHtml };
