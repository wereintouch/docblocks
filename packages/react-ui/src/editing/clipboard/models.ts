import type { BlockType, TextRun } from "docblocks-core";

/** A parsed paste block materialized into the document. */
interface MaterializedBlock {
  type: BlockType;
  /** The parser's indent (the re-base delta and the clamp at the insertion). */
  indent: number;
  attrs: Record<string, unknown>;
  runs: TextRun[];
  rows?: TextRun[][][];
}

export type { MaterializedBlock };
