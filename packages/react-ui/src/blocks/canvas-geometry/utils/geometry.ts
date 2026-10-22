/**
 * The element-side canvas geometry: the positioned wrapper styles (the
 * center-anchor placement), the page miniature's style, the effective
 * geometry snapshot, the connector endpoint's box / point resolution
 * (within the surface's children, the lenient posture), and the port
 * helpers.
 */
import type { CSSProperties } from "react";

import type { Block, BlockId, BlockType, CanvasRef } from "docblocks-core";

import { CANVAS_SUB_TYPES, DEFAULT_CANVAS_ITEM_SIZE, DEFAULT_PAGE_SIZE, PORT_NORMAL } from "../models";
import type { Box, CanvasPort, EndpointPoint, Ports } from "../models";
import { edgeAnchor } from "./connector";

function isCanvasSubType(type: BlockType): boolean {
  return CANVAS_SUB_TYPES.includes(type);
}
/**
 * The positioned wrapper style of a canvas element.
 *
 * The surface's origin is the container CENTER (the center-anchor
 * coordinate model, the geometry x/y parity): the element is placed at
 * (center + x, center + y) and centered over that point with
 * translate(-50%, -50%). A stored legacy rotation value is ignored on
 * read / render. An element WITHOUT a geometry (the lenient reader)
 * renders at the center with the default size — the text / flow
 * children (the page blocks) keep their natural size (no width/height).
 */
function canvasItemStyle(block: Block): CSSProperties {
  const geometry = block.geometry;
  const style: CSSProperties = {
    position: "absolute",
    left: `calc(50% + ${geometry?.x ?? 0}px)`,
    top: `calc(50% + ${geometry?.y ?? 0}px)`,
    transform: "translate(-50%, -50%)",
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
  // The free point (the 2026-10-15 endpoint shape) stands as-is.
  if (ref.docId === undefined && ref.blockId === undefined && ref.x !== undefined && ref.y !== undefined) {
    return { x: ref.x, y: ref.y };
  }
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
    transform: "translate(-50%, -50%)",
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

/**
 * The connector endpoint's box in the surface coordinate space, resolved
 * WITHIN the surface's children by blockId ONLY (v1 — the cross-doc
 * resolution is the consumer's level): a ref with a docId, or a blockId
 * that is not a direct surface child (or an absent block), resolves to
 * nothing — the line is skipped (the lenient render posture). The box is
 * the effective geometry (the stored geometry or the synthesized default).
 */
function endpointBoxOf(ref: CanvasRef, siblings: readonly BlockId[], blocks: Record<BlockId, Block>): Box | null {
  if (ref.docId !== undefined || ref.blockId === undefined) return null;
  if (!siblings.includes(ref.blockId)) return null;
  const target = blocks[ref.blockId];
  if (target === undefined) return null;
  return effectiveGeometry(target);
}

/** The box's four edge-midpoint ports (the connector's snap targets). */
function portsOf(box: Box): Ports {
  return {
    north: { x: box.x, y: box.y - box.h / 2 },
    east: { x: box.x + box.w / 2, y: box.y },
    south: { x: box.x, y: box.y + box.h / 2 },
    west: { x: box.x - box.w / 2, y: box.y },
  };
}

/**
 * The edge anchor's point at the fractional position along the side
 *: t = 0 stands at the side's start
 * corner, t = 1 at its end (north / south: left to right; east / west:
 * top to bottom), so t = 0.5 stands the edge midpoint (the port's legacy
 * stand). A non-finite t stands the midpoint (the lenient read posture).
 */
function edgePointOf(box: Box, port: CanvasPort, t: number | undefined): { x: number; y: number } {
  const clamped = t === undefined || !Number.isFinite(t) ? 0.5 : Math.min(1, Math.max(0, t));
  switch (port) {
    case "north":
      return { x: box.x - box.w / 2 + clamped * box.w, y: box.y - box.h / 2 };
    case "south":
      return { x: box.x - box.w / 2 + clamped * box.w, y: box.y + box.h / 2 };
    case "east":
      return { x: box.x + box.w / 2, y: box.y - box.h / 2 + clamped * box.h };
    case "west":
      return { x: box.x - box.w / 2, y: box.y - box.h / 2 + clamped * box.h };
  }
}

/** The port the unit normal stands (the direction's frozen form — the
 * detach keeps the last anchor's side); null on the zero vector (a
 * directionless endpoint stands no port). */
function portOfNormal(nx: number, ny: number): CanvasPort | null {
  if (nx === 1) return "east";
  if (nx === -1) return "west";
  if (ny === 1) return "south";
  if (ny === -1) return "north";
  return null;
}

/**
 * The connector endpoint resolved to a POINT in the surface coordinate
 * space (the container center origin): a free { x, y } point stands as-is
 * (the normal derives from the segment at render time); a block ref with
 * a port stands at that edge midpoint; a block ref without a port stands
 * at the block's edge anchor toward `toward` (the sticky legacy anchor —
 * a moved block re-anchors the line). Resolved WITHIN the surface's
 * children by blockId ONLY (the cross-doc resolution is the consumer's
 * level): a docId ref, or a blockId that is not a direct surface child (or
 * an absent block), resolves to nothing — the line is skipped (the
 * lenient render posture).
 */
function endpointPointOf(
  ref: CanvasRef,
  siblings: readonly BlockId[],
  blocks: Record<BlockId, Block>,
  toward: { x: number; y: number }
): EndpointPoint | null {
  if (ref.x !== undefined && ref.y !== undefined) {
    // The free point stands as-is. The port (when present) stands the
    // FROZEN direction the line leaves the point at (the last anchor's
    // side, kept while the endpoint stands off the blocks); absent — the
    // zero normal (the line bows out along the segment at render time).
    const normal = ref.port !== undefined ? PORT_NORMAL[ref.port] : { nx: 0, ny: 0 };
    return { x: ref.x, y: ref.y, nx: normal.nx, ny: normal.ny };
  }
  if (ref.docId !== undefined || ref.blockId === undefined) return null;
  if (!siblings.includes(ref.blockId)) return null;
  const target = blocks[ref.blockId];
  if (target === undefined) return null;
  const box = effectiveGeometry(target);
  if (ref.port !== undefined) {
    // The edge anchor: the side's point at the fractional position
    // (the absent portT stands the midpoint — the port's legacy stand).
    const point = edgePointOf(box, ref.port, ref.portT);
    const normal = PORT_NORMAL[ref.port];
    return { x: point.x, y: point.y, nx: normal.nx, ny: normal.ny };
  }
  const anchor = edgeAnchor(box, toward);
  return { x: anchor.x, y: anchor.y, nx: anchor.nx, ny: anchor.ny };
}

/** The drop's containment test: the
 * figure's box (the center-anchor form) fully inside the container's box.
 * The green / red stand's input — the figure's box touches the container's
 * edge only (the equality stands contained, the touch is the drop).
 */
function boxContains(
  figure: { x: number; y: number; w: number; h: number },
  container: { x: number; y: number; w: number; h: number }
): boolean {
  return (
    figure.x - figure.w / 2 >= container.x - container.w / 2 &&
    figure.x + figure.w / 2 <= container.x + container.w / 2 &&
    figure.y - figure.h / 2 >= container.y - container.h / 2 &&
    figure.y + figure.h / 2 <= container.y + container.h / 2
  );
}

export {
  boxContains,
  canvasItemStyle,
  edgePointOf,
  effectiveGeometry,
  endpointBoxOf,
  endpointOf,
  endpointPointOf,
  isCanvasSubType,
  pageCardStyle,
  portOfNormal,
  portsOf,
};
