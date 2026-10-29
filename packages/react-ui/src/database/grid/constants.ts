/** The database grid's constants: the add-column type catalog, the ref form's
 *  pick sentinels, the drag / resize thresholds, the column-width bounds, and
 *  the shared cell class sets. */
import type { AddColumnTypeEntry } from "./models";

const ADD_COLUMN_TYPES: AddColumnTypeEntry[] = [
  { key: "text", type: "text", label: "Text" },
  { key: "integer", type: "integer", label: "Integer", numberKind: "integer" },
  { key: "decimal", type: "numeric", label: "Decimal", numberKind: "decimal" },
  { key: "checkbox", type: "boolean", label: "Checkbox" },
  { key: "date", type: "date", label: "Date" },
  { key: "datetime", type: "timestamptz", label: "Date & time" },
  { key: "enum", type: "text", label: "Enum", refKind: "enum" },
  { key: "multi-enum", type: "text", label: "Multi-enum", refKind: "enum", refMany: true },
  { key: "row-link", type: "text", label: "Row link", refKind: "row" },
  { key: "row-links", type: "text", label: "Row links", refKind: "row", refMany: true },
];
/** The "new table" entry of the ref form's pick (the table id stand the
 *  created id, the `createTable` commit over the form's button). */
const NEW_TABLE_PICK = "__new__";
/** The "no table" stand of the ref form's pick: the package's Select
 *  (Radix) takes no empty value, so the draft's "" maps to the sentinel
 *  at the boundary (the pick over it clears the stand). */
const REF_NONE_PICK = "docblocks/ref-none";
/** The drag's start threshold (px): below it the press is a menu click. */
const DRAG_START_THRESHOLD_PX = 4;
// The boolean's toggle guard: the interactive click's toggle and the
// double press's dblclick stand over one gesture (the browser's
// double-click window), not two toggles.
const CHECKBOX_TOGGLE_GUARD_MS = 600;
// The column widths (px): the fluid track's default (7rem — the grid's
// `minmax(7rem, 1fr)`) and the resize floor (like the table block's seam).
const DEFAULT_DATABASE_COLUMN_WIDTH_PX = 112;
const MIN_DATABASE_COLUMN_WIDTH_PX = 50;
/** The shared cell wrapper classes (the left border + the padding). */
const CELL_WRAP =
  "flex min-h-6 min-w-0 items-center overflow-hidden border-(--docblocks-table-border-color) p-(--docblocks-table-cell-padding)";
/** The selected cell's stand (the shared canvas selection token: the
 *  theme's selection tint + the thin cyan outline over it — the figure
 *  outline's stand). */
/** The cell's selection stand (the sole selection): the canvas figure's
 *  outline tokens over the selection tint. The offset is the negative
 *  (the inset frame): the leftmost column's / rightmost column's / last
 *  row's cell stands the four sides — the outset frame over the scroll
 *  container's content edge stands clipped (the table's w-full grid
 *  stands no padding over the scroller). */
const CELL_SELECTED =
  "bg-(--docblocks-selected-background) outline-(length:--docblocks-canvas-selection-border-width) outline-offset-[-1px] outline-(--docblocks-canvas-selection-border-color) outline-solid";
/** The multi-selection's cell stand: the fill only (the outline stands
 *  the sole selection — a multi-region stands the frame on no cell). The
 *  canvas selection's fill (the border token at 50% — the figure
 *  selection's transparency). */
const CELL_SELECTED_MULTI = "bg-(--docblocks-canvas-selection-fill)";
/** The input's shared classes: no own border (the cell's border stands —
 *  the double border is gone), the focus stands the background tint. The
 *  table's `select-none` stands the edit's own text selection (the mouse
 *  selection inside the input is the edit's stand). */
const CELL_INPUT =
  "w-full select-text rounded-(--docblocks-radius) border-0 bg-transparent px-1 text-(length:--docblocks-font-size) outline-none focus:bg-(--docblocks-selected-background)/50";

export {
  ADD_COLUMN_TYPES,
  CELL_INPUT,
  CELL_SELECTED,
  CELL_SELECTED_MULTI,
  CELL_WRAP,
  CHECKBOX_TOGGLE_GUARD_MS,
  DEFAULT_DATABASE_COLUMN_WIDTH_PX,
  DRAG_START_THRESHOLD_PX,
  MIN_DATABASE_COLUMN_WIDTH_PX,
  NEW_TABLE_PICK,
  REF_NONE_PICK,
};
