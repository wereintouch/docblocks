/**
 * The rich paste's block-structure parse (the `./html`'s sibling): the
 * top-level block elements (h1–h6, p, ul/ol, pre, blockquote, hr, table)
 * become the paste's blocks over the inline whitelist's runs (the
 * `./html-inline` sibling).
 */
import type { TextRun } from "docblocks-core";

import type { MaterializedBlock } from "../models";
import {
  BLOCK_LEVEL_TAGS,
  blockRunsOf,
  dropEdgeWhitespaceRuns,
  inlineTextOf,
  isLineAnchor,
  preLanguageAttrsOf,
  pushRun,
  runsOf,
  tableRowsOf,
} from "./html-inline";
import { tableGridOf } from "./html-table";

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
        pushBlock("code", indent, preLanguageAttrsOf(element), blockRunsOf(element, tag));
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
        // The grid placement (the browser's table model): the even cell
        // matrix + the merged regions the materialization applies as the
        // anchor spans.
        const grid = tableGridOf(tableRowsOf(element));
        if (grid === null) return;
        blocks.push({
          type: "table",
          indent,
          attrs: { cols: grid.rows[0]!.length },
          runs: [],
          rows: grid.rows,
          merges: grid.merges,
        });
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

export { htmlToBlocks };
