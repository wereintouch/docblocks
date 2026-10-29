/** The motion editor's constants (the enter/exit geometry, the
 *  transition, the slide settle window, the drag affordance style, the
 *  text-row gutter types) and the row's props. */
import type { FlatNode } from "../blocks";

/**
 * The enter/exit geometry of a row. The spacing margin collapses on exit
 * so a leaving row does not keep its gap.
 */
const ENTER = { opacity: 0, height: 0 } as const;
const ANIMATE = { opacity: 1, height: "auto" } as const;
const EXIT = { opacity: 0, height: 0, marginBottom: 0 } as const;

/**
 * The enter/exit and layout-slide transition (one snappy ease). The
 * between-rows reflow while a drag runs (the rows slide into each crossed
 * slot) runs the layout arm of this transition (gated per-value: 0 while
 * the slide is disarmed).
 */
const TRANSITION = { duration: 0.18, ease: "easeOut" } as const;

/** How long the layout slide stays armed after a structural render (the slide itself runs 0.18s). */
const SLIDE_SETTLE_MS = 400;

/**
 * The drag affordance: the handle shows the grab cursor in this view
 * only — the rule is scoped to the root attribute below, so the base
 * editor keeps the stylesheet's plain pointer cursor.
 */
const HANDLE_GRAB_STYLE = '[data-docblocks-motion] [data-slot="docblocks/gutter"] { cursor: grab; }';

/** The text types whose built-in renderer renders the row's gutter handle (the row-level one stands for every other type). */
const TEXT_ROW_TYPES = new Set(["paragraph", "quote", "heading", "callout", "list-item", "code"]);

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

export { ANIMATE, ENTER, EXIT, HANDLE_GRAB_STYLE, SLIDE_SETTLE_MS, TEXT_ROW_TYPES, TRANSITION };
export type { RowItemProps };
