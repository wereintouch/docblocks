/** The database grid's constants (the add-column catalog, the number
 * form draft, the drag/resize thresholds and the column-width bounds, the
 * shared cell class sets) and the session types. */

/** The add-column type catalog (the 10 types — the plain PostgreSQL
 *  columns + the relation declarations). Every entry stands the create
 *  form (the name input + the type-specific block over it — the
 *  number's display attributes for the integer / the decimal, the ref
 *  table's pick for the enum / the row-link). */
interface AddColumnTypeEntry {
  /** The stable entry key (the `data-column-entry` attribute). */
  key: string;
  type: string;
  label: string;
  /** The number's display-attributes block (the integer / the decimal).
   *  The integer stands the `decimals: 0` stand (the field stands none),
   *  the decimal stands the decimals field. */
  numberKind?: "integer" | "decimal";
  /** The relation declaration (the enum's dict table / the row's linked
   *  table — the column's `refKind` / `refTableId` data). */
  refKind?: "enum" | "row";
  refMany?: boolean;
}
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
/** The add-column form draft (the field name + the type-specific block
 *  — the number's display attributes stand the bridge's column data;
 *  the ref table's pick / the new-table creation stand the relation's
 *  data). */
interface AddColumnFormDraft {
  key: string;
  type: string;
  name: string;
  numberKind?: "integer" | "decimal";
  decimals: number;
  thousands: boolean;
  prefix: string;
  suffix: string;
  allowNegative: boolean;
  refKind?: "enum" | "row";
  refMany?: boolean;
  /** The ref pick ("" = none, the `NEW_TABLE_PICK` stand, or a table id). */
  refPick: string;
  /** The new ref table's name (the "new table" entry's creation stand). */
  newTableName: string;
}
/** The form draft over a catalog entry (the name prefills the type's
 *  label — the create's commit takes the input's name). */
function emptyColumnForm(entry: AddColumnTypeEntry): AddColumnFormDraft {
  return {
    key: entry.key,
    type: entry.type,
    name: entry.label,
    numberKind: entry.numberKind,
    decimals: entry.numberKind === "decimal" ? 2 : 0,
    thousands: false,
    prefix: "",
    suffix: "",
    allowNegative: true,
    refKind: entry.refKind,
    refMany: entry.refMany,
    refPick: "",
    newTableName: "",
  };
}

/** The "new table" entry of the ref form's pick (the table id stand the
 *  created id, the `createTable` commit over the form's button). */
const NEW_TABLE_PICK = "__new__";
/** The "no table" stand of the ref form's pick: the package's Select
 *  (Radix) takes no empty value, so the draft's "" maps to the sentinel
 *  at the boundary (the pick over it clears the stand). */
const REF_NONE_PICK = "docblocks/ref-none";
/** The header cell's column-drag session (the press stands the snapshot;
 *  the release stands the commit). */
interface ColumnDragSession {
  columnId: string;
  index: number;
  startX: number;
  /** The visible column id sequence at the press (the stale-drop guard). */
  ids: string[];
  /** The drag has crossed the threshold (a sub-threshold press is a click). */
  started: boolean;
  /** The dragged column's width at the press (the parting preview's shift step). */
  startWidth: number;
}
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
/** The in-flight column-resize press: the column (the one the seam stands
 *  at the right edge of) and the press-time width the delta applies to;
 *  `width` is the live (clamped) width the preview renders and the release
 *  commits. */
interface ColumnResizeSession {
  col: number;
  startX: number;
  startWidth: number;
  width: number;
  visible: string[];
}
/** The empty cell's option value (the radix Select rejects the empty
 *  string; the sentinel stands the "no value" pick and commits null). */
const EMPTY_CELL_OPTION = "docblocks/empty-cell";
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
  EMPTY_CELL_OPTION,
  MIN_DATABASE_COLUMN_WIDTH_PX,
  NEW_TABLE_PICK,
  REF_NONE_PICK,
  emptyColumnForm,
};
export type { AddColumnFormDraft, AddColumnTypeEntry, ColumnDragSession, ColumnResizeSession };
