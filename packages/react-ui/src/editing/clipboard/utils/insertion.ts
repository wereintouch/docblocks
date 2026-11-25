/**
 * The materialized block's typed insertion (the `materializePaste`'s
 * helpers): the type's insertion over the core's per-type attrs (the
 * table + its rows + the cells — the ragged rows are padded at the
 * parse), the empty block's in-place conversion (the typed attrs), and
 * the runs' insertion (the per-run marks).
 */
import { BLOCK_REGISTRY } from "docblocks-core";
import type { BlockId, BlockType, Doc, TextRun } from "docblocks-core";

import { indentOf } from "../../block-commands";
import type { MaterializedBlock } from "../models";

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

export { changeToType, insertBlockWithIndent, insertNative, insertRuns, isTextType };
