/**
 * The canvas (edgeless) block types and the geometry field.
 *
 * `geometry` is an optional field of ANY block (a schema-level field, not
 * attrs): its position and size inside a surface. `x`/`y` are CENTER
 * coordinates — the anchor of the w/h box is its center, the rotation
 * turns around that center. Ignored in the page view (the block flows);
 * in the canvas view — the position. A block without a geometry has no
 * canvas placement.
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
  /** Rotation in degrees around the center; absent = 0. */
  rotation?: number;
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
   * anchor toward the line's other end (the sticky legacy anchor).
   */
  port?: "north" | "east" | "south" | "west";
  /** The free endpoint's x (canvas px, the canvas origin — the world space). */
  x?: number;
  /** The free endpoint's y (canvas px, the canvas origin — the world space). */
  y?: number;
}

interface ShapeAttrs {
  /** The shape kind. */
  variant: "rect" | "ellipse" | "diamond" | "line";
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
}

interface CanvasTextAttrs {
  fontSize?: number;
  fontFamily?: string;
  textAlign?: string;
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
  ShapeAttrs,
  ShapeBlock,
  SurfaceAttrs,
  SurfaceBlock,
  WithGeometry,
};
