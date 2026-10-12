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
}

/** Structural description of a block type. */
interface BlockSpec {
  /** The block carries inline text content (runs). */
  content: boolean;
  /** The block carries child blocks. */
  children: boolean;
  /** The block carries row data (the `rows` map + the `rowOrder` order). */
  rows: boolean;
  /** Allowed child block types (present whenever `children` is true). */
  childrenTypes?: readonly BlockType[];
  /** Attribute schema; absent — the type has no attributes. */
  attrs?: Record<string, AttrSpec>;
}

/** The v1 block registry. */
const BLOCK_REGISTRY: Record<BlockType, BlockSpec> = {
  root: { content: false, children: true, rows: false, childrenTypes: PAGE_BLOCK_TYPES },
  paragraph: { content: true, children: false, rows: false, attrs: { align: ALIGN } },
  heading: {
    content: true,
    children: false,
    rows: false,
    attrs: { level: { kind: "enum", values: [1, 2, 3, 4, 5, 6], required: true }, align: ALIGN },
  },
  "list-item": {
    content: true,
    children: true,
    rows: false,
    childrenTypes: ["list-item"],
    attrs: {
      list: { kind: "enum", values: ["bullet", "number", "task"], required: true },
      checked: { kind: "boolean" },
      align: ALIGN,
    },
  },
  callout: {
    content: true,
    children: false,
    rows: false,
    attrs: { variant: { kind: "enum", values: ["info", "warning", "danger"] }, align: ALIGN },
  },
  code: {
    content: true,
    children: false,
    rows: false,
    attrs: { language: { kind: "string" } },
  },
  latex: {
    content: true,
    children: false,
    rows: false,
    attrs: { display: { kind: "boolean", required: true }, align: ALIGN },
  },
  table: {
    content: false,
    children: true,
    rows: false,
    childrenTypes: ["table-row"],
    attrs: { cols: { kind: "number", integer: true, min: 1, required: true } },
  },
  "table-row": { content: false, children: true, rows: false, childrenTypes: ["table-cell"] },
  "table-cell": {
    content: true,
    children: true,
    rows: false,
    childrenTypes: LEAF_BLOCK_TYPES,
    attrs: { align: ALIGN },
  },
  image: {
    content: false,
    children: false,
    rows: false,
    attrs: {
      src: { kind: "string", nonEmpty: true, required: true },
      width: { kind: "nullable-number", positive: true },
      align: { kind: "enum", values: ["left", "center", "right"] },
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
  divider: { content: false, children: false, rows: false },
  database: {
    content: false,
    children: false,
    rows: true,
    attrs: {
      columns: {
        kind: "array",
        required: true,
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
    },
  },
  // The canvas (v2, option A: canvas elements are blocks of the SAME
  // document). `surface` is the canvas container: a document may hold page
  // blocks AND a surface (page + canvas at once).
  ...CANVAS_BLOCK_SPECS,
};

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

export { BLOCK_REGISTRY, LEAF_BLOCK_TYPES, MARK_REGISTRY };
export type { AttrSpec, BlockSpec, MarkSpec };
