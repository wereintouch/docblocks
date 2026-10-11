import type { BlockType, MarkName } from "./types";

/**
 * Block and marks registries v1.
 *
 * Single source of structural truth for the schema: everything that needs
 * block or mark structure reads these tables instead of switch-casing on
 * type names. Adding a type or a mark is an additive change (minor
 * version).
 */

/** Leaf types (no `children` of their own): the only ones allowed in cells. */
const LEAF_BLOCK_TYPES: readonly BlockType[] = [
  "paragraph",
  "heading",
  "callout",
  "code",
  "latex",
  "image",
  "embed",
  "divider",
];

/** Top-level page blocks: everything except `root` and table internals. */
const PAGE_BLOCK_TYPES: readonly BlockType[] = [
  "paragraph",
  "heading",
  "list-item",
  "callout",
  "code",
  "latex",
  "table",
  "image",
  "embed",
  "divider",
];

/** Structural description of a block attribute. */
interface AttrSpec {
  kind: "boolean" | "string" | "number" | "nullable-number" | "enum";
  /** Allowed values for `enum`. */
  values?: readonly (string | number)[];
  /** Must be present in `attrs`. */
  required?: boolean;
  /** `number`: must be an integer. */
  integer?: boolean;
  /** `number`: inclusive lower bound. */
  min?: number;
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
  /** Allowed child block types (present whenever `children` is true). */
  childrenTypes?: readonly BlockType[];
  /** Attribute schema; absent — the type has no attributes. */
  attrs?: Record<string, AttrSpec>;
}

/** The v1 block registry. */
const BLOCK_REGISTRY: Record<BlockType, BlockSpec> = {
  root: { content: false, children: true, childrenTypes: PAGE_BLOCK_TYPES },
  paragraph: { content: true, children: false },
  heading: {
    content: true,
    children: false,
    attrs: { level: { kind: "enum", values: [1, 2, 3, 4, 5, 6], required: true } },
  },
  "list-item": {
    content: true,
    children: true,
    childrenTypes: ["list-item"],
    attrs: {
      list: { kind: "enum", values: ["bullet", "number", "task"], required: true },
      checked: { kind: "boolean" },
    },
  },
  callout: {
    content: true,
    children: false,
    attrs: { variant: { kind: "enum", values: ["info", "warning", "danger"] } },
  },
  code: {
    content: true,
    children: false,
    attrs: { language: { kind: "string" } },
  },
  latex: {
    content: true,
    children: false,
    attrs: { display: { kind: "boolean", required: true } },
  },
  table: {
    content: false,
    children: true,
    childrenTypes: ["table-row"],
    attrs: { cols: { kind: "number", integer: true, min: 1, required: true } },
  },
  "table-row": { content: false, children: true, childrenTypes: ["table-cell"] },
  "table-cell": { content: true, children: true, childrenTypes: LEAF_BLOCK_TYPES },
  image: {
    content: false,
    children: false,
    attrs: {
      src: { kind: "string", nonEmpty: true, required: true },
      width: { kind: "nullable-number", positive: true },
      align: { kind: "enum", values: ["left", "center", "right"] },
    },
  },
  embed: {
    content: false,
    children: false,
    attrs: {
      kind: { kind: "enum", values: ["iframe", "github", "figma", "loom", "html"], required: true },
      src: { kind: "string", nonEmpty: true, required: true },
      title: { kind: "string" },
    },
  },
  divider: { content: false, children: false },
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
