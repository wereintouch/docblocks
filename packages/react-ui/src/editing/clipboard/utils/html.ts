/**
 * The rich `text/html` paste branch: the whitelist-mapped inline elements
 * (b/strong, i/em, u, s/strike/del, code, a[href], span color and
 * highlight) become runs, and the block structure (h1–h6, p, ul/ol, pre,
 * blockquote, hr, table) becomes blocks — the payload materializes through
 * the same multi-block pipeline as the markdown paste (one transaction,
 * one undo step, one wire update). Everything outside the inline whitelist
 * contributes its text content only; `style` is kept for the two mapped
 * properties. A link href survives only when it is an `http:`, `https:`,
 * or a same-document `#fragment` (the data model's link contract — the
 * mailto / the javascript / any custom scheme stands the degrade, the
 * text without the mark). `br` is a soft line
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
import type { BlockId, Doc } from "docblocks-core";

import { htmlToBlocks } from "./html-blocks";
import { BLOCK_LEVEL_TAGS, isLineAnchor } from "./html-inline";
import { materializePaste } from "./materialize";

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

export { htmlToBlocks } from "./html-blocks";
export { applyRichPaste, plainTextOfHtml, rawTextOfHtml };
