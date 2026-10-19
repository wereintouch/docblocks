/**
 * The canvas block entries of the registry (v2). Kept in a sibling module
 * (the registry's single Record is assembled from the v1 entries and this
 * table); `BlockSpec` is a type-only import, so there is no runtime cycle.
 */
import { FRAME_ELEMENT_TYPES, SURFACE_ELEMENT_TYPES } from "./block-type-lists";
import type { BlockType } from "./block-union";
import type { BlockSpec } from "./registry";

const CANVAS_BLOCK_SPECS: Pick<
  Record<BlockType, BlockSpec>,
  "surface" | "shape" | "connector" | "frame" | "canvas-text"
> = {
  surface: {
    content: false,
    children: true,
    rows: false,
    childrenTypes: SURFACE_ELEMENT_TYPES,
    // Z-ORDER semantics: for a surface the children order is the Z-ORDER
    // (paint order), not the reading order — the only such case in the
    // schema (every other container's children order is the reading order).
    // A moveBlock within the surface's children is a z-order change.
  },
  shape: {
    content: false,
    children: false,
    rows: false,
    attrs: {
      variant: { kind: "enum", values: ["rect", "rounded", "ellipse", "diamond"], required: true },
      stroke: { kind: "string" },
      fill: { kind: "string" },
      strokeWidth: { kind: "number", positive: true },
      strokeStyle: { kind: "enum", values: ["solid", "dash", "dot"] },
      opacity: { kind: "number", min: 0, max: 1 },
      // A tuple shape ([x, y] pairs) the AttrSpec array kind cannot
      // express: the spec passes any array, the validator's canvas branch
      // checks the tuple shape.
      points: { kind: "array" },
      // The shape's TEXT (a plain string, soft breaks as \n — the shape
      // is not a text block, so no runs / marks: the style is uniform per
      // shape). Absent / empty — the shape stands textless.
      text: { kind: "string" },
      fontSize: { kind: "number", positive: true, min: 8, max: 512 },
      fontFamily: { kind: "string", nonEmpty: true },
      textColor: { kind: "string", hexColor: true },
      // The text's style (the weight x the slant): light (300) /
      // regular (400) / semibold (600), the upright / italic slant.
      textStyle: {
        kind: "enum",
        values: ["regular", "semibold", "light", "light-italic", "italic", "semibold-italic"],
      },
      textAlign: { kind: "enum", values: ["left", "center", "right"] },
    },
  },
  connector: {
    content: false,
    children: false,
    rows: false,
    attrs: {
      // Endpoint shapes (each of start / end): a weak block ref
      // { docId?, blockId? } with an optional port (the block's edge
      // midpoint), or a free point { x, y } in surface-local px (the
      // surface's center origin). The object spec cannot express the
      // "a ref or a free point" rule; the canvas validator branch does.
      start: {
        kind: "object",
        required: true,
        fields: {
          docId: { kind: "string", nonEmpty: true },
          blockId: { kind: "string", nonEmpty: true },
          port: { kind: "enum", values: ["north", "east", "south", "west"] },
          x: { kind: "number" },
          y: { kind: "number" },
        },
      },
      end: {
        kind: "object",
        required: true,
        fields: {
          docId: { kind: "string", nonEmpty: true },
          blockId: { kind: "string", nonEmpty: true },
          port: { kind: "enum", values: ["north", "east", "south", "west"] },
          x: { kind: "number" },
          y: { kind: "number" },
        },
      },
      points: { kind: "array" },
      label: { kind: "string" },
      // The line's shape (absent = "straight"): straight = the edge-to-
      // edge segment, orthogonal = the right-angled elbow, curved = the
      // bezier bow. Pure rendering data — the endpoints stay the block
      // refs (the line re-derives from the blocks' geometry).
      variant: { kind: "enum", values: ["straight", "orthogonal", "curved"] },
      strokeStyle: { kind: "enum", values: ["solid", "dash", "dot"] },
    },
  },
  frame: {
    content: false,
    children: true,
    rows: false,
    childrenTypes: FRAME_ELEMENT_TYPES,
    // The frame's children are a nested page: the flat page model applies
    // to this sequence (indent, the indent-jump rule).
    sequence: true,
  },
  "canvas-text": {
    content: true,
    children: false,
    rows: false,
    attrs: {
      fontSize: { kind: "number", positive: true },
      fontFamily: { kind: "string" },
      textAlign: { kind: "string" },
    },
  },
};

export { CANVAS_BLOCK_SPECS };
