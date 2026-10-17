import type { CSSProperties } from "react";

import type { Block, BlockId, BlockType, CanvasRef } from "docblocks-core";

/** The canvas-only element types (they render ONLY inside a surface). */
const CANVAS_SUB_TYPES: readonly BlockType[] = ["shape", "connector", "canvas-text", "frame"];

/** The default size (px) of a canvas element without a geometry. */
const DEFAULT_CANVAS_ITEM_SIZE = 100;

/** The default size (px) of the page miniature when the root carries no geometry. */
const DEFAULT_PAGE_SIZE = { w: 720, h: 960 } as const;

function isCanvasSubType(type: BlockType): boolean {
  return CANVAS_SUB_TYPES.includes(type);
}
/**
 * The positioned wrapper style of a canvas element.
 *
 * The surface's origin is the container CENTER (the center-anchor
 * coordinate model, the geometry x/y parity): the element is placed at
 * (center + x, center + y) and centered over that point with
 * translate(-50%, -50%), rotated around its own center (the rotation is
 * 0 when absent). An element WITHOUT a geometry (the lenient reader)
 * renders at the center with the default size — the text / flow children
 * (the page blocks) keep their natural size (no width/height).
 */
function canvasItemStyle(block: Block): CSSProperties {
  const geometry = block.geometry;
  const style: CSSProperties = {
    position: "absolute",
    left: `calc(50% + ${geometry?.x ?? 0}px)`,
    top: `calc(50% + ${geometry?.y ?? 0}px)`,
    transform: `translate(-50%, -50%) rotate(${geometry?.rotation ?? 0}deg)`,
  };
  if (geometry !== undefined) {
    style.width = `${geometry.w}px`;
    style.height = `${geometry.h}px`;
  } else if (isCanvasSubType(block.type)) {
    style.width = DEFAULT_CANVAS_ITEM_SIZE;
    style.height = DEFAULT_CANVAS_ITEM_SIZE;
  }
  return style;
}

/**
 * A connector endpoint in the surface coordinate space (the container
 * center + the geometry x/y; a block without a geometry is at the origin),
 * resolved WITHIN the surface's children by blockId ONLY (v1 — the
 * cross-doc resolution is the consumer's level): a ref with a docId, or a
 * blockId that is not a direct surface child (or an absent block),
 * resolves to nothing — the line is skipped (the lenient render posture).
 */
function endpointOf(
  ref: CanvasRef,
  siblings: readonly BlockId[],
  blocks: Record<BlockId, Block>
): { x: number; y: number } | null {
  if (ref.docId !== undefined || ref.blockId === undefined) return null;
  if (!siblings.includes(ref.blockId)) return null;
  const target = blocks[ref.blockId];
  if (target === undefined) return null;
  return { x: target.geometry?.x ?? 0, y: target.geometry?.y ?? 0 };
}

/**
 * The page miniature's positioned style (the canvas view): the same
 * center-anchor placement as canvasItemStyle, but the size always applies
 * — the root without a geometry gets the DEFAULT_PAGE_SIZE, so the page
 * is always a box (the vertical page rectangle).
 */
function pageCardStyle(root: Block): CSSProperties {
  const geometry = root.geometry;
  return {
    position: "absolute",
    left: `calc(50% + ${geometry?.x ?? 0}px)`,
    top: `calc(50% + ${geometry?.y ?? 0}px)`,
    transform: `translate(-50%, -50%) rotate(${geometry?.rotation ?? 0}deg)`,
    width: `${geometry?.w ?? DEFAULT_PAGE_SIZE.w}px`,
    height: `${geometry?.h ?? DEFAULT_PAGE_SIZE.h}px`,
  };
}

/**
 * The effective geometry box the element stands at (the stored geometry
 * or the synthesized default: the page miniature gets the default page
 * size, every other canvas element the default item size). The move
 * commit writes a complete x/y/w/h patch from this snapshot, so a
 * geometry-less element moves into a fresh complete geometry.
 */
function effectiveGeometry(block: Block): { x: number; y: number; w: number; h: number } {
  const geometry = block.geometry;
  if (geometry !== undefined) return { x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h };
  const size = block.type === "root" ? DEFAULT_PAGE_SIZE : { w: DEFAULT_CANVAS_ITEM_SIZE, h: DEFAULT_CANVAS_ITEM_SIZE };
  return { x: 0, y: 0, w: size.w, h: size.h };
}

export {
  DEFAULT_CANVAS_ITEM_SIZE,
  DEFAULT_PAGE_SIZE,
  canvasItemStyle,
  effectiveGeometry,
  endpointOf,
  isCanvasSubType,
  pageCardStyle,
};
