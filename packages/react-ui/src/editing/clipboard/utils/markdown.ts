/**
 * The multi-block markdown paste (the `text/plain` branch, always-parsed):
 * the parsed blocks (the `../../markdown` parser) are materialized into the
 * document in ONE `doc.transact` — one undo step, one wire update. The
 * caret block is split at the caret: the prefix stands in the block, the
 * first pasted block merges into it (the same text type — the block's own
 * type and attrs stand) or follows it, the text after the original caret
 * (the suffix) lands in the last pasted text block (a trailing paragraph
 * when the last block is not text). An empty caret block converts in place
 * to the first pasted block. The code target takes the raw text — no
 * parsing, no marks (the fence syntax is its data). Every block the
 * target parent does not accept is demoted (the list/quote → paragraph; the
 * table → one paragraph per row, the cells joined by ` | `) — the paste
 * never throws on legitimate markdown. The indents are re-based to the
 * caret block's level and clamped by the strict jump rule (a paste into a
 * nested context nests, not escapes). Returns the caret landing (the end
 * of the last text block — the next sibling or the seat when the landing
 * is a non-text block), or `null` when nothing was pasted.
 */
import { BLOCK_REGISTRY, InvalidAttrsError, InvalidOperationError } from "docblocks-core";
import type { BlockId, BlockType, Doc, TextRun } from "docblocks-core";

import { findParentId, indentOf } from "../../block-commands";
import { mdToBlocks } from "../../markdown";
import type { MaterializedBlock } from "../models";

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

  // The code target: the raw text, no parsing (the fence syntax is its
  // data). The clipboard's line endings are the platform's; the doc
  // model is the LF.
  if (seat.type === "code") {
    const raw = markdown.replace(/\r\n?/g, "\n");
    doc.transact(() => {
      if (to > from) doc.deleteText(seatId, from, to);
      doc.insertText(seatId, from, raw);
    });
    return { blockId: seatId, offset: from + raw.length };
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
  // attrs (the required schema attrs the parser does not carry — table.cols
  // — are supplied at the insertion).
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

  // The TO-side landing: the paste stands between the seat and the block
  // it displaces — the displaced block's pair must keep the jump rule (the
  // core rejects an insert that would dangle it), so the paste's last
  // inserted block (the one adjacent to the displaced block) must stand at
  // at least the displaced block's indent - 1. Its indent (the same re-
  // based clamp chain the transact applies) is precomputed over the seat-
  // started chain; the slide itself can only shrink the effective tail
  // (a slid anchor clamps tighter than the seat), so the precomputed
  // value is an upper bound on the tail the inserts stand — when the
  // stretch after the seat runs deeper than the bound + 1, the anchor
  // slides past it (the paste lands after the deeper run) and the insert
  // chain restarts at the anchor's indent. A rare under-slide (the bound
  // overestimates the real tail) is the core's typed rejection — the
  // catch's no-op posture below.
  const firstMerges = isTextType(material[0]!.type) && material[0]!.type === seat.type;
  const firstConverts =
    !firstMerges && prefix === "" && suffix === "" && material[0]!.type !== seat.type && isTextType(material[0]!.type);
  const lastMaterial = material[material.length - 1]!;
  const suffixOwnParagraph = suffix !== "" && !(isTextType(lastMaterial.type) && lastMaterial.type === "paragraph");
  const insertsAnything = !firstMerges || (!firstConverts && material.length > 1) || suffixOwnParagraph;
  let anchorId = seatId;
  if (!removeSeat && insertsAnything) {
    let tailIndent = seatIndent;
    for (let i = firstMerges || firstConverts ? 1 : 0; i < material.length; i += 1) {
      tailIndent = clamp(material[i]!.indent, tailIndent);
    }
    if (suffixOwnParagraph) tailIndent = clamp(parsed[parsed.length - 1]!.indent, tailIndent);
    for (let i = seatIndex + 1; i < sequenceBefore.length; i += 1) {
      const id = sequenceBefore[i];
      if (id === undefined || indentOf(doc, id) <= tailIndent + 1) break;
      anchorId = id;
    }
  }
  let prevId = removeSeat ? seatId : anchorId;
  let prevIndent = removeSeat ? seatIndent : indentOf(doc, anchorId);

  try {
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
  } catch (error) {
    // The core's typed rejection (a landing the re-based content cannot
    // keep valid — the jump rule over a block the paste displaces): the
    // transact rolled back (the doc stands, the peers converge) — the
    // paste is a no-op (the caret stands where it was). The nested call
    // (the cross-seam composition inside the caller's open transact) is
    // rethrown: the caller's batch must roll back as a whole (a partial
    // paste would stand committed next to the deleted range).
    if (error instanceof InvalidAttrsError || error instanceof InvalidOperationError) {
      if (opts?.keepSeat !== true) return { blockId: seatId, offset: from };
    }
    throw error;
  }

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
      // A cell is a mini-doc: its text stands in a child paragraph (the
      // renderer draws the children sequence, not the cell's own content;
      // a cell without a paragraph stands empty, small, and uneditable).
      const paraId = doc.insertBlock("paragraph", undefined, { parent: cellId });
      if (cell.length > 0) insertRuns(doc, paraId, 0, cell);
      prevCell = cellId;
    }
    prevRow = rowId;
  }
  return tableId;
}

export { applyMdPaste };
