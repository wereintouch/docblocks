/** The registry's constants: the database cell types, the alignment + indent
 *  specs, the default table column width, and the callout icon catalog. */

/** The database cell value contracts (the column `type` values). */
const DATABASE_CELL_TYPES = ["text", "number", "checkbox", "select", "multi-select", "date"] as const;

/** The horizontal text alignment, shared by the text block types. */
const ALIGN = { kind: "enum", values: ["left", "center", "right"] } as const;

/**
 * The flat-page nesting depth: a non-negative integer, default
 * 0, relative to the preceding block of the same page sequence. Carried by
 * every page-sequence type only.
 */
const INDENT = { kind: "number", integer: true, min: 0 } as const;

/** The default table column width (px) — the stand for an absent `columnWidths` entry. */
const DEFAULT_TABLE_COLUMN_WIDTH = 100;

const CALLOUT_ICONS: readonly string[] = [
  "info",
  "triangle-alert",
  "circle-x",
  "circle-check",
  "circle-help",
  "lightbulb",
  "message-square",
  "star",
  "heart",
  "zap",
  "flag",
  "lock",
  "shield",
  "book-open",
  "ban",
  "eye",
  "sparkles",
  "check",
];

/** The v1 block registry. */

export { ALIGN, CALLOUT_ICONS, DATABASE_CELL_TYPES, DEFAULT_TABLE_COLUMN_WIDTH, INDENT };
