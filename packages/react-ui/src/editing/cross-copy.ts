/**
 * The copy side of the selections: the cross-block text range (the covered
 * run segments over the reading-order chain) and the blocks selection (the
 * selected blocks whole). A table the selection touches stands as ONE grid
 * piece (`copy-doc`'s table piece) — its rows / cells / text blocks never
 * stand as lines of their own.
 */
import { BLOCK_REGISTRY } from "docblocks-core";
import type { BlockId, Doc, Selection } from "docblocks-core";

import { chainBetween, isTableStructural, tablePiece, tableSubtreeOf, tablesOfChain } from "./copy-doc";
import { joinPieces, runsOf, segmentOf, textLengthOf } from "./copy-runs";
import type { ClipboardPayload, ClipboardPiece } from "./copy-runs";

/**
 * The cross-block text range's payload: the covered segment of each chain
 * block (a `<div>` per text block, the blocks joined by newlines in the
 * plain text). A table the range touches through any of its cells stands
 * as ONE table piece over its covered cells, landing where the range first
 * reaches the table (a partially covered endpoint cell is included
 * whole — the cell is the copy's unit). A non-text chain block outside the
 * tables (e.g. a divider reached by the extension) stands an empty line.
 * Null when the selection is not a cross-block range: same-block ranges
 * keep the default copy.
 */
function crossRangeClipboardContent(doc: Doc, selection: Selection): ClipboardPayload | null {
  if (selection.kind !== "text" || selection.to === null) return null;
  const from = selection.from;
  const to = selection.to;
  if (from.blockId === to.blockId) return null;
  const chain = selection.blocks ?? chainBetween(doc, from.blockId, to.blockId);
  if (chain === null) return null;
  const { tables, ownerOf } = tablesOfChain(doc, chain);
  const pieces: ClipboardPiece[] = [];
  const emitted = new Set<BlockId>();
  for (const id of chain) {
    const block = doc.getBlock(id);
    if (block === null) continue;
    // The covered table's slot: the chain's own table block (the range
    // starts before it) or the first chain block inside it — one piece per
    // table, its rows / cells / text blocks inside it.
    const tableId = block.type === "table" && tables.has(id) ? id : (ownerOf.get(id) ?? null);
    if (tableId !== null) {
      if (!emitted.has(tableId)) {
        emitted.add(tableId);
        const piece = tablePiece(doc, tableId, tables.get(tableId) ?? new Set<BlockId>());
        if (piece !== null) pieces.push(piece);
      }
      continue;
    }
    if (isTableStructural(block.type)) continue;
    const runs = runsOf(block);
    const length = textLengthOf(runs);
    const start = id === from.blockId ? from.offset : 0;
    const end = id === to.blockId ? to.offset : length;
    const segment = segmentOf(runs, Math.min(start, end), Math.max(start, end));
    pieces.push({ text: segment.text, html: `<div>${segment.html}</div>` });
  }
  return joinPieces(pieces);
}

/**
 * The blocks selection's payload (the gutter press, the image's press): the
 * selected blocks whole — a text block's runs, a table's grid (its own
 * rows / cells stand inside the grid's piece, never as lines of their
 * own). A block with no text and no grid stands nothing. Null when
 * nothing is serializable (the default copy keeps).
 */
function blocksClipboardContent(doc: Doc, ids: readonly BlockId[]): ClipboardPayload | null {
  const pieces: ClipboardPiece[] = [];
  const inTable = new Set<BlockId>();
  for (const id of ids) {
    if (inTable.has(id)) continue;
    const block = doc.getBlock(id);
    if (block === null) continue;
    if (block.type === "table") {
      const subtree = tableSubtreeOf(doc, id);
      for (const subId of subtree.ids) inTable.add(subId);
      const piece = tablePiece(doc, id, subtree.cells);
      if (piece !== null) pieces.push(piece);
      continue;
    }
    if (!BLOCK_REGISTRY[block.type].content) continue;
    const runs = runsOf(block);
    const segment = segmentOf(runs, 0, textLengthOf(runs));
    pieces.push({ text: segment.text, html: `<div>${segment.html}</div>` });
  }
  return joinPieces(pieces);
}

/**
 * The clipboard payload of a selection: the cross-block text range or the
 * blocks selection. Null when the browser's default copy owns the
 * selection (a same-block text range, a caret, the not-serializable
 * blocks).
 */
function clipboardContentOf(doc: Doc, selection: Selection): ClipboardPayload | null {
  if (selection.kind === "blocks") return blocksClipboardContent(doc, selection.ids);
  return crossRangeClipboardContent(doc, selection);
}

export { clipboardContentOf, crossRangeClipboardContent, segmentOf };
export type { ClipboardPayload };
