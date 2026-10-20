import { LEAF_BLOCK_TYPES, PAGE_BLOCK_TYPES } from "./block-type-lists";
import type { BlockType } from "./block-union";
import { CANVAS_BLOCK_SPECS } from "./canvas-registry";
import type { MarkName } from "./types";

/**
 * Block and marks registries v1.
 *
 * Single source of structural truth for the schema: everything that needs
 * block or mark structure reads these tables instead of switch-casing on
 * type names. Adding a type or a mark is an additive change (minor
 * version).
 */

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

/** Structural description of a block attribute. */
interface AttrSpec {
  kind: "boolean" | "string" | "number" | "nullable-number" | "enum" | "object" | "array";
  /** Allowed values for `enum`. */
  values?: readonly (string | number)[];
  /** `object`: the nested field specs, each validated as its own AttrSpec. */
  fields?: Record<string, AttrSpec>;
  /** `array`: the item spec, each array element validated against it. */
  items?: AttrSpec;
  /** Must be present in `attrs`. */
  required?: boolean;
  /** `number`: must be an integer. */
  integer?: boolean;
  /** `number`: inclusive lower bound. */
  min?: number;
  /** `number`: inclusive upper bound. */
  max?: number;
  /** `number`: must be > 0. */
  positive?: boolean;
  /** `string`: must be non-empty. */
  nonEmpty?: boolean;
  /** `string`: must be a hex color #RRGGBB(AA). */
  hexColor?: boolean;
}

/** Structural description of a block type. */
interface BlockSpec {
  /** The block carries inline text content (runs). */
  content: boolean;
  /** The block carries child blocks in the WRITER contract (the field is read and written). */
  children: boolean;
  /** The block carries row data (the `rows` map + the `rowOrder` order). */
  rows: boolean;
  /** Allowed child block types (present whenever `children` is true). */
  childrenTypes?: readonly BlockType[];
  /**
   * The LEGACY child types: the `children` field of these remodeled page
   * types stays VALID v1 data (the nesting form that predates the flat
   * page model), with this child-type rule; `flattenDoc` normalizes it to
   * `indent`, and the writer never emits it. Absent — `children` is
   * rejected on the type.
   */
  legacyChildrenTypes?: readonly BlockType[];
  /**
   * The children array is a FLAT PAGE SEQUENCE: `indent`
   * applies and the indent-jump rule is checked over it. Structural order
   * without this flag: `table-row` (grid positions), `surface` (z-order).
   */
  sequence?: boolean;
  /** Attribute schema; absent — the type has no attributes. */
  attrs?: Record<string, AttrSpec>;
}

