import type { BlockType, TextRun } from "docblocks-core";

/**
 * A merged table region of the paste material: the grid rectangle of one
 * anchor cell (the top-left corner and the effective spans the grid allows).
 */
interface TableMergeRect {
  /** The grid row of the region's top edge (0 = the first row). */
  row: number;
  /** The grid column of the region's left edge (0 = the first column). */
  col: number;
  /** The region's width in columns (>= 1). */
  colspan: number;
  /** The region's height in rows (>= 1). */
  rowspan: number;
}

/** A parsed paste block materialized into the document. */
interface MaterializedBlock {
  type: BlockType;
  /** The parser's indent (the re-base delta and the clamp at the insertion). */
  indent: number;
  attrs: Record<string, unknown>;
  runs: TextRun[];
  /** The table's even cell matrix (rows → columns → runs); the table type only. */
  rows?: TextRun[][][];
  /** The table's merged regions over the matrix's grid; the table type only. */
  merges?: TableMergeRect[];
}

export type { MaterializedBlock, TableMergeRect };
