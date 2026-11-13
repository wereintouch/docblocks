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
  "file",
  "embed",
  "sync-embed",
  "divider",
  "database",
];

/**
 * Top-level page blocks: everything except `root` and table internals.
 * The `frame` stands in the page set (the page-frame block — the inline
 * window into a canvas frame; the canvas-frame context stands in the
 * surface's element set).
 */
const PAGE_BLOCK_TYPES: readonly BlockType[] = [
  "paragraph",
  "quote",
  "heading",
  "list-item",
  "callout",
  "code",
  "table",
  "image",
  "file",
  "embed",
  "sync-embed",
  "divider",
  "database",
  "surface",
  "frame",
];

/**
 * The canvas element set for `surface.children`: the page blocks (a nested
 * `surface` is NOT allowed in v1 — the canvas does not nest; the `frame`
 * arrives with the page set — the canvas-frame context) plus the
 * canvas-only types.
 */
const SURFACE_ELEMENT_TYPES: readonly BlockType[] = [
  ...PAGE_BLOCK_TYPES.filter((type) => type !== "surface"),
  "shape",
  "connector",
  "canvas-text",
  "group",
];

export { LEAF_BLOCK_TYPES, PAGE_BLOCK_TYPES, SURFACE_ELEMENT_TYPES };
