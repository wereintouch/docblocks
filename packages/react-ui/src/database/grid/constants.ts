/** The database grid's constants: the add-column type catalog, the ref form's
 *  pick sentinels, the drag / resize thresholds, the column-width bounds, and
 *  the shared cell class sets. */
import type { AddColumnTypeEntry } from "./models";

/** The add-column type catalog (the `label` is the form's `name` prefill —
 *  the document data; the `labelKey` is the menu's i18n key, the
 *  `database` namespace's `columnTypes.*`). */
const ADD_COLUMN_TYPES: AddColumnTypeEntry[] = [
  { key: "text", type: "text", label: "Text", labelKey: "columnTypes.text" },
  { key: "integer", type: "integer", label: "Integer", labelKey: "columnTypes.integer", numberKind: "integer" },
  { key: "decimal", type: "numeric", label: "Decimal", labelKey: "columnTypes.decimal", numberKind: "decimal" },
  { key: "checkbox", type: "boolean", label: "Checkbox", labelKey: "columnTypes.checkbox" },
  { key: "date", type: "date", label: "Date", labelKey: "columnTypes.date" },
  { key: "datetime", type: "timestamptz", label: "Date & time", labelKey: "columnTypes.datetime" },
  { key: "enum", type: "text", label: "Enum", labelKey: "columnTypes.enum", refKind: "enum" },
  {
    key: "multi-enum",
    type: "text",
    label: "Multi-enum",
    labelKey: "columnTypes.multiEnum",
    refKind: "enum",
    refMany: true,
  },
  { key: "row-link", type: "text", label: "Row link", labelKey: "columnTypes.rowLink", refKind: "row" },
  {
    key: "row-links",
    type: "text",
    label: "Row links",
    labelKey: "columnTypes.rowLinks",
    refKind: "row",
    refMany: true,
  },
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
/** The input's shared classes over the `Input` primitive's sm base: no
 *  own border (the cell's border stands — the double border is gone), the
 *  focus stands the background tint. The table's `select-none` stands the
 *  edit's own text selection (the mouse selection inside the input is the
 *  edit's stand). */
const CELL_INPUT =
  "select-text rounded-(--docblocks-radius) border-0 bg-transparent px-1 " +
  "text-(length:--docblocks-font-size) focus:bg-(--docblocks-selected-background)/50 dark:bg-transparent";

const PICKER_SIDE_OFFSET_PX = 4;

const GRID_DRAG_TRANSITION = "transform 120ms ease-out";

export {
  GRID_DRAG_TRANSITION,
  PICKER_SIDE_OFFSET_PX,
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
