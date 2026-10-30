/** The markdown paste's parsed-line types. The constants stand in
 *  `constants.ts`.
 */
import type { TextRun } from "docblocks-core";

/** The v1 block type a parsed block materializes. */
type MdBlockType = "paragraph" | "heading" | "quote" | "list-item" | "code" | "divider" | "image" | "table";

/** A parsed paste block: the v1 type, the nesting depth, the attrs, and the text. */
interface MdPasteBlock {
  type: MdBlockType;
  /** The list/quote nesting depth (0 for the other types). */
  indent: number;
  /** The block attrs (heading `level`, the list `list` kind, `checked`, the code `language`, the image `src`). */
  attrs: Record<string, unknown>;
  /** The text content (empty for divider/image/table). */
  runs: TextRun[];
  /** The table cells (rows → cells → runs); the table type only. */
  rows?: TextRun[][][];
}

/** A paragraph line with the structural-tag literal flag (the line keeps its tags as text). */
interface MdParagraphLine {
  text: string;
  literal: boolean;
}

export type { MdBlockType, MdPasteBlock, MdParagraphLine };
