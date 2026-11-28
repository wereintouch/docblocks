/** The block + mark registries: the BLOCK_REGISTRY (per the registry spec) and
 *  the MARK_REGISTRY. The specs stand in registry-specs; the constants (the
 *  alignment / indent / cell-type / width / icon) stand in constants. */
import { LEAF_BLOCK_TYPES, PAGE_BLOCK_TYPES } from "./block-type-lists";
import type { BlockType } from "./block-union";
import { CANVAS_BLOCK_SPECS } from "./canvas-registry";
import { ALIGN, CALLOUT_ICONS, DEFAULT_TABLE_COLUMN_WIDTH, INDENT } from "./constants";
import { DATABASE_BLOCK_SPEC } from "./database-registry";
import type { AttrSpec, BlockSpec, MarkFieldSpec, MarkSpec } from "./registry-specs";
import type { MarkName } from "./text";

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
      // The diagram viewport's persisted view (the mermaid preview's
      // pan/zoom the renderer restores over the reload; the plain code's
      // rendering stands them inert). Null (or absent) = the identity (the
      // null idiom — attrs are never removed, null = "view cleared").
      zoom: { kind: "nullable-number", positive: true },
      panX: { kind: "nullable-number" },
      panY: { kind: "nullable-number" },
      // The diagram viewport's stretched height (px): the mermaid
      // preview's clipped stand (the pan/zoom's window); absent or null =
      // the diagram's natural's height (the auto's stand).
      height: { kind: "nullable-number", positive: true },
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
      // The merged region's spans (default 1): the anchor cell covers the
      // rectangle; the covered cells are absent from their rows (the grid's
      // resolver stands the coordinates). The table-level bounds and the
      // overlap stand the doc validator's check (the table's shape).
      colspan: { kind: "number", integer: true, min: 1 },
      rowspan: { kind: "number", integer: true, min: 1 },
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
  file: {
    content: false,
    children: false,
    rows: false,
    attrs: {
      // The consumer-owned file id; the blob and its metadata never enter the document.
      fileId: { kind: "string", nonEmpty: true, required: true },
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
      // The persisted view (the pan/zoom the renderer restores over the
      // reload): null (or absent) = the identity (the null idiom — attrs
      // are never removed, null = "view cleared").
      zoom: { kind: "nullable-number", positive: true },
      panX: { kind: "nullable-number" },
      panY: { kind: "nullable-number" },
      // The stretched stand (px): the default (the token's minimum) over the
      // absent / the null (the null idiom).
      height: { kind: "nullable-number", positive: true },
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
  database: DATABASE_BLOCK_SPEC,
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
      // The legacy label snapshot (the pre-id-only's data): tolerated and
      // ignored — the writer stands the id-only mark.
      label: { required: false, nonEmptyString: true },
    },
  },
  color: { kind: "attrs", exclusive: false, attr: "value" },
  highlight: { kind: "attrs", exclusive: false, attr: "value", attrOptional: true },
};

/**
 * The registry's membership checks: the `in` operator is prototype-aware,
 * so an Object.prototype-reserved key (`constructor`, `toString`, …) would
 * pass it as a registered entry (the inherited function, not a spec).
 * The data-key stand is the own-property lookup: the reserved key stands
 * unknown (the lenient reader's pass-through / the strict writer's
 * rejection), never a spec.
 */
function isRegisteredBlockType(type: unknown): type is BlockType {
  return typeof type === "string" && Object.hasOwn(BLOCK_REGISTRY, type);
}

function isRegisteredMarkName(name: unknown): name is MarkName {
  return typeof name === "string" && Object.hasOwn(MARK_REGISTRY, name);
}

export {
  BLOCK_REGISTRY,
  CALLOUT_ICONS,
  DEFAULT_TABLE_COLUMN_WIDTH,
  LEAF_BLOCK_TYPES,
  MARK_REGISTRY,
  PAGE_BLOCK_TYPES,
  isRegisteredBlockType,
  isRegisteredMarkName,
};
export type { AttrSpec, BlockSpec, MarkFieldSpec, MarkSpec };
