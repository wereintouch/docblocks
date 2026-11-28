/** The database block's registry specification. */
import { DATABASE_CELL_TYPES } from "./constants";
import type { BlockSpec } from "./registry-specs";

const DATABASE_BLOCK_SPEC: BlockSpec = {
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
    // The header row's height (px; absent = the auto height). The auto
    // height is a rendering stand, not a data bound: the data level
    // checks the positivity only.
    headerHeight: { kind: "number", positive: true },
    // The block's height (px; absent = the auto height). The auto height
    // is a rendering stand, not a data bound: the data level checks the
    // positivity only.
    height: { kind: "number", positive: true },
    views: { kind: "array" },
    viewType: { kind: "enum", values: ["table", "kanban", "calendar"] },
  },
};

export { DATABASE_BLOCK_SPEC };
