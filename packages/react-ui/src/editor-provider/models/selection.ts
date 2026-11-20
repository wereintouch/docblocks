/** The per-instance selection handle (the view + the history reseat's
 *  window). */
import type { SelectionView } from "docblocks-core";

/** The per-instance selection view; null before the mount effect ran and after unmount. */
interface SelectionRef {
  view: SelectionView | null;
  /**
   * The history reseat's window end (the epoch ms): the undo/redo's remount
   * stands the engine's transient selection loss, and the gesture-time and
   * event-based mappings' none push stands the remount's residue over the
   * window (not the user's clear — the real clear stands the explicit
   * paths: the Escape, the editor's outside's focus).
   */
  reseatUntil: { current: number };
}

export type { SelectionRef };
