/** The canvas view's pure helpers: the shift-click's additive selection
 *  toggle (the anchor stands on the clicked id when it joins and keeps the
 *  old anchor when it leaves — a pure view-state mutation, no document
 *  update). */
import type { BlockId, SelectionView } from "docblocks-core";

/**
 * The shift-click selection toggle (the additive select): the id joins or
 * leaves the current block selection — the anchor stands on the clicked
 * id when it joins and keeps the old anchor (or the first remaining id)
 * when it leaves. A pure view-state mutation: no document update.
 */
function toggleCanvasSelection(view: SelectionView, id: BlockId): void {
  const sel = view.get();
  const ids = sel.kind === "blocks" ? sel.ids : [];
  if (ids.includes(id)) {
    const next = ids.filter((existing) => existing !== id);
    if (next.length === 0) {
      view.set({ kind: "none" });
      return;
    }
    const anchorId = sel.kind === "blocks" && next.includes(sel.anchorId) ? sel.anchorId : next[0]!;
    view.set({ kind: "blocks", ids: next, anchorId });
    return;
  }
  view.set({ kind: "blocks", ids: [...ids, id], anchorId: id });
}

export { toggleCanvasSelection };
