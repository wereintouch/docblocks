import { BLOCK_REGISTRY } from "docblocks-core";
import type { BlockId, BlockType, Doc, MarkSet, TextRun } from "docblocks-core";

import { LINE_ANCHOR_SLOT } from "../text/runs-dom";
import { findParentId, indentOf } from "./block-commands";
import { mdToBlocks } from "./markdown";

/**
 * Rich clipboard: parsing of a pasted `text/html` payload into flat runs.
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

/** The block-level tags whose boundary starts a new line. */
const BLOCK_TAGS = new Set([
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
 * The multi-block markdown paste (the `text/plain` branch, always-parsed):
 * the parsed blocks (markdown.ts) are materialized into the document in ONE
 * `doc.transact` — one undo step, one wire update. The caret block is
 * split at the caret: the prefix stands in the block, the first pasted
 * block merges into it (the same text type — the block's own type and attrs
 * stand) or follows it, the text after the original caret (the suffix)
 * lands in the last pasted text block (a trailing paragraph when the last
 * block is not text). An empty caret block converts in place to the first
 * pasted block. The code/latex targets take the raw text — no parsing, no
 * marks (the fence/`$$` syntax is their data). Every block the target
 * parent does not accept is demoted (the list/quote → paragraph; the table
 * → one paragraph per row, the cells joined by ` | `) — the paste never
 * throws on legitimate markdown. The indents are re-based to the caret
 * block's level and clamped by the strict jump rule (a paste into a nested
 * context nests, not escapes). Returns the caret landing (the end of the
 * last text block — the next sibling or the seat when the landing is a
 * non-text block), or `null` when nothing was pasted.
 */
function applyMdPaste(
  doc: Doc,
  seatId: BlockId,
  from: number,
  to: number,
  markdown: string,
  opts?: { keepSeat?: boolean }
): { blockId: BlockId; offset: number } | null {
  const seat = doc.getBlock(seatId);
  if (seat === null) return null;

  // The code/latex target: the raw text, no parsing.
  if (seat.type === "code" || seat.type === "latex") {
    doc.transact(() => {
      if (to > from) doc.deleteText(seatId, from, to);
      doc.insertText(seatId, from, markdown);
    });
    return { blockId: seatId, offset: from + markdown.length };
  }

  const parsed = mdToBlocks(markdown);
  if (parsed.length === 0) return null;

  const parentId = findParentId(doc, seatId) ?? doc.meta.id;
  const parent = doc.getBlock(parentId);
  const seatText = doc.getText(seatId);
  const prefix = seatText.slice(0, from);
  const suffix = seatText.slice(to);
  const seatIndent = indentOf(doc, seatId);

  // The demotion check: the target parent's childrenTypes (the root = the
  // page set, the cell = the leaf set).
  const eligible = (type: BlockType): boolean => {
    if (parent === null) return true;
    const spec = BLOCK_REGISTRY[parent.type];
    return spec.childrenTypes === undefined || spec.childrenTypes.includes(type);
  };

  // The materialization: the native type (demoted when the target is
  // ineligible — the table expands into the row-paragraphs) + the parser's
  // attrs (the required schema attrs the parser does not carry — table.cols,
  // latex.display — are supplied at the insertion).
  const material = parsed.flatMap((p): MaterializedBlock[] => {
    if (p.type === "table" && !eligible("table")) {
      return p.rows!.map((cells): MaterializedBlock => ({
        type: "paragraph",
        indent: p.indent,
        attrs: {},
        // The row's cells joined by ` | ` (the separator-row omission is
        // at the parse; the text and the inline marks stand).
        runs: cells.flatMap((cell, index) => (index === 0 ? cell : [{ text: " | ", marks: {} }, ...cell])),
      }));
    }
    const demoted = p.type === "list-item" || p.type === "quote" ? !eligible(p.type) : false;
    const type: BlockType = demoted ? "paragraph" : p.type;
    return [{ type, indent: p.indent, attrs: p.attrs, runs: p.runs, rows: p.rows }];
  });

  const delta = seatIndent - parsed[0]!.indent; // the re-base to the caret's level
  let lastTextType: BlockType | null = null;
  const clamp = (raw: number, prev: number): number => Math.max(0, Math.min(raw + delta, prev + 1));
  let prevId = seatId;
  let prevIndent = seatIndent;
  let lastTextId: BlockId | null = null;
  let lastTextLen = 0;
  let landingOffset = 0;

  // The split: the selection AND the suffix leave the seat — the
  // prefix stands, the suffix is re-seated at the end of the paste (in the
  // last pasted paragraph, or a trailing paragraph otherwise). The seat
  // that the selection empties from offset 0 is removed (the paste takes
  // its slot — the anchor is the predecessor; when the seat leads the
  // sequence the block lands at the end and moves to the first position).
  const sequenceBefore = doc.getChildren(parentId);
  const seatIndex = sequenceBefore.indexOf(seatId);
  const beforeSeat = sequenceBefore[seatIndex - 1];
  // The seat with a deeper-indent follower (its derived segment) is never
  // removed: the core's removeBlock cascades the segment (the followers'
  // content would be deleted) — the paste follows the seat instead.
  const follower = sequenceBefore[seatIndex + 1];
  const hasSegment = follower !== undefined && indentOf(doc, follower) > seatIndent;
  // keepSeat: the cross-range seam keeps its block (the first pasted line
  // merges into it — the block id stands, the peer carets rebase onto it).
  const removeSeat = prefix === "" && seat.type === "paragraph" && !hasSegment && opts?.keepSeat !== true;

  doc.transact(() => {
    doc.deleteText(seatId, from, seatText.length);

    const first = material[0]!;
    // The merge: the first pasted block continues the caret block (the same
    // text type — the block's own type and attrs stand).
    if (isTextType(first.type) && first.type === seat.type) {
      lastTextId = seatId;
      lastTextType = seat.type;
      lastTextLen = insertRuns(doc, seatId, from, first.runs);
    } else if (prefix === "" && suffix === "" && first.type !== seat.type && isTextType(first.type)) {
      // The empty caret block converts in place (the block id stands — the
      // undo chain and the peer carets rebase onto it). The non-text types
      // never convert (the core's content-loss guard): they are inserted
      // below (the empty paragraph seat is removed by the removeSeat path).
      const converted = changeToType(doc, seatId, first);
      lastTextId = seatId;
      lastTextType = converted;
      lastTextLen = first.runs.length > 0 ? insertRuns(doc, seatId, 0, first.runs) : 0;
    } else {
      const anchor = removeSeat ? (beforeSeat ?? undefined) : prevId;
      if (removeSeat) doc.removeBlock(seatId);
      const indent = clamp(first.indent, prevIndent);
      prevId = insertNative(doc, first, parentId, anchor, indent);
      if (removeSeat && beforeSeat === undefined) doc.moveBlock(prevId, parentId, 0);
      prevIndent = indent;
      const firstBlock = doc.getBlock(prevId);
      if (firstBlock !== null && isTextType(firstBlock.type)) {
        lastTextId = prevId;
        lastTextType = firstBlock.type;
        lastTextLen = doc.getText(prevId).length;
      }
    }

    for (let i = 1; i < material.length; i += 1) {
      const m = material[i]!;
      const indent = clamp(m.indent, prevIndent);
      prevId = insertNative(doc, m, parentId, prevId, indent);
      prevIndent = indent;
      if (m.type !== "table" && isTextType(m.type)) {
        lastTextId = prevId;
        lastTextType = m.type;
        lastTextLen = doc.getText(prevId).length;
      }
    }

    // The caret landing: the end of the pasted content (before the suffix —
    // the caret stands ready to continue the paste, the block's own tail
    // after it).
    landingOffset = lastTextLen;

    // The suffix: the caret block's own tail lands in the last pasted
    // paragraph (a new trailing paragraph when the last block is not one).
    if (suffix !== "") {
      if (lastTextId !== null && lastTextType === "paragraph") {
        doc.insertText(lastTextId, lastTextLen, suffix);
        lastTextLen += suffix.length;
      } else {
        const indent = clamp(parsed[parsed.length - 1]!.indent, prevIndent);
        prevId = insertBlockWithIndent(doc, "paragraph", parentId, prevId, indent);
        prevIndent = indent;
        doc.insertText(prevId, 0, suffix);
      }
    }

    // The non-text landing at the sequence end (a table / image / divider):
    // the trailing empty paragraph (the caret has nowhere to type otherwise
    // — the same contract as the slash divider).
    const sequenceNow = doc.getChildren(parentId);
    const tail = sequenceNow[sequenceNow.length - 1];
    if (tail === prevId) {
      const tailBlock = doc.getBlock(prevId);
      if (tailBlock !== null && !isTextType(tailBlock.type)) {
        prevId = insertBlockWithIndent(doc, "paragraph", parentId, prevId, 0);
      }
    }
  });

  // The caret landing: the text landing is the end of the last pasted text
  // block (when it is the paste's last block); the non-text landing (a
  // table / image / divider) seats in the sibling after the last pasted
  // block (the suffix or the trailing paragraph when the paste ends the
  // sequence — the trailing-paragraph logic guarantees the seat there).
  const lastPasted = prevId;
  if (lastTextId === lastPasted) return { blockId: lastTextId, offset: landingOffset };
  const sequence = doc.getChildren(parentId);
  const next = sequence[sequence.indexOf(lastPasted) + 1];
  return { blockId: next ?? lastPasted, offset: 0 };
}

interface MaterializedBlock {
  type: BlockType;
  /** The parser's indent (the re-base delta and the clamp at the insertion). */
  indent: number;
  attrs: Record<string, unknown>;
  runs: TextRun[];
  rows?: TextRun[][][];
}

/** The registry's content flag: the block types that hold editable text. */
function isTextType(type: BlockType): boolean {
  return BLOCK_REGISTRY[type]?.content === true;
}

/** Inserts the runs (the per-run marks) at `from`; returns the end offset. */
function insertRuns(doc: Doc, blockId: BlockId, from: number, runs: TextRun[]): number {
  let pos = from;
  for (const run of runs) {
    if (run.text === "") continue;
    doc.insertText(blockId, pos, run.text, run.marks);
    pos += run.text.length;
  }
  return pos;
}

/** The typed insertion (the core's attrs are required per type; the content
 * runs are inserted at the fresh block). */
function insertNative(
  doc: Doc,
  m: MaterializedBlock,
  parent: BlockId,
  after: BlockId | undefined,
  indent: number
): BlockId {
  const id = insertBlockOf(doc, m, parent, after, indent);
  if (m.type !== "table" && isTextType(m.type) && m.runs.length > 0) insertRuns(doc, id, 0, m.runs);
  return id;
}

function insertBlockOf(
  doc: Doc,
  m: MaterializedBlock,
  parent: BlockId,
  after: BlockId | undefined,
  indent: number
): BlockId {
  const at = { parent, after };
  switch (m.type) {
    case "heading":
      return doc.insertBlock("heading", { level: m.attrs.level as 1 | 2 | 3 | 4 | 5 | 6, indent }, at);
    case "quote":
      return doc.insertBlock("quote", indent !== 0 ? { indent } : undefined, at);
    case "list-item":
      return doc.insertBlock(
        "list-item",
        {
          list: m.attrs.list as "bullet" | "number" | "task",
          ...(m.attrs.checked !== undefined ? { checked: m.attrs.checked as boolean } : {}),
          indent,
        },
        at
      );
    case "code":
      return doc.insertBlock(
        "code",
        m.attrs.language !== undefined ? { language: m.attrs.language as string, indent } : { indent },
        at
      );
    case "latex":
      return doc.insertBlock("latex", { display: true, indent }, at);
    case "divider":
      return doc.insertBlock("divider", indent !== 0 ? { indent } : undefined, at);
    case "image":
      return doc.insertBlock("image", { src: m.attrs.src as string, indent }, at);
    case "table":
      return insertTable(doc, m, parent, after, indent);
    default:
      return insertBlockWithIndent(doc, "paragraph", parent, after, indent);
  }
}

/** The in-place conversion of the empty caret block (the typed attrs). */
function changeToType(doc: Doc, seatId: BlockId, m: MaterializedBlock): BlockType {
  const indent = indentOf(doc, seatId);
  switch (m.type) {
    case "heading":
      doc.changeBlockType(seatId, "heading", { level: m.attrs.level as 1 | 2 | 3 | 4 | 5 | 6, indent });
      return "heading";
    case "quote":
      doc.changeBlockType(seatId, "quote", indent !== 0 ? { indent } : undefined);
      return "quote";
    case "list-item":
      doc.changeBlockType(seatId, "list-item", {
        list: m.attrs.list as "bullet" | "number" | "task",
        ...(m.attrs.checked !== undefined ? { checked: m.attrs.checked as boolean } : {}),
        indent,
      });
      return "list-item";
    case "code":
      doc.changeBlockType(
        seatId,
        "code",
        m.attrs.language !== undefined ? { language: m.attrs.language as string, indent } : { indent }
      );
      return "code";
    case "latex":
      doc.changeBlockType(seatId, "latex", { display: true, indent });
      return "latex";
    default:
      doc.changeBlockType(seatId, "paragraph", indent !== 0 ? { indent } : undefined);
      return "paragraph";
  }
}

function insertBlockWithIndent(
  doc: Doc,
  type: "paragraph" | "quote",
  parent: BlockId,
  after: BlockId | undefined,
  indent: number
): BlockId {
  return type === "quote"
    ? doc.insertBlock("quote", indent !== 0 ? { indent } : undefined, { parent, after })
    : doc.insertBlock("paragraph", indent !== 0 ? { indent } : undefined, { parent, after });
}

/** The table + its rows + the cells (the ragged rows are padded at the parse). */
function insertTable(
  doc: Doc,
  m: MaterializedBlock,
  parent: BlockId,
  after: BlockId | undefined,
  indent: number
): BlockId {
  const cols = m.rows![0]!.length;
  const tableId = doc.insertBlock("table", { cols, indent }, { parent, after });
  let prevRow: BlockId | null = null;
  for (const row of m.rows!) {
    const rowId: BlockId = doc.insertBlock("table-row", undefined, { parent: tableId, after: prevRow ?? undefined });
    let prevCell: BlockId | null = null;
    for (const cell of row) {
      const cellId: BlockId = doc.insertBlock("table-cell", undefined, { parent: rowId, after: prevCell ?? undefined });
      if (cell.length > 0) insertRuns(doc, cellId, 0, cell);
      prevCell = cellId;
    }
    prevRow = rowId;
  }
  return tableId;
}

export { applyRichPaste, applyMdPaste, htmlToRuns };
