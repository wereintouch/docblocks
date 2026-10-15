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
      variant: { kind: "enum", values: ["rect", "ellipse", "diamond", "line"], required: true },
      stroke: { kind: "string" },
      fill: { kind: "string" },
      strokeWidth: { kind: "number", positive: true },
      strokeStyle: { kind: "enum", values: ["solid", "dash", "dot"] },
      opacity: { kind: "number", min: 0, max: 1 },
      // A tuple shape ([x, y] pairs) the AttrSpec array kind cannot
      // express: the spec passes any array, the validator's canvas branch
      // checks the tuple shape.
      points: { kind: "array" },
    },
  },
  connector: {
    content: false,
    children: false,
    rows: false,
    attrs: {
      // Weak refs { docId?, blockId? }: each field alone is optional (the
      // object spec cannot express "at least one of two"), so the branch
      // below requires at least one field per ref.
      start: {
        kind: "object",
        required: true,
        fields: {
          docId: { kind: "string", nonEmpty: true },
          blockId: { kind: "string", nonEmpty: true },
        },
      },
      end: {
        kind: "object",
        required: true,
        fields: {
          docId: { kind: "string", nonEmpty: true },
          blockId: { kind: "string", nonEmpty: true },
        },
      },
      points: { kind: "array" },
      label: { kind: "string" },
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
