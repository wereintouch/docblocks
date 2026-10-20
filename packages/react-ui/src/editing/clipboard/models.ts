import type { BlockType, TextRun } from "docblocks-core";

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

/** A parsed paste block materialized into the document. */
interface MaterializedBlock {
  type: BlockType;
  /** The parser's indent (the re-base delta and the clamp at the insertion). */
  indent: number;
  attrs: Record<string, unknown>;
  runs: TextRun[];
  rows?: TextRun[][][];
}

export { BLOCK_TAGS };
export type { MaterializedBlock };
