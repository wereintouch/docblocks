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

const IMAGE_LINE = /^ {0,3}!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)$/;

/** The highlight color of a parsed `<mark>` (the standard HTML `mark` yellow). */
const MARK_HIGHLIGHT = "#ffff00";

/**
 * A line that opens with a structural tag (the lenient paste posture: the
 * tags stay literal text, no structure is born — `h1`–`h6`, `p`, `ul`,
 * `ol`, `li`, `blockquote`, `pre`, `table`, `hr`).
 */
const STRUCTURAL_TAG_LINE = /^<\/?(?:h[1-6]|p|ul|ol|li|blockquote|pre|table|hr)(?=[\s>/])/i;

/** An open inline tag: the name, the raw attrs, the optional self-closing slash. */
const OPEN_TAG = /^<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[\w-]+(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'<>]+))?)*)\s*(\/?)>/;

/** A closing tag (dropped at the level where no opener pairs with it). */
const STRAY_CLOSE_TAG = /^<\/[a-zA-Z][a-zA-Z0-9-]*\s*\/?\s*>/;

/** The `href` attribute value (any quoting, case-insensitive). */
const TAG_HREF = /\bhref\s*=\s*("[^"]*"|'[^']*'|[^\s"'<>]+)/i;

/** The named entities the paste decodes (the pragmatic common set). */
const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "\u0027",
  nbsp: "\u00a0",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  laquo: "\u00ab",
  raquo: "\u00bb",
  middot: "\u00b7",
  bull: "\u2022",
  deg: "\u00b0",
  plusmn: "\u00b1",
  times: "\u00d7",
  divide: "\u00f7",
  euro: "\u20ac",
  pound: "\u00a3",
  cent: "\u00a2",
  yen: "\u00a5",
  szlig: "\u00df",
  sect: "\u00a7",
  para: "\u00b6",
  permil: "\u2030",
  frac12: "\u00bd",
  sup1: "\u00b9",
  sup2: "\u00b2",
  sup3: "\u00b3",
  larr: "\u2190",
  rarr: "\u2192",
  uarr: "\u2191",
  darr: "\u2193",
};

const ENTITY = /&#x([0-9a-f]+);|&#(\d+);|&([a-z][a-z0-9]*);/gi;

export { ENTITY, IMAGE_LINE, MARK_HIGHLIGHT, NAMED_ENTITIES, OPEN_TAG, STRAY_CLOSE_TAG, STRUCTURAL_TAG_LINE, TAG_HREF };
export type { MdBlockType, MdPasteBlock, MdParagraphLine };
