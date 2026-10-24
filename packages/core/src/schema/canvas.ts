/**
 * The canvas (edgeless) block types and the geometry field.
 *
 * `geometry` is an optional field of ANY block (a schema-level field, not
 * attrs): its position and size inside a surface. `x`/`y` are CENTER
 * coordinates — the anchor of the w/h box is its center. Ignored in the
 * page view (the block flows); in the canvas view — the position. A block
 * without a geometry has no canvas placement.
 */
import type { BlockContent, BlockId } from "./types";

/** The canvas geometry of a block. */
interface Geometry {
  /** Center x, in px, relative to the surface center (the origin). */
  x: number;
  /** Center y, in px, relative to the surface center (the origin). */
  y: number;
  /** Width, in px; must be > 0. */
  w: number;
  /** Height, in px; must be > 0. */
  h: number;
}

/**
 * A canvas weak ref: a block of the current document, or another document.
 * Also a connector endpoint shape (additive, 2026-10-15): a port of the
 * target block (the box's edge midpoint), or a free point (x / y in canvas
 * px relative to the canvas origin — the world space the canvas view's
 * surface children stand in) when the endpoint is
 * not anchored to a block at all.
 */
interface CanvasRef {
  /** The target document id; absent — the current document. */
  docId?: string;
  /** The target block id; absent together with docId — the ref is empty. */
  blockId?: string;
  /**
   * The endpoint's port of the target block (the edge midpoint; requires
   * docId / blockId). Absent — the endpoint stands at the block's edge
   * anchor toward the line's other end (the sticky legacy anchor). On a
   * FREE point (x / y, no ref) the port stands the FROZEN direction the
   * line leaves the point at (the last anchor's side — kept while the
   * endpoint stands off the blocks; the re-connection to an edge takes
   * the edge's side over it).
   */
  port?: "north" | "east" | "south" | "west";
  /**
   * The endpoint's fractional position along the port's side (0–1; the
   * absent stand is 0.5 — the edge midpoint, the port's legacy stand).
   * t = 0 stands at the side's start corner, t = 1 at its end (north /
   * south: left to right; east / west: top to bottom). Requires the port
   * and a block ref; on a free point (x / y) it stands no anchor
   * position (the strict validator rejects it).
   */
  portT?: number;
  /** The free endpoint's x (canvas px, the canvas origin — the world space). */
  x?: number;
  /** The free endpoint's y (canvas px, the canvas origin — the world space). */
  y?: number;
}

interface ShapeAttrs {
  /** The shape kind. */
  variant: "rect" | "rounded" | "ellipse" | "diamond" | "cylinder" | "cloud";
  /** Stroke color (CSS color). */
  stroke?: string;
  /** Fill color (CSS color). */
  fill?: string;
  /** Stroke width in px. */
  strokeWidth?: number;
  strokeStyle?: "solid" | "dash" | "dot";
  /** Opacity 0..1. */
  opacity?: number;
  /** Freehand points [x, y][] in block-local px within the w/h box. */
  points?: [number, number][];
  /** The shape's text (a plain string, the soft breaks as \n — the shape
   * is not a text block: no runs / marks, the style is uniform). */
  text?: string;
  /** The text's font size in px (8–512; absent = the 16px stand). */
  fontSize?: number;
  /** The text's font family (the self-hosted set's name, or a
   * consumer-loaded font's name). */
  fontFamily?: string;
  /** The text's color (CSS hex color). */
  textColor?: string;
  /** The text's style (the weight x the slant). */
  textStyle?: "regular" | "semibold" | "light" | "light-italic" | "italic" | "semibold-italic";
  /** The text's alignment. */
  textAlign?: "left" | "center" | "right";
  /** The explicit z-order index (dense 1..N over the surface's canvas
   * elements; the order's mirror — the paint order, 1 = bottom). */
  zIndex?: number;
}

