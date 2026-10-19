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

/** The connector's box (the center-anchor geometry shape). */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The four edge ports of a box (the edge midpoints, the center-anchor space). */
type CanvasPort = "north" | "east" | "south" | "west";

interface Ports {
  north: { x: number; y: number };
  east: { x: number; y: number };
  south: { x: number; y: number };
  west: { x: number; y: number };
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

/** An endpoint resolved to a point + the outward normal the line leaves at. */
interface EndpointPoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** The port's outward normal (the curved line bows out from it). */
const PORT_NORMAL: Record<CanvasPort, { nx: number; ny: number }> = {
  north: { nx: 0, ny: -1 },
  east: { nx: 1, ny: 0 },
  south: { nx: 0, ny: 1 },
  west: { nx: -1, ny: 0 },
};

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
    const port = portsOf(box)[ref.port];
    const normal = PORT_NORMAL[ref.port];
    return { x: port.x, y: port.y, nx: normal.nx, ny: normal.ny };
  }
  const anchor = edgeAnchor(box, toward);
  return { x: anchor.x, y: anchor.y, nx: anchor.nx, ny: anchor.ny };
}

/** The connector's line shape (the absent variant renders straight). */
type ConnectorVariant = "straight" | "orthogonal" | "curved";

/** An edge anchor: the border point + the anchored edge's outward normal. */
interface EdgeAnchor {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** The connector's computed path (the surface coordinate space, the center origin). */
interface ConnectorPath {
  /** The SVG path data. */
  d: string;
  /** The line's end point (the arrowhead's tip, on the end box's edge). */
  end: { x: number; y: number };
  /** The line's midpoint (the label's seat). */
  mid: { x: number; y: number };
}

/**
 * The edge anchor (the center-to-toward segment's exit from the box's
 * border, the Miro anchor model): the line always leaves the box at the
 * edge the target direction points at, so a moved block re-anchors the
 * line automatically. The zero vector (the coincident centers) falls
 * back to the east edge's midpoint.
 */
function edgeAnchor(box: Box, toward: { x: number; y: number }): EdgeAnchor {
  const dx = toward.x - box.x;
  const dy = toward.y - box.y;
  if (dx === 0 && dy === 0) return { x: box.x + box.w / 2, y: box.y, nx: 1, ny: 0 };
  const lambdaX = dx === 0 ? Infinity : dx > 0 ? box.w / 2 / dx : -box.w / 2 / dx;
  const lambdaY = dy === 0 ? Infinity : dy > 0 ? box.h / 2 / dy : -box.h / 2 / dy;
  if (lambdaX <= lambdaY) {
    return {
      x: box.x + (dx > 0 ? box.w / 2 : -box.w / 2),
      y: box.y + lambdaX * dy,
      nx: dx > 0 ? 1 : -1,
      ny: 0,
    };
  }
  return {
    x: box.x + lambdaY * dx,
    y: box.y + (dy > 0 ? box.h / 2 : -box.h / 2),
    nx: 0,
    ny: dy > 0 ? 1 : -1,
  };
}

/**
 * The connector's path between the endpoint boxes (the variant's shape).
 * straight: the edge-to-edge segment. orthogonal: the right-angled elbow
 * through the dominant axis' mid-edges (the horizontal dominant: the east
 * / west edge midpoints, the vertical bend at the mid x). curved: the
 * cubic bezier bowing out along the anchored edges' outward normals (the
 * line leaves each box perpendicular to its edge). Degenerate cases (the
 * coincident centers) stand as the straight edge-to-edge segment.
 */
function connectorPath(start: Box, end: Box, variant: ConnectorVariant): ConnectorPath {
  const a = edgeAnchor(start, { x: end.x, y: end.y });
  const b = edgeAnchor(end, { x: start.x, y: start.y });
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

  if (variant === "straight") {
    return { d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, end: { x: b.x, y: b.y }, mid };
  }

  if (variant === "orthogonal") {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) {
      return { d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, end: { x: b.x, y: b.y }, mid };
    }
    if (Math.abs(dx) >= Math.abs(dy)) {
      // The horizontal dominant: out of the east/west mid-edges, the
      // vertical bend at the mid x between the two edge x's.
      const sx = start.x + (dx > 0 ? start.w / 2 : -start.w / 2);
      const ex = end.x - (dx > 0 ? end.w / 2 : -end.w / 2);
      const bendX = (sx + ex) / 2;
      return {
        d: `M ${sx} ${start.y} L ${bendX} ${start.y} L ${bendX} ${end.y} L ${ex} ${end.y}`,
        end: { x: ex, y: end.y },
        mid: { x: bendX, y: (start.y + end.y) / 2 },
      };
    }
    // The vertical dominant (the symmetric case).
    const sy = start.y + (dy > 0 ? start.h / 2 : -start.h / 2);
    const ey = end.y - (dy > 0 ? end.h / 2 : -end.h / 2);
    const bendY = (sy + ey) / 2;
    return {
      d: `M ${start.x} ${sy} L ${start.x} ${bendY} L ${end.x} ${bendY} L ${end.x} ${ey}`,
      end: { x: end.x, y: ey },
      mid: { x: (start.x + end.x) / 2, y: bendY },
    };
  }

