/** The database grid's constants: the add-column type catalog, the ref form's
 *  pick sentinels, the drag / resize thresholds, the column-width bounds, and
 *  the shared cell class sets. */
import type { AddColumnTypeEntry } from "./models";

/** The add-column type catalog; `labelKey` supplies the localized menu
 *  label and the create form's name prefill. */
const ADD_COLUMN_TYPES: AddColumnTypeEntry[] = [
  { key: "text", type: "text", labelKey: "columnTypes.text" },
  { key: "integer", type: "integer", labelKey: "columnTypes.integer", numberKind: "integer" },
  { key: "decimal", type: "numeric", labelKey: "columnTypes.decimal", numberKind: "decimal" },
  { key: "checkbox", type: "boolean", labelKey: "columnTypes.checkbox" },
  { key: "date", type: "date", labelKey: "columnTypes.date" },
  { key: "datetime", type: "timestamptz", labelKey: "columnTypes.datetime" },
  { key: "enum", type: "text", labelKey: "columnTypes.enum", refKind: "enum" },
  { key: "multi-enum", type: "text", labelKey: "columnTypes.multiEnum", refKind: "enum", refMany: true },
  { key: "row-link", type: "text", labelKey: "columnTypes.rowLink", refKind: "row" },
  { key: "row-links", type: "text", labelKey: "columnTypes.rowLinks", refKind: "row", refMany: true },
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
// The header row's height (px): the resize clamp's floor when the auto
// height stands unmeasured (the header's one-line stand) and the drag's
// generous ceiling.
const MIN_DATABASE_HEADER_HEIGHT_PX = 28;
const MAX_DATABASE_HEADER_HEIGHT_PX = 600;
// The grid root's stretch mark (the `data-header-wrap`'s stand): over it
// the column's names wrap over the row's height (the auto's one-line's
// ellipsis stand stands over its absence — the structural rule lives in
// the shipped CSS, the attribute stands the measurement's suppression).
const DATABASE_HEADER_WRAP_ATTR = "data-header-wrap";
// The document block's auto height caps the grid at ten natural rows;
// the resize floor keeps three rows below the header. CSS supplies the
// row height; the numeric value is the non-layout runtime's fallback.
const DEFAULT_DATABASE_ROW_HEIGHT_PX = 32;
const AUTO_DATABASE_ROWS = 10;
const MIN_DATABASE_ROWS = 3;
const DATABASE_RESIZE_KEY_STEP_PX = 16;
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

// The grid's chrome frame: the --docblocks-* table's look (the border's
// width / color, the radius, the transparent's background) — the call
// site's classes merge over the primitive's stand (the call site's win);
// the dark's variant re-sits the same tokens. The portaled's content
// (the filter's popover) does not use it — the standard's tokens reach
// there.
const GRID_CHROME_FRAME =
  "rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width) " +
  "border-(--docblocks-table-border-color) bg-transparent " +
  "dark:border-(--docblocks-table-border-color) dark:bg-transparent";

// The chrome button's hover: the opacity's dim stand — the primitive's
// hover's background / text stand is suppressed (the grid's hover is the
// dim, not the accent's fill).
const GRID_BUTTON_HOVER =
  "cursor-pointer hover:opacity-70 hover:bg-transparent hover:text-inherit dark:hover:bg-transparent";

export {
  GRID_BUTTON_HOVER,
  GRID_CHROME_FRAME,
  GRID_DRAG_TRANSITION,
  PICKER_SIDE_OFFSET_PX,
  ADD_COLUMN_TYPES,
  AUTO_DATABASE_ROWS,
  CELL_INPUT,
  CELL_SELECTED,
  CELL_SELECTED_MULTI,
  CELL_WRAP,
  CHECKBOX_TOGGLE_GUARD_MS,
  DATABASE_RESIZE_KEY_STEP_PX,
  DEFAULT_DATABASE_COLUMN_WIDTH_PX,
  DATABASE_HEADER_WRAP_ATTR,
  DEFAULT_DATABASE_ROW_HEIGHT_PX,
  DRAG_START_THRESHOLD_PX,
  MAX_DATABASE_HEADER_HEIGHT_PX,
  MIN_DATABASE_COLUMN_WIDTH_PX,
  MIN_DATABASE_HEADER_HEIGHT_PX,
  MIN_DATABASE_ROWS,
  NEW_TABLE_PICK,
  REF_NONE_PICK,
};
