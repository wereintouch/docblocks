/** The block + mark registries: the BLOCK_REGISTRY (per the registry spec) and
 *  the MARK_REGISTRY. The specs stand in registry-specs; the constants (the
 *  alignment / indent / cell-type / width / icon) stand in constants. */
import { LEAF_BLOCK_TYPES, PAGE_BLOCK_TYPES } from "./block-type-lists";
import type { BlockType } from "./block-union";
import { CANVAS_BLOCK_SPECS } from "./canvas-registry";
import { ALIGN, CALLOUT_ICONS, DATABASE_CELL_TYPES, DEFAULT_TABLE_COLUMN_WIDTH, INDENT } from "./constants";
import type { AttrSpec, BlockSpec, MarkFieldSpec, MarkSpec } from "./registry-specs";
import type { MarkName } from "./types";

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
    attrs: {
      variant: { kind: "enum", values: ["info", "warning", "danger"] },
      // The color / icon overrides: null (or absent) = the preset per variant
      // (the null idiom — attrs are never removed, null = "override cleared").
      color: { kind: "string", hexColor: true, nullable: true },
      icon: { kind: "enum", values: CALLOUT_ICONS, nullable: true },
      align: ALIGN,
    },
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
  table: {
    content: false,
    children: true,
    rows: false,
    columnOrder: true,
    childrenTypes: ["table-row"],
    attrs: {
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
      // The column this cell belongs to (a `columnOrder` entry). Set
      // automatically by the insert path (the cell's position in the row's
      // columnOrder); the strict validator still checks the binding.
      columnId: { kind: "string", nonEmpty: true },
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

/** A multi-field attribute of an `attrs` mark (e.g. `mention`). */

const MARK_REGISTRY: Record<MarkName, MarkSpec> = {
  bold: { kind: "toggle", exclusive: false },
  italic: { kind: "toggle", exclusive: false },
  strike: { kind: "toggle", exclusive: false },
  underline: { kind: "toggle", exclusive: false },
  code: { kind: "toggle", exclusive: true },
  link: { kind: "attrs", exclusive: false, attr: "href" },
  mention: {
    kind: "attrs",
    exclusive: false,
    fields: {
      kind: { required: true, enum: ["user", "doc"] },
      id: { required: true, nonEmptyString: true },
      label: { required: true, nonEmptyString: true },
    },
  },
  color: { kind: "attrs", exclusive: false, attr: "value" },
  highlight: { kind: "attrs", exclusive: false, attr: "value", attrOptional: true },
};

export { BLOCK_REGISTRY, CALLOUT_ICONS, DEFAULT_TABLE_COLUMN_WIDTH, LEAF_BLOCK_TYPES, MARK_REGISTRY, PAGE_BLOCK_TYPES };
export type { AttrSpec, BlockSpec, MarkFieldSpec, MarkSpec };
