/** The canvas view's pure helpers: the shift-click's additive selection
 *  toggle (the anchor stands on the clicked id when it joins and keeps the
 *  old anchor when it leaves — a pure view-state mutation, no document
 *  update), the wheel's gesture + pan deltas, and the shape / place tool
 *  stands. */
import type { CSSProperties } from "react";

import type { Block, BlockId, SelectionView } from "docblocks-core";

import type { CanvasMode, CanvasTool } from "../../canvas";
import { pageCardStyle } from "../geometry";
import type { MovePreview } from "../viewport";
import { PLACE_TOOLS, SHAPE_TOOLS } from "./constants";
import type { PlaceTool, ShapeTool } from "./models";

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

/** The wheel's gesture: the zoom stands
 * under the active tool, the pinch (ctrl/cmd), and the hand mode without
 * the shift; the pointer mode pans (the 1:1 screen-px stand, the shift's
 * horizontal axis). */
function wheelGesture(
  mode: CanvasMode,
  tool: CanvasTool | null,
  flags: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
): "pan" | "zoom" {
  if (tool !== null || flags.ctrlKey || flags.metaKey) return "zoom";
  if (mode === "pan" && !flags.shiftKey) return "zoom";
  return "pan";
}

/** The wheel-pan's axis deltas (screen px, the 1:1 stand): the content
 * moves OPPOSITE to the wheel's delta (the inversion — the wheel down
 * stands the canvas up). The shift stands the horizontal
 * axis only (the browser maps the shifted vertical wheel onto deltaX;
 * the unconverted notch takes the deltaY fallback). */
function wheelPanDeltas(deltaX: number, deltaY: number, shiftKey: boolean): { dx: number; dy: number } {
  if (!shiftKey) return { dx: -deltaX || 0, dy: -deltaY || 0 };
  const x = deltaX !== 0 ? deltaX : deltaY;
  return { dx: -x || 0, dy: 0 };
}

/** The shape tool's stand (the drag-to-size session's gate, against the
 * click-to-place tools). */
function isShapeTool(tool: CanvasTool): tool is ShapeTool {
  return (SHAPE_TOOLS as readonly CanvasTool[]).includes(tool);
}

/** The place tool's stand (the drag-to-size session's gate, against the
 * click-to-place tools — the shapes + the container). */
function isPlaceTool(tool: CanvasTool): tool is PlaceTool {
  return (PLACE_TOOLS as readonly CanvasTool[]).includes(tool);
}

/** The page miniature's display style (the committed style + the session
 * previews: the move offset, the resize box — the same composition as
 * the CanvasItem's): the root's geometry over the world's origin anchor,
 * the in-flight previews over the committed stand (the preview stands
 * the commit's numbers). */
function pageCardDisplayStyleOf(
  root: Block,
  handleTarget: { id: BlockId; box: { x: number; y: number; w: number; h: number } } | null,
  rootBlockId: BlockId,
  viewport: {
    movePreview: MovePreview | null;
    resizePreview: { id: string; box: { x: number; y: number; w: number; h: number } } | null;
  }
): CSSProperties {
  const style = pageCardStyle(root);
  if (handleTarget === null || handleTarget.id !== rootBlockId) return style;
  const isMoving = viewport.movePreview !== null && viewport.movePreview.ids.includes(rootBlockId);
  const previewBox =
    viewport.resizePreview !== null && viewport.resizePreview.id === rootBlockId ? viewport.resizePreview.box : null;
  if (isMoving === false && previewBox === null) return style;
  if (previewBox !== null) {
    style.left = `calc(50% + ${previewBox.x}px)`;
    style.top = `calc(50% + ${previewBox.y}px)`;
    style.width = `${previewBox.w}px`;
    style.height = `${previewBox.h}px`;
  }
  const parts = ["translate(-50%, -50%)"];
  if (isMoving) parts.push(`translate(${viewport.movePreview!.dx}px, ${viewport.movePreview!.dy}px)`);
  style.transform = parts.join(" ");
  // The drag's own composited layer (the CanvasItem's parity): the
  // WebKit family repaints the moved card's selection ring unreliably
  // over a transform-only change.
  style.willChange = "transform";
  return style;
}

export { isPlaceTool, isShapeTool, pageCardDisplayStyleOf, toggleCanvasSelection, wheelGesture, wheelPanDeltas };
