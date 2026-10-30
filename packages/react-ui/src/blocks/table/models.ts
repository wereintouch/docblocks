/** The table block's session types (the handle / the column-resize / the
 * add-chip press states — the view's live drag state, the doc's untouched
 * until the release commit).
 */
type HandleKind = "row" | "column";
type HandleAction = "insert-after" | "insert-before" | "move-next" | "move-prev" | "duplicate" | "clear" | "remove";
/**
 * The in-flight handle press: the captured geometry and the doc snapshot
 * (the widths / row ids at the press) the release commit validates against
 * (a concurrent structural change makes the drop stale — the rows resync
 * from the doc and no command issues).
 */
interface TableHandleSession {
  kind: HandleKind;
  index: number;
  rowId: string;
  cols: number;
  widths: number[] | null;
  rowIds: string[];
  startX: number;
  startY: number;
  dragging: boolean;
  /** The dragged row / column's width / height at the press (the parting preview's shift step). */
  startSize: number;
}
/**
 * The live drag preview (the moved handle's translation + the parting
 * shift of the stationary rows / columns) — view state: the doc is
 * untouched until the release commit.
 */
interface TableDragPreview {
  kind: HandleKind;
  index: number;
  dx: number;
  dy: number;
  /** The live drop index (the dragged row / column's final index; null while unmeasurable). */
  toIndex: number | null;
  /** The dragged row / column's press-time width / height (the parting step). */
  startSize: number;
}
/**
 * The in-flight column-resize press: the column (the one LEFT of the seam)
 * and the press-time width the drag's delta applies to; `width` is the
 * live (clamped) width the preview renders and the release commits.
 */
interface ColumnResizeSession {
  col: number;
  startX: number;
  startWidth: number;
  width: number;
}
/**
 * The in-flight add-chip press: the captured geometry and the press-time
 * snapshot (the row ids / the cols / the widths) the release commit
 * validates against (the stale guard, the handle's contract).
 */
interface AddChipSession {
  kind: HandleKind;
  startX: number;
  startY: number;
  dragging: boolean;
  rows: string[];
  cols: number;
  widths: number[] | null;
}

export type { AddChipSession, ColumnResizeSession, HandleAction, HandleKind, TableDragPreview, TableHandleSession };
