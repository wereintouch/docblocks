/** The motion editor's row props: the position-only layout slide armed
 * (a drag in flight, a structural settle), the dragged row flag (the
 * zIndex keeps it above the sliding siblings), the in-flight seam
 * candidate (the drag's live preview — a pure preview, the doc/wire/store
 * are untouched; the drop's commit applies the same value), the
 * enter-animation gate (the editor saw a text input — a row that mounts
 * while the gate stands closed renders its animate values at once), the
 * drag session start / release / live seam-candidate update. */
import type { FlatNode } from "../blocks";

interface RowItemProps {
  node: FlatNode;
  /** The position-only layout slide armed (a drag in flight, a structural settle): selects the rows' layout transition. */
  layoutSlide: boolean;
  /** This row is the one being dragged (the zIndex keeps it above the sliding siblings). */
  isDragged: boolean;
  /**
   * The in-flight seam candidate (the dragged row only, the drag's live
   * preview): the row's left padding stands at the candidate's steps
   * instead of the row's own indent — a pure preview (the doc, the wire,
   * and the store are untouched); the drop's commit applies the same
   * value, so the preview stands where the drop lands.
   */
  previewIndent: number | null;
  /**
   * The enter-animation gate is open (the editor saw a text input): this
   * row's mount runs the enter animation (ENTER). A row that mounts while
   * the gate stands closed (the mount, the sync load) renders its animate
   * values at once (initial={false} — no height-growth animation).
   */
  animated: boolean;
  /** The row's drag session start (from its gutter handle's pointerdown). */
  onDragStart: () => void;
  /** The row's release: the flat-range commit for this block. */
  onDragEnd: (event: PointerEvent | MouseEvent | TouchEvent) => void;
  /** The drag's live seam-candidate update (the preview's source). */
  onDragMove: (event: PointerEvent | MouseEvent | TouchEvent) => void;
}

export type { RowItemProps };
