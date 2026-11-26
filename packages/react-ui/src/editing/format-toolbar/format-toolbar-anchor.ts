/** The format bar's anchoring: the placement over the selection's rect and
 *  the root's stand. */
import { clamp } from "../../shared/utils";

/** The bar's inset from the editor root's edges and the selection's rect. */
const ANCHOR_GAP_PX = 8;
/** The upper room below which the bar stands under the selection. */
const ABOVE_MIN_ROOM_PX = 4;

/**
 * Places the bar above the selection's rect (below it when the upper room
 * is short) and never above the editor root's upper edge: the consumer's own
 * chrome stands there, and the bar is the editor's surface (it legitimately
 * overhangs the content's bottom — no chrome below). A model range the DOM
 * carries no rect for (the canvas/page switch re-seats the selection over a
 * re-mounted page, a parked focus) keeps the bar's last position: an empty
 * rect is no anchor, and its page-origin stand would put the bar over the
 * chrome above the editor. The unit runtime has no range geometry — the bar
 * keeps its default position there.
 */
function anchorFormatToolbar(el: HTMLElement, root: HTMLElement): void {
  if (typeof Range.prototype.getBoundingClientRect !== "function") return;
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) return;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const rootRect = root.getBoundingClientRect();
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const above = rect.top - rootRect.top - height - ANCHOR_GAP_PX;
  const top = above < ABOVE_MIN_ROOM_PX ? rect.bottom - rootRect.top + ANCHOR_GAP_PX : above;
  el.style.left = `${clamp(rect.left + rect.width / 2 - width / 2 - rootRect.left, ANCHOR_GAP_PX, Math.max(ANCHOR_GAP_PX, rootRect.width - width - ANCHOR_GAP_PX))}px`;
  el.style.top = `${Math.max(top, ANCHOR_GAP_PX)}px`;
}

export { anchorFormatToolbar };
