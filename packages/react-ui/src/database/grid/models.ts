/** The database grid's session + draft types: the add-column type catalog
 *  entry, the add-column form draft, the enum option draft, and the column
 *  drag / resize sessions. */

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
  /** The enum's options' draft (the create / the edit's stand — the order
   *  is the display order; the existing option's row id stands over the
   *  edit's diff, the added draft's option stands none). */
  enumOptions?: EnumOptionDraft[];
  /** The edit mode's column id (the create stands none). */
  editColumnId?: string;
}
/** The enum's option's draft row (the editor's stand — the option's
 *  label + the chip's color; the existing option's row id stands over
 *  the edit's commit's diff). */
interface EnumOptionDraft {
  rowId?: string;
  /** A stable identity for a not-yet-committed draft row (the motion's
   * reorder's key stands it — the index-based key stands the live swap's
   * identity churn). */
  uid?: string;
  name: string;
  color: string | null;
}
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
/** The in-flight column-resize press: the column (the one the seam stands
 *  at the right edge of) and the press-time width the delta applies to;
 *  `width` is the live (clamped) width the preview renders and the release
 *  commits. */
interface GridColumnResizeSession {
  col: number;
  startX: number;
  startWidth: number;
  width: number;
  visible: string[];
}

export type { AddColumnFormDraft, AddColumnTypeEntry, ColumnDragSession, GridColumnResizeSession, EnumOptionDraft };
