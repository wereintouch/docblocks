import { BLOCK_REGISTRY } from "docblocks-core";
import type { Block, BlockId, Doc, Selection, TextAlign, TextPoint, TextRun } from "docblocks-core";

import { markToggleAction } from "./keyboard";
import type { FormatMark } from "./keyboard";

/**
 * The cross-block range operations of the format toolbar.
 *
 * A cross range resolves per block over the engine-maintained chain: the
 * from block's tail [from.offset, end), every middle text block in full,
 * the to block's head [0, to.offset). Applying a mark is one chain command
 * (setMarkRange — one undo step, one wire update); clearing a mark runs the
 * per-block unsetMark segments in one transaction (one undo step); the
 * align is applied per chain block carrying the attr, one transaction. The
 * toolbar only surfaces a cross range when every chain text block is a
 * toolbar-eligible type: a code block in the chain disqualifies the range
 * (core rejects marks there, so the mark actions would have no target).
 */

/** The block types the toolbar formats (a text range inside one of them). */
const TOOLBAR_BLOCK_TYPES: ReadonlySet<string> = new Set(["paragraph", "heading", "list-item", "callout", "latex"]);

/** The cross-block shape of the toolbar's target range. */
interface CrossRange {
  from: TextPoint;
  to: TextPoint;
  /** The engine-maintained DFS chain (from block first, to block last). */
  chain: BlockId[];
}

/** The cross text range of a view selection (from/to in different blocks); null for a caret or a same-block range. */
function crossRangeOf(selection: Selection): CrossRange | null {
  if (selection.kind !== "text" || selection.to === null) return null;
  if (selection.from.blockId === selection.to.blockId) return null;
  return {
    from: selection.from,
    to: selection.to,
    chain: selection.blocks ?? [selection.from.blockId, selection.to.blockId],
  };
}

/** Whether every text block of the chain is a toolbar-eligible type. */
function crossRangeEligible(doc: Doc, range: CrossRange): boolean {
  for (const id of range.chain) {
    const block = doc.getBlock(id);
    if (block === null) return false;
    if (BLOCK_REGISTRY[block.type].content && !TOOLBAR_BLOCK_TYPES.has(block.type)) return false;
  }
  return true;
}

/** The per-block [from, to) segments of the range over the chain's text blocks. */
function rangeSegments(doc: Doc, range: CrossRange): [BlockId, number, number][] {
  const segments: [BlockId, number, number][] = [];
  for (const id of range.chain) {
    const block = doc.getBlock(id);
    if (block === null || !BLOCK_REGISTRY[block.type].content) continue;
    const length = doc.getTextLength(id);
    if (id === range.from.blockId) segments.push([id, range.from.offset, length]);
    else if (id === range.to.blockId) segments.push([id, 0, range.to.offset]);
    else segments.push([id, 0, length]);
  }
  return segments;
}

/** The mark toggle decision over the range: "unset" only when every non-empty segment is fully marked. */
function rangeMarkAction(doc: Doc, range: CrossRange, mark: FormatMark): "set" | "unset" {
  for (const [blockId, from, to] of rangeSegments(doc, range)) {
    if (from < to && markToggleAction(doc, blockId, from, to, mark) !== "unset") return "set";
  }
  return "unset";
}

/** Apply `mark` over the range: one chain command (one undo step, one wire update). */
function applyMarkRange(doc: Doc, range: CrossRange, mark: FormatMark): void {
  doc.setMarkRange(range.from, range.to, { type: mark });
}

/** Apply the palette target's mark with a value over the range (one command). */
function applyValueMarkRange(doc: Doc, range: CrossRange, target: "color" | "highlight", value: string): void {
  if (target === "color") doc.setMarkRange(range.from, range.to, { type: "color", value });
  else doc.setMarkRange(range.from, range.to, { type: "highlight", value });
}

/** Clear a mark over the range: the per-block segments, one transaction. */
function clearMarkRange(doc: Doc, range: CrossRange, mark: FormatMark | "color" | "highlight"): void {
  doc.transact(() => {
    for (const [blockId, from, to] of rangeSegments(doc, range)) {
      if (from < to) doc.unsetMark(blockId, from, to, mark);
    }
  });
}

/** Apply `align` to every chain block carrying the attr (one transaction). */
function applyAlignRange(doc: Doc, range: CrossRange, align: TextAlign): void {
  doc.transact(() => {
    for (const id of range.chain) {
      const block = doc.getBlock(id);
      if (block === null) continue;
      if (BLOCK_REGISTRY[block.type].attrs?.align === undefined) continue;
      doc.updateBlock(id, { align });
    }
  });
}

/** The alignment uniform over the chain's alignable blocks (undefined = none or mixed). */
function uniformAlignOfRange(doc: Doc, range: CrossRange): TextAlign | undefined {
  let value: TextAlign | undefined;
  let seen = false;
  for (const id of range.chain) {
    const block = doc.getBlock(id);
    if (block === null || BLOCK_REGISTRY[block.type].attrs?.align === undefined) continue;
    const align = alignOfBlock(block);
    if (!seen) {
      value = align;
      seen = true;
    } else if (value !== align) {
      return undefined;
    }
  }
  return value;
}

/** The current alignment of a snapshot block (absent for types without the attr). */
function alignOfBlock(block: Block): TextAlign | undefined {
  switch (block.type) {
    case "paragraph":
      return block.attrs?.align;
    case "callout":
      return block.attrs?.align;
    case "heading":
    case "latex":
    case "list-item":
      return block.attrs.align;
    default:
      return undefined;
  }
}

/**
 * The uniform value of the `color` / `highlight` mark over [from, to): the
 * value when every overlapping run carries the mark with it (a highlight
 * without a value reads as the empty string), null when no overlapping run
 * carries the mark, "mixed" otherwise.
 */
function uniformMarkValue(
  block: Block,
  from: number,
  to: number,
  mark: "color" | "highlight"
): string | null | "mixed" {
  if (!("content" in block)) return "mixed";
  const runs: TextRun[] = block.content ?? [];
  let pos = 0;
  let value: string | null | undefined;
  let seen = false;
  for (const run of runs) {
    const start = pos;
    pos += run.text.length;
    if (pos <= from || start >= to) continue;
    const read = run.marks[mark];
    const here = read === undefined ? null : (read.value ?? "");
    if (!seen) {
      value = here;
      seen = true;
    } else if (value !== here) {
      return "mixed";
    }
  }
  return seen ? (value ?? "") : null;
}

/** The uniform value of the palette target's mark over the range (null = none, "mixed"). */
function uniformMarkValueRange(doc: Doc, range: CrossRange, mark: "color" | "highlight"): string | null | "mixed" {
  let value: string | null | undefined;
  let seen = false;
  for (const [blockId, from, to] of rangeSegments(doc, range)) {
    if (from >= to) continue;
    const block = doc.getBlock(blockId);
    if (block === null) return "mixed";
    const here = uniformMarkValue(block, from, to, mark);
    if (here === "mixed") return "mixed";
    if (!seen) {
      value = here;
      seen = true;
    } else if (value !== here) {
      return "mixed";
    }
  }
  return seen ? (value ?? "") : null;
}

export {
  TOOLBAR_BLOCK_TYPES,
  alignOfBlock,
  applyAlignRange,
  applyMarkRange,
  applyValueMarkRange,
  clearMarkRange,
  crossRangeEligible,
  crossRangeOf,
  rangeMarkAction,
  uniformAlignOfRange,
  uniformMarkValue,
  uniformMarkValueRange,
};
export type { CrossRange };
