/** The undo/redo's selection reseat: the window over the remount's
 *  transient selection loss and the re-run schedule. */
import type { Doc, Selection, SelectionView } from "docblocks-core";

import { reseatHistorySelection } from "../block-commands";

/**
 * The history reseat's window over the undo/redo (the remount's transient
 * selection loss's stand): the window's end stands the mapping's none's
 * suppression. The engine's remount commit + the selectionchange's settle
 * stands the sub-second over the load, so the window stands a margin over
 * it (the staleness is bounded by the window's end; the explicit paths —
 * the Escape, the gutter's reset — stand the real clear).
 */
const RESEAT_WINDOW_MS = 2000;

/**
 * The undo/redo's reseat over the engine's event ordering: the fast path
 * re-reads the view over the synchronous read (the restoration's stand
 * lands inside the undo/redo call), and the window's stand re-runs the
 * reseat when the restoration's emission lands over the transaction's
 * settle (the engine's ordering stands the popped's event after the
 * handler's return — the reseat then reads the restored state). The
 * reseat's own stands (the user's live selection's stop, the seated's
 * short-circuit) keep the re-runs from clobbering.
 */
function scheduleHistoryReseat(doc: Doc, view: SelectionView | null, root: HTMLDivElement | null): void {
  if (view === null) return;
  const scope = root ?? document;
  const run = (): void => {
    reseatHistorySelection(doc, view, scope);
  };
  run();
  let alive = true;
  const unsubscribe = view.onChange((selection: Selection) => {
    if (!alive) return;
    if (selection.kind !== "text") return;
    // The frame's delay over the emit's read: the emit may be the
    // transaction's rebase (the intermediate state the popped event's
    // restoration overwrites in the same commit phase) — the frame stands
    // the commit's settle, and the read gets the restored state, not the
    // rebased residue (a residue seat lands at the block's edge over the
    // pre-gesture's and outlives the watch's deadline).
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => alive && run());
    else window.setTimeout(() => alive && run(), 0);
  });
  window.setTimeout(() => {
    alive = false;
    unsubscribe();
  }, RESEAT_WINDOW_MS);
}

export { RESEAT_WINDOW_MS, scheduleHistoryReseat };
