/**
 * The canvas view's viewport culling: the off-viewport items
 * stand no DOM of their own — a 5000-figure canvas mounts (and renders)
 * only the figures + connectors inside the visible world rect (plus the
 * margin). The visible set is referentially stable while its content is
 * unchanged (a pan inside the margin band stands no re-composition of the
 * surfaces' children — the SurfaceLayer's memo holds).
 *
 * The cull's contract: an item's box (its committed geometry) expanded
 * over the margin must not intersect the visible world rect. The
 * connector's box stands the two endpoint's boxes' union over the margin
 * (the route's avoidance detour beyond the endpoints stands the margin's
 * tolerance — a detour that pokes into the viewport over both endpoints'
 * culled boxes is the documented stand). The in-flight session's items
 * (the moved set, the resized item, the text-editing figures, the
 * focused item) stand un-culled — the session's previews stand no
 * mount / unmount of their own mid-gesture.
 */
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { Block, BlockId, ConnectorBlock } from "docblocks-core";

import { effectiveGeometry, endpointBoxOf } from "../geometry";
import type { CanvasViewportState, ScreenRect } from "../viewport";
import { rectsIntersect } from "../viewport";

/** The culling's margin (canvas px, over the visible rect's edge). */
const CULL_MARGIN_PX = 300;

/** The culling's fallback size (canvas px) over the unknown container
 * size (the first frame before the layout's measure, the jsdom's test's
 * stand): the conservative stand over the no-cull — the heavy doc's full
 * mount over the unknown size stood the renderer's crash (the 5000
 * figures' initial render). The measured size replaces it over the
 * first layout (the one-frame's stand, the band's flicker). */
const FALLBACK_SIZE = { width: 1200, height: 800 };

/** The container's size (the ResizeObserver's stand): zero until the
 * first layout (the culling's stand — no cull over the unknown size). The
 * no-ResizeObserver's stand (the jsdom's test) stands the window's resize
 * listener's re-measure. */
function useContainerSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize((prev) =>
        prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/**
 * The visible world rect (canvas coords, center-anchor): the container's
 * screen rect (center-relative) mapped through the zoom / pan (the world
 * carries `transform: translate(pan) scale(zoom)` over the center, so
 * `canvas = (screen - pan) / zoom`), expanded over the margin. `null`
 * stands no cull (the caller's stand over the explicit no-cull).
 */
function visibleWorldRectOf(
  zoom: number,
  pan: { x: number; y: number },
  size: { width: number; height: number },
  margin: number
): ScreenRect | null {
  if (size.width <= 0 || size.height <= 0) return null;
  const left = (-size.width / 2 - pan.x) / zoom - margin;
  const top = (-size.height / 2 - pan.y) / zoom - margin;
  const right = (size.width / 2 - pan.x) / zoom + margin;
  const bottom = (size.height / 2 - pan.y) / zoom + margin;
  return { left, top, width: right - left, height: bottom - top };
}

/** The box (center-anchor) → the rect (corner-anchor). */
function boxRectOf(box: { x: number; y: number; w: number; h: number }): ScreenRect {
  return { left: box.x - box.w / 2, top: box.y - box.h / 2, width: box.w, height: box.h };
}

/** The connector's cull box: the two endpoint's boxes' union (the block
 * ref's geometry box, the free point's zero box). `null` when neither
 * endpoint resolves (the unresolvable line stands kept — no cull over
 * the data's missing). */
function connectorCullBoxOf(
  block: ConnectorBlock,
  siblings: readonly BlockId[],
  blocks: Record<BlockId, Block>
): { left: number; top: number; right: number; bottom: number } | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const ref of [block.attrs.start, block.attrs.end]) {
    if (ref.x !== undefined && ref.y !== undefined) {
      left = Math.min(left, ref.x);
      top = Math.min(top, ref.y);
      right = Math.max(right, ref.x);
      bottom = Math.max(bottom, ref.y);
      continue;
    }
    const box = endpointBoxOf(ref, siblings, blocks);
    if (box === null) return null;
    left = Math.min(left, box.x - box.w / 2);
    top = Math.min(top, box.y - box.h / 2);
    right = Math.max(right, box.x + box.w / 2);
    bottom = Math.max(bottom, box.y + box.h / 2);
  }
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return { left, top, right, bottom };
}