  // The curved: the control points ride the anchored edges' outward
  // normals (a third of the span), so the line bows out perpendicular
  // from each box.
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const reach = dist / 3;
  const c1 = { x: a.x + a.nx * reach, y: a.y + a.ny * reach };
  const c2 = { x: b.x + b.nx * reach, y: b.y + b.ny * reach };
  return { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`, end: { x: b.x, y: b.y }, mid };
}

/**
 * The connector's path between the RESOLVED endpoint points (the variant's
 * shape): the free-port generalization of connectorPath — straight is the
 * segment, orthogonal the right-angled elbow through the dominant axis'
 * midpoint, curved the cubic bow (a zero normal — the free point — bows
 * out along the segment's own direction, so the line leaves the point the
 * way it arrived).
 */
function connectorPathPoints(a: EndpointPoint, b: EndpointPoint, variant: ConnectorVariant): ConnectorPath {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (variant === "straight") {
    return { d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, end: { x: b.x, y: b.y }, mid };
  }
  if (variant === "orthogonal") {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) {
      return { d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, end: { x: b.x, y: b.y }, mid };
    }
    if (Math.abs(dx) >= Math.abs(dy)) {
      const bendX = (a.x + b.x) / 2;
      return {
        d: `M ${a.x} ${a.y} L ${bendX} ${a.y} L ${bendX} ${b.y} L ${b.x} ${b.y}`,
        end: { x: b.x, y: b.y },
        mid: { x: bendX, y: (a.y + b.y) / 2 },
      };
    }
    const bendY = (a.y + b.y) / 2;
    return {
      d: `M ${a.x} ${a.y} L ${a.x} ${bendY} L ${b.x} ${bendY} L ${b.x} ${b.y}`,
      end: { x: b.x, y: b.y },
      mid: { x: (a.x + b.x) / 2, y: bendY },
    };
  }
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const reach = dist / 3;
  // The free point's zero normal bows out perpendicular to the segment
  // (both control points on the same side — the line bows to one side,
  // the deterministic side: the segment direction rotated -90°).
  const perp = dist === 0 ? { nx: 0, ny: 1 } : { nx: (b.y - a.y) / dist, ny: -(b.x - a.x) / dist };
  const aNormal = a.nx === 0 && a.ny === 0 ? perp : { nx: a.nx, ny: a.ny };
  const bNormal = b.nx === 0 && b.ny === 0 ? perp : { nx: b.nx, ny: b.ny };
  const c1 = { x: a.x + aNormal.nx * reach, y: a.y + aNormal.ny * reach };
  const c2 = { x: b.x + bNormal.nx * reach, y: b.y + bNormal.ny * reach };
  return { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`, end: { x: b.x, y: b.y }, mid };
}

export {
  DEFAULT_CANVAS_ITEM_SIZE,
  DEFAULT_PAGE_SIZE,
  canvasItemStyle,
  connectorPath,
  connectorPathPoints,
  edgeAnchor,
  effectiveGeometry,
  endpointBoxOf,
  endpointOf,
  endpointPointOf,
  isCanvasSubType,
  pageCardStyle,
  portOfNormal,
  portsOf,
};

export type { CanvasPort, ConnectorPath, ConnectorVariant, EndpointPoint, Ports };
