import type { AttributeType } from "./types";

/** The registry's constants: the database cell types, the alignment + indent
 *  specs, the default table column width, and the callout icon catalog. */

/** The database cell value contracts (the column `type` values). */
const DATABASE_CELL_TYPES = ["text", "number", "checkbox", "select", "multi-select", "date"] as const;

/**
 * The document attribute's type vocabulary (the `AttributeType` union as a
 * runtime constant — the consumer's type-picker's enum + the typed value's
 * `type` field). The order is the display's order (the built-in picker's
 * stand).
 */
const ATTRIBUTE_TYPES: readonly AttributeType[] = ["string", "number", "boolean", "list", "mention"];

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

/**
 * The reserved document-attribute keys (the `DocMeta.attributes` record):
 * an attribute key must not shadow a document meta field
 * (the record and the meta map share the doc's identity surface).
 */
const RESERVED_DOC_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  "v",
  "id",
  "title",
  "avatar",
  "createdAt",
  "updatedAt",
]);

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

export {
  ALIGN,
  ATTRIBUTE_TYPES,
  CALLOUT_ICONS,
  DATABASE_CELL_TYPES,
  DEFAULT_TABLE_COLUMN_WIDTH,
  INDENT,
  RESERVED_DOC_ATTRIBUTE_KEYS,
};