/**
 * The cull's keep set (the in-flight session's ids): the moved items, the
 * resized item, the text-editing figures (the shape's / the canvas's
 * text), the connector's label's edit, the keyboard's focused item.
 */
function keepIdsOf(viewport: CanvasViewportState): Set<BlockId> {
  const keep = new Set<BlockId>();
  const preview = viewport.movePreview;
  if (preview !== null) for (const id of preview.idSet) keep.add(id);
  if (viewport.resizePreview !== null) keep.add(viewport.resizePreview.id);
  for (const id of [
    viewport.shapeTextEditing,
    viewport.canvasTextEditing,
    viewport.connectorLabelEditing,
    viewport.kbFocusId,
  ]) {
    if (id !== null) keep.add(id);
  }
  return keep;
}

/**
 * The cull's set: the visible ids (the surface's children whose cull box
 * intersects the visible world rect, or the keep set's member). `null`
 * over the unknown container size (no cull — the render stands whole).
 */
function computeCulling(
  visible: ScreenRect,
  surfaces: readonly { id: BlockId; children: readonly BlockId[] }[],
  blocks: Record<BlockId, Block>,
  keep: Set<BlockId>
): Set<BlockId> {
  const visibleIds = new Set<BlockId>();
  for (const { children } of surfaces) {
    for (const id of children) {
      if (keep.has(id)) {
        visibleIds.add(id);
        continue;
      }
      const block = blocks[id];
      if (block === undefined) {
        // The lenient stand: the absent block (the CRDT's race residue)
        // stands kept — the read path's tolerance, no cull over it.
        visibleIds.add(id);
        continue;
      }
      if (block.type === "connector") {
        const box = connectorCullBoxOf(block, children, blocks);
        if (
          box === null ||
          rectsIntersect(visible, {
            left: box.left,
            top: box.top,
            width: box.right - box.left,
            height: box.bottom - box.top,
          })
        ) {
          visibleIds.add(id);
        }
        continue;
      }
      const box = effectiveGeometry(block);
      if (rectsIntersect(visible, boxRectOf(box))) visibleIds.add(id);
    }
  }
  return visibleIds;
}

/**
 * The canvas view's culling (the visible ids over the surfaces'
 * children): the referentially stable stand while the content is
 * unchanged (a pan over the margin band stands the same set reference —
 * the surfaces' children's memo holds), the fresh set over the content's
 * change (an item enters / leaves the viewport band).
 */
function useCanvasCulling(
  containerRef: RefObject<HTMLElement | null>,
  viewport: CanvasViewportState,
  surfaces: readonly { id: BlockId; children: BlockId[] }[],
  blocks: Record<BlockId, Block>
): Set<BlockId> | null {
  const size = useContainerSize(containerRef);
  // The unknown size's stand (the first frame / the jsdom): the fallback
  // size's rect (the conservative cull — the heavy doc's full mount stands
  // no DOM of its own before the first layout's measure).
  const measured = size.width > 0 && size.height > 0 ? size : FALLBACK_SIZE;
  const visible = visibleWorldRectOf(viewport.zoom, viewport.pan, measured, CULL_MARGIN_PX);
  const cacheRef = useRef<Set<BlockId> | null>(null);
  if (visible === null) {
    // The no-rect's stand (the unmeasured size's guard — the fallback's
    // stand makes it unreachable in practice): no cull.
    cacheRef.current = null;
    return null;
  }
  const next = computeCulling(visible, surfaces, blocks, keepIdsOf(viewport));
  const cached = cacheRef.current;
  if (cached !== null && cached.size === next.size) {
    let same = true;
    for (const id of next) {
      if (!cached.has(id)) {
        same = false;
        break;
      }
    }
    if (same) return cached;
  }
  cacheRef.current = next;
  return next;
}

export { CULL_MARGIN_PX, computeCulling, useCanvasCulling, visibleWorldRectOf };