interface ConnectorAttrs {
  /** The start endpoint (a block ref with an optional port, or a free x/y point). */
  start: CanvasRef;
  /** The end endpoint (a block ref with an optional port, or a free x/y point). */
  end: CanvasRef;
  /** Waypoints [x, y][] in surface-local px relative to the surface center. */
  points?: [number, number][];
  /** A label rendered at the midpoint. */
  label?: string;
  /** The line's shape (absent = "straight"). Pure rendering data: the
   * endpoints stay the block refs (the line re-derives from the blocks' geometry). */
  variant?: "straight" | "orthogonal" | "curved";
  strokeStyle?: "solid" | "dash" | "dot";
  /** The line's stroke color (a hex string — data, not theme; the line's
   * arrowheads follow it; absent = the theme's stroke token). */
  strokeColor?: string;
  /** The line's stroke width in canvas px (1–4; absent = 1). */
  strokeWidth?: number;
  /** The arrowhead's figure at the end endpoint (absent = "arrow"). */
  arrowHead?: "none" | "arrow" | "circle";
  /** The arrowhead's figure at the START endpoint (absent = no start
   * marker). Independent of the end's figure: the start marker stands
   * its own figure, not a copy of the end. */
  arrowStart?: "none" | "arrow" | "circle";
  /** The explicit z-order index (dense 1..N over the surface's canvas
   * elements; the order's mirror — the paint order, 1 = bottom). The
   * connector's line stands at its zIndex (over / under the shapes). */
  zIndex?: number;
}

interface CanvasTextAttrs {
  fontSize?: number;
  fontFamily?: string;
  textAlign?: string;
  /** The explicit z-order index (dense 1..N over the surface's canvas
   * elements; the order's mirror — the paint order, 1 = bottom). */
  zIndex?: number;
}

/**
 * The canvas GROUP (the container, — the
 * flat marker reworked): the members are the surface's SIBLING blocks
 * (weak refs, like the connector endpoints — a dangling member stands the
 * lenient read: skipped, not rewritten). The group carries its OWN
 * geometry (a free box, independent of the members — the members' absolute
 * coordinates stand; moving the group moves the box and the members by
 * one delta in one transact). The optional `title` stands the container's
 * label (the empty-string convention: absent or the empty string is no
 * title — the chip stands off).
 */
interface GroupAttrs {
  /** The member block ids (weak refs to the group's surface siblings). */
  members: BlockId[];
  /** The container's label (absent or the empty string = no title). */
  title?: string;
  /** The explicit z-order index (dense 1..N over the surface's canvas
   * elements; the order's mirror — the paint order, 1 = bottom). */
  zIndex?: number;
}

interface SurfaceAttrs {
  /** Nesting depth in the page sequence (default 0); ignored in the canvas z-order. */
  indent?: number;
}

/** The canvas container: its children are the canvas elements. */
interface SurfaceBlock {
  type: "surface";
  attrs?: SurfaceAttrs;
  /** The canvas elements; the order IS the z-order (the schema's only such case). */
  children?: BlockId[];
}

interface ShapeBlock {
  type: "shape";
  attrs?: ShapeAttrs;
}

interface ConnectorBlock {
  type: "connector";
  attrs: ConnectorAttrs;
}

interface FrameBlock {
  type: "frame";
  /** The nested page blocks on the canvas (page block types only). */
  children?: BlockId[];
}

interface CanvasTextBlock {
  type: "canvas-text";
  attrs?: CanvasTextAttrs;
  content?: BlockContent;
}

interface GroupBlock {
  type: "group";
  attrs: GroupAttrs;
}

/** The optional canvas geometry carried by every block member. */
type WithGeometry<T> = T & { geometry?: Geometry };

export type {
  CanvasRef,
  CanvasTextAttrs,
  CanvasTextBlock,
  ConnectorAttrs,
  ConnectorBlock,
  FrameBlock,
  Geometry,
  GroupAttrs,
  GroupBlock,
  ShapeAttrs,
  ShapeBlock,
  SurfaceAttrs,
  SurfaceBlock,
  WithGeometry,
};
