/** The canvas fit: the content's union box
 * (the page miniature + the surface items + the connector's free points)
 * centered at the viewport's center at the smallest zoom that fits both
 * axes, clamped at the 25%–400% bounds. Pure view state — the zoom / pan
 * stand, nothing is written. */
import type { Doc } from "docblocks-core";

import { effectiveGeometry } from "../blocks/canvas-geometry";
import type { Box, ScreenPoint } from "./viewport";
import { MAX_ZOOM, MIN_ZOOM } from "./viewport";

/**
 * The canvas content's union box (the canvas world coords, the
 * center-anchor space): the page miniature's effective box + every
 * surface item's effective box + the connector's free endpoint points
 * (the connector carries no own box; its block-ref endpoints stand the
 * referenced item's box). Null when no surface content stands (the empty
 * canvas — the fit's no-op stand: the page miniature alone is not
 * content — fitting the blank card's box would move the zoom for
 * nothing).
 */
function canvasContentBox(doc: Doc): Box | null {
  const root = doc.getBlock(doc.meta.id);
  if (root === null) return null;
  const miniature = effectiveGeometry(root);
  let minX = miniature.x - miniature.w / 2;
  let minY = miniature.y - miniature.h / 2;
  let maxX = miniature.x + miniature.w / 2;
  let maxY = miniature.y + miniature.h / 2;
  let content = false;
  for (const surfaceId of doc.getChildren(doc.meta.id)) {
    const surface = doc.getBlock(surfaceId);
    if (surface === null || surface.type !== "surface") continue;
    for (const childId of doc.getChildren(surfaceId)) {
      const child = doc.getBlock(childId);
      if (child === null) continue;
      if (child.type === "connector") {
        for (const ref of [child.attrs.start, child.attrs.end]) {
          // The free point stand (no block / doc ref): the union's point.
          if (ref.docId === undefined && ref.blockId === undefined && ref.x !== undefined && ref.y !== undefined) {
            content = true;
            minX = Math.min(minX, ref.x);
            minY = Math.min(minY, ref.y);
            maxX = Math.max(maxX, ref.x);
            maxY = Math.max(maxY, ref.y);
          }
        }
        continue;
      }
      content = true;
      const box = effectiveGeometry(child);
      minX = Math.min(minX, box.x - box.w / 2);
      minY = Math.min(minY, box.y - box.h / 2);
      maxX = Math.max(maxX, box.x + box.w / 2);
      maxY = Math.max(maxY, box.y + box.h / 2);
    }
  }
  if (!content) return null;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}

/**
 * The fit's zoom / pan over the content's union box: the box's center at
 * the viewport's center (the container-space origin) at the smallest
 * zoom that fits both axes (`screen = zoom * canvas + pan` — the pan
 * stands `-zoom * center`), clamped at the 25%–400% bounds (a content
 * past the bounds stands the bound — the overflow keeps, the center
 * stands). Null over a degenerate box or viewport (the no-op stand — the
 * zoom and the pan keep).
 */
function fitView(content: Box, viewport: { width: number; height: number }): { zoom: number; pan: ScreenPoint } | null {
  if (content.w <= 0 || content.h <= 0 || viewport.width <= 0 || viewport.height <= 0) return null;
  const zoom = Number(
    Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(viewport.width / content.w, viewport.height / content.h))).toFixed(4)
  );
  return { zoom, pan: { x: Number((-zoom * content.x).toFixed(2)), y: Number((-zoom * content.y).toFixed(2)) } };
}

export { canvasContentBox, fitView };