/** The v1 block registry. */
const BLOCK_REGISTRY: Record<BlockType, BlockSpec> = {
  root: { content: false, children: true, rows: false, childrenTypes: PAGE_BLOCK_TYPES, sequence: true },
  paragraph: {
    content: true,
    children: false,
    rows: false,
    legacyChildrenTypes: PAGE_BLOCK_TYPES,
    attrs: { align: ALIGN },
  },
  heading: {
    content: true,
    children: false,
    rows: false,
    legacyChildrenTypes: PAGE_BLOCK_TYPES,
    attrs: { level: { kind: "enum", values: [1, 2, 3, 4, 5, 6], required: true }, align: ALIGN },
  },
  "list-item": {
    content: true,
    children: false,
    rows: false,
    legacyChildrenTypes: ["list-item"],
    attrs: {
      list: { kind: "enum", values: ["bullet", "number", "task"], required: true },
      checked: { kind: "boolean" },
      align: ALIGN,
    },
  },
  quote: {
    content: true,
    children: false,
    rows: false,
    legacyChildrenTypes: PAGE_BLOCK_TYPES,
    attrs: { align: ALIGN },
  },
  callout: {
    content: true,
    children: false,
    rows: false,
    legacyChildrenTypes: PAGE_BLOCK_TYPES,
    attrs: { variant: { kind: "enum", values: ["info", "warning", "danger"] }, align: ALIGN },
  },
  code: {
    content: true,
    children: false,
    rows: false,
    legacyChildrenTypes: PAGE_BLOCK_TYPES,
    attrs: {
      language: { kind: "string" },
      collapsed: { kind: "boolean" },
      caption: { kind: "string" },
      lineNumbers: { kind: "boolean" },
      wrap: { kind: "boolean" },
      mermaidMode: { kind: "enum", values: ["code", "preview"] },
    },
  },
  latex: {
    content: true,
    children: false,
    rows: false,
    legacyChildrenTypes: PAGE_BLOCK_TYPES,
    attrs: { display: { kind: "boolean", required: true }, align: ALIGN },
  },
  table: {
    content: false,
    children: true,
    rows: false,
    childrenTypes: ["table-row"],
    attrs: {
      cols: { kind: "number", integer: true, min: 1, required: true },
      // The per-column widths, in column order (the entry follows the
      // column through a move/duplicate); absent — every column takes the
      // reader's default width.
      columnWidths: { kind: "array", items: { kind: "number", min: 50 } },
    },
  },
  "table-row": { content: false, children: true, rows: false, childrenTypes: ["table-cell"] },
  "table-cell": {
    content: true,
    children: true,
    rows: false,
    childrenTypes: LEAF_BLOCK_TYPES,
    sequence: true,
    attrs: {
      align: ALIGN,
      // The two background layers: the column color (set column-wide) is
      // the priority layer, the row color stands underneath it.
      columnColor: { kind: "string", hexColor: true },
      rowColor: { kind: "string", hexColor: true },
    },
  },
  image: {
    content: false,
    children: false,
    rows: false,
    attrs: {
      src: { kind: "string", nonEmpty: true, required: true },
      // The display width in px (the figure's aspect ratio stands — the
      // height follows); absent or null = the editor's full width. The
      // renderer never draws the figure wider than the editor (the
      // max-width clamp), so the port drag's upper bound is the editor.
      width: { kind: "nullable-number", positive: true },
      // The figure's horizontal placement at a reduced width (the editor's
      // full width ignores it — there is nothing to place). "left" is the
      // absent attr (updateBlock never removes, so "left" restores it).
      align: { kind: "enum", values: ["left", "center", "right"] },
      // The caption line below the figure (the code block's caption idiom;
      // the empty string is the removed state — the attrs are never removed).
      caption: { kind: "string" },
    },
  },
  embed: {
    content: false,
    children: false,
    rows: false,
    attrs: {
      kind: { kind: "enum", values: ["iframe", "github", "figma", "loom", "html"], required: true },
      src: { kind: "string", nonEmpty: true, required: true },
      title: { kind: "string" },
    },
  },
  "sync-embed": {
    content: false,
    children: false,
    rows: false,
    attrs: {
      ref: {
        kind: "object",
        required: true,
        fields: {
          docId: { kind: "string", nonEmpty: true, required: true },
          blockId: { kind: "string", nonEmpty: true },
        },
      },
    },
  },
  divider: { content: false, children: false, rows: false, attrs: { indent: INDENT } },
  database: {
    content: false,
    children: false,
    rows: true,
    attrs: {
      // The inline form's schema (the external form — the `tableId`
      // reference — carries no columns; the cross-field mutual exclusion
      // stands in the validator's database branch, like the type-dependent
      // options presence).
      columns: {
        kind: "array",
        items: {
          kind: "object",
          fields: {
            id: { kind: "string", nonEmpty: true, required: true },
            name: { kind: "string", nonEmpty: true, required: true },
            type: { kind: "enum", values: DATABASE_CELL_TYPES, required: true },
            // The value contract itself (an array of non-empty strings);
            // the type-dependent presence is checked by the validator's
            // database branch.
            options: { kind: "array", items: { kind: "string", nonEmpty: true } },
          },
        },
      },
      // The external form's table reference (the consumer's relational
      // table id; the rows and the schema live there).
      tableId: { kind: "string", nonEmpty: true },
      // The block's display name (the external-form view state): the grid's
      // title line; absent or empty = the bridge's table name stands
      // (the empty string is the "remove the override" idiom — attrs are
      // never removed through updateBlock).
      name: { kind: "string" },
      // The external-form view state (CRDT data): the recursive and/or
      // row filter (the structure is checked by the validator's database
      // branch — the recursion is not expressible in the flat AttrSpec),
      // the column display order / the hidden columns, the saved views,
      // and the current view type (the v1 set).
      filter: { kind: "object" },
      columnOrder: { kind: "array", items: { kind: "string", nonEmpty: true } },
      hiddenColumns: { kind: "array", items: { kind: "string", nonEmpty: true } },
      // The per-visible-column widths (px; absent entry = the reader's
      // default width), like the table's columnWidths.
      columnWidths: { kind: "array", items: { kind: "number", min: 50 } },
      views: { kind: "array" },
      viewType: { kind: "enum", values: ["table", "kanban", "calendar"] },
    },
  },
  // The canvas (v2, option A: canvas elements are blocks of the SAME
  // document). `surface` is the canvas container: a document may hold page
  // blocks AND a surface (page + canvas at once).
  ...CANVAS_BLOCK_SPECS,
};

// The flat page model: every page-sequence type carries the optional
// `indent` attr (structural-context types do not). Kept registry-driven:
// the page set is the type list, not a validator branch.
for (const type of PAGE_BLOCK_TYPES) {
  BLOCK_REGISTRY[type].attrs = { ...BLOCK_REGISTRY[type].attrs, indent: INDENT };
}

/** Structural description of a mark. */
interface MarkSpec {
  /** `toggle`: the mark value is `true`; `attrs`: the value is an object. */
  kind: "toggle" | "attrs";
  /** Exclusive marks never coexist with other marks on a run. */
  exclusive: boolean;
  /** Attribute name for `attrs` marks. */
  attr?: "href" | "value" | "tex";
  /** Whether the attribute may be absent (highlight). */
  attrOptional?: boolean;
}

/** The v1 marks registry. */
const MARK_REGISTRY: Record<MarkName, MarkSpec> = {
  bold: { kind: "toggle", exclusive: false },
  italic: { kind: "toggle", exclusive: false },
  strike: { kind: "toggle", exclusive: false },
  underline: { kind: "toggle", exclusive: false },
  code: { kind: "toggle", exclusive: true },
  link: { kind: "attrs", exclusive: false, attr: "href" },
  color: { kind: "attrs", exclusive: false, attr: "value" },
  highlight: { kind: "attrs", exclusive: false, attr: "value", attrOptional: true },
  math: { kind: "attrs", exclusive: true, attr: "tex" },
};

export { BLOCK_REGISTRY, LEAF_BLOCK_TYPES, MARK_REGISTRY, PAGE_BLOCK_TYPES };
export type { AttrSpec, BlockSpec, MarkSpec };
