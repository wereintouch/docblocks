/**
 * The block-type category lists (the registry's structural data).
 */
import type { BlockType } from "./block-union";

/**
 * Leaf types (no `children` of their own): the only ones allowed in cells.
 *
 * This is the cell-ELIGIBILITY list, not the "has no children" list: the
 * canvas types (shape, connector, canvas-text) have no children either, but
 * they are NOT cell-eligible — a table cell holds the v1 leaf set only.
 */
const LEAF_BLOCK_TYPES: readonly BlockType[] = [
  "paragraph",
  "heading",
  "callout",
  "code",
  "image",
  "embed",
  "sync-embed",
  "divider",
  "database",
];

/** Top-level page blocks: everything except `root` and table internals. */
const PAGE_BLOCK_TYPES: readonly BlockType[] = [
  "paragraph",
  "quote",
  "heading",
  "list-item",
  "callout",
  "code",
  "table",
  "image",
  "embed",
  "sync-embed",
  "divider",
  "database",
  "surface",
];

/**
 * The canvas element set for `surface.children`: the page blocks (a nested
 * `surface` is NOT allowed in v1 — the canvas does not nest) plus the
 * canvas-only types.
 */
const SURFACE_ELEMENT_TYPES: readonly BlockType[] = [
  ...PAGE_BLOCK_TYPES.filter((type) => type !== "surface"),
  "shape",
  "connector",
  "frame",
  "canvas-text",
  "group",
];

/**
 * The `frame`'s children: the page blocks (the frame is a page container on
 * the canvas — no nested surface, no frame-in-frame).
 */
const FRAME_ELEMENT_TYPES: readonly BlockType[] = PAGE_BLOCK_TYPES.filter((type) => type !== "surface");

export { FRAME_ELEMENT_TYPES, LEAF_BLOCK_TYPES, PAGE_BLOCK_TYPES, SURFACE_ELEMENT_TYPES };
