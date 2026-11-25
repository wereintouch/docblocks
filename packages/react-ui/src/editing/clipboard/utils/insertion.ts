/**
 * The materialized block's typed insertion (the `materializePaste`'s
 * helpers): the type's insertion over the core's per-type attrs (the
 * table + its rows + the cells + the merged regions), the empty block's
 * in-place conversion (the typed attrs), and the runs' insertion (the
 * per-run marks).
 */
import { BLOCK_REGISTRY } from "docblocks-core";
import type { BlockId, BlockType, Doc, TextRun } from "docblocks-core";

import { indentOf } from "../../block-commands";
import type { MaterializedBlock, TableMergeRect } from "../models";

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

/**
 * The columns a merged region covers in the given row: the anchor's own row
 * keeps the anchor's column, the rows below lose the region's whole width.
 */
function coveredColumnsOf(merges: readonly TableMergeRect[] | undefined, row: number): number[] {
  return (merges ?? []).flatMap((rect) => {
    if (row < rect.row || row >= rect.row + rect.rowspan) return [];
    const first = row === rect.row ? rect.col + 1 : rect.col;
    return Array.from({ length: rect.col + rect.colspan - first }, (_, index) => first + index);
  });
}

/**
 * The table's row as a plain paragraph (the demotion over a parent that takes
 * no table): the cells' runs joined by the cell separator. The coordinates a
 * merged region covers hold no cell of their own, so they are not text either.
 */
function demotedTableRow(p: MaterializedBlock, row: number): MaterializedBlock {
  const covered = coveredColumnsOf(p.merges, row);
  const cells = p.rows![row]!.filter((_, col) => !covered.includes(col));
  return {
    type: "paragraph",
    indent: p.indent,
    attrs: {},
    runs: cells.flatMap((cell, index) => (index === 0 ? cell : [{ text: " | ", marks: {} }, ...cell])),
  };
}

/**
 * The table + its rows + the anchor cells: the merged regions stand the
 * anchor's own `colspan`/`rowspan` attrs and the coordinates they cover hold
 * no cell at all (the model's contract — the grid resolver derives the
 * placement). The cells of a row a region covers are bound to their grid
 * column explicitly: the insert's automatic binding is the row position, which
 * only matches while the row is full.
 */
function insertTable(
  doc: Doc,
  m: MaterializedBlock,
  parent: BlockId,
  after: BlockId | undefined,
  indent: number
): BlockId {
  const rows = m.rows!;
  const cols = rows[0]!.length;
  const merges = m.merges ?? [];
  const tableId = doc.insertBlock("table", { cols, indent }, { parent, after });
  const table = doc.getBlock(tableId);
  const columnIds = table !== null && table.type === "table" ? table.columnOrder : [];
  const spans: Array<{ cellId: BlockId; rect: TableMergeRect }> = [];
  let prevRow: BlockId | null = null;
  rows.forEach((line, row) => {
    const rowId: BlockId = doc.insertBlock("table-row", undefined, { parent: tableId, after: prevRow ?? undefined });
    prevRow = rowId;
    const covered = coveredColumnsOf(merges, row);
    const anchorColumns = line.map((_, col) => col).filter((col) => !covered.includes(col));
    let prevCell: BlockId | null = null;
    anchorColumns.forEach((col, position) => {
      const cellId: BlockId = doc.insertBlock("table-cell", undefined, { parent: rowId, after: prevCell ?? undefined });
      prevCell = cellId;
      const columnId = columnIds[col];
      if (position !== col && columnId !== undefined) doc.updateBlock(cellId, { columnId });
      const rect = merges.find((merge) => merge.row === row && merge.col === col);
      if (rect !== undefined) spans.push({ cellId, rect });
      // A cell is a mini-doc: its text stands in a child paragraph (the
      // renderer draws the children sequence, not the cell's own content;
      // a cell without a paragraph stands empty, small, and uneditable).
      const paraId = doc.insertBlock("paragraph", undefined, { parent: cellId });
      const runs = line[col]!;
      if (runs.length > 0) insertRuns(doc, paraId, 0, runs);
    });
  });
  // The spans land after every cell exists: a row under a region's row span
  // takes no cell insert at all, so the writes cannot interleave.
  for (const { cellId, rect } of spans) {
    doc.updateBlock(cellId, {
      ...(rect.colspan > 1 ? { colspan: rect.colspan } : {}),
      ...(rect.rowspan > 1 ? { rowspan: rect.rowspan } : {}),
    });
  }
  return tableId;
}

export { changeToType, demotedTableRow, insertBlockWithIndent, insertNative, insertRuns, isTextType };
