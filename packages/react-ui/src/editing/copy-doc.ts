/**
 * The copy's document graph: the reading order (the core's selection chain
 * stands on the same DFS), the parent map (a block's ancestry — a range's
 * chain may start inside a table, the table block itself outside it), and
 * the table block's grid piece — a real `<table>` over the html flavor and
 * the TSV over the plain one, so a spreadsheet's paste receives a grid
 * instead of a column of lines.
 */
import type { BlockId, Doc } from "docblocks-core";

import { cellPlainText } from "../blocks/table/utils";
import { escapeHtml } from "./copy-runs";
import type { ClipboardPiece } from "./copy-runs";

/** The document's reading order + the parent map (one DFS). */
interface DocumentIndex {
  order: BlockId[];
  parents: Map<BlockId, BlockId>;
}

/** The whole document's reading order (the DFS core's selection chain stands on) + the parent map. */
function documentIndex(doc: Doc): DocumentIndex {
  const order: BlockId[] = [];
  const parents = new Map<BlockId, BlockId>();
  const visit = (id: BlockId): void => {
    order.push(id);
    for (const child of doc.getChildren(id)) {
      parents.set(child, id);
      visit(child);
    }
  };
  visit(doc.meta.id);
  return { order, parents };
}

/**
 * The nearest ancestor of `id` of the given type (null when none; the
 * walk is bounded by the parent map, so a malformed cycle stands no hang).
 */
function ancestorOf(doc: Doc, parents: ReadonlyMap<BlockId, BlockId>, id: BlockId, type: string): BlockId | null {
  let current = parents.get(id);
  let guard = parents.size + 1;
  while (current !== undefined && guard > 0) {
    if (doc.getBlock(current)?.type === type) return current;
    current = parents.get(current);
    guard -= 1;
  }
  return null;
}

/** The table's subtree ids (its rows, its cells, and the cells' blocks) + the cells alone. */
function tableSubtreeOf(doc: Doc, tableId: BlockId): { ids: Set<BlockId>; cells: Set<BlockId> } {
  const ids = new Set<BlockId>();
  const cells = new Set<BlockId>();
  const visit = (id: BlockId): void => {
    ids.add(id);
    if (doc.getBlock(id)?.type === "table-cell") cells.add(id);
    for (const child of doc.getChildren(id)) visit(child);
  };
  for (const rowId of doc.getChildren(tableId)) visit(rowId);
  return { ids, cells };
}

/**
 * The tables a reading-order chain touches → their covered cells + the
 * chain id → its owning table (the ancestry's walk, so a cell-to-cell
 * range's chain — which starts inside the table — reaches it too).
 */
interface ChainTables {
  /** The touched table → its covered cells. */
  tables: Map<BlockId, Set<BlockId>>;
  /** The chain id inside a table → that table (the table block itself stands outside the map). */
  ownerOf: Map<BlockId, BlockId>;
}

/** The tables a reading-order chain touches (see `ChainTables`). */
function tablesOfChain(doc: Doc, chain: readonly BlockId[]): ChainTables {
  const { parents } = documentIndex(doc);
  const tables = new Map<BlockId, Set<BlockId>>();
  const ownerOf = new Map<BlockId, BlockId>();
  for (const id of chain) {
    const tableId = ancestorOf(doc, parents, id, "table");
    if (tableId === null) continue;
    ownerOf.set(id, tableId);
    let cells = tables.get(tableId);
    if (cells === undefined) {
      cells = new Set<BlockId>();
      tables.set(tableId, cells);
    }
    const cellId = ancestorOf(doc, parents, id, "table-cell");
    if (cellId !== null) cells.add(cellId);
  }
  return { tables, ownerOf };
}

/** The reading-order chain between two blocks (a mapped selection carries none). */
function chainBetween(doc: Doc, fromId: BlockId, toId: BlockId): BlockId[] | null {
  const { order } = documentIndex(doc);
  const a = order.indexOf(fromId);
  const b = order.indexOf(toId);
  if (a === -1 || b === -1) return null;
  const slice = order.slice(Math.min(a, b), Math.max(a, b) + 1);
  return a > b ? [...slice].reverse() : slice;
}

/** Whether the block is a table's own structural piece (its rows / cells). */
function isTableStructural(blockType: string): boolean {
  return blockType === "table-row" || blockType === "table-cell";
}

/**
 * A table's covered cells as one piece: a real `<table>` over the html
 * flavor (the rows' cells stand in the table's own row / column order) and
 * the TSV over the plain one — the spreadsheet's paste reads either as a
 * grid. A cell's embedded line breaks stand as `<br>` in the html; the
 * plain TSV collapses them to a space (a raw newline would break its
 * row's structure).
 */
function tablePiece(doc: Doc, tableId: BlockId, covered: ReadonlySet<BlockId>): ClipboardPiece | null {
  const htmlRows: string[] = [];
  const textRows: string[] = [];
  for (const rowId of doc.getChildren(tableId)) {
    const cells = doc.getChildren(rowId).filter((cellId) => covered.has(cellId));
    if (cells.length === 0) continue;
    const texts = cells.map((cellId) => cellPlainText(doc, cellId));
    htmlRows.push(`<tr>${texts.map((text) => `<td>${escapeHtml(text).replace(/\n/g, "<br>")}</td>`).join("")}</tr>`);
    textRows.push(texts.map((text) => text.replace(/\n/g, " ")).join("\t"));
  }
  if (htmlRows.length === 0) return null;
  return {
    text: textRows.join("\n"),
    html: `<table><tbody>${htmlRows.join("")}</tbody></table>`,
  };
}

export { chainBetween, isTableStructural, tablePiece, tableSubtreeOf, tablesOfChain };
export type { ChainTables };
