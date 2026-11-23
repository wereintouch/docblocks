/** The shared blob placeholder card's structural classes (the vertical
 *  spacing stands per caller: the image figure carries none of its own, the
 *  file card carries the block spacing). */
const BLOB_PLACEHOLDER_CLASS = `
  mx-0 rounded-(--docblocks-radius)
  border-(length:--docblocks-table-border-width) border-dashed border-(--docblocks-table-border-color)
  outline-none
`;

/** The block spacing the file placeholder mirrors (the file card's own
 *  margins). */
const BLOB_PLACEHOLDER_SPACING = "my-(--docblocks-block-spacing)";

/**
 * The image placeholder's reserved height: the store's intrinsic dimensions
 * stand the card's aspect ratio, so the lazy resolution's landing never
 * shifts the page (the reader's scroll anchor stays put). Without the
 * dimensions the card keeps the status quo (the content's own height).
 */
function blobPlaceholderAspect(meta: { width?: number; height?: number } | null): { aspectRatio: string } | undefined {
  if (meta?.width === undefined || meta.height === undefined) return undefined;
  if (meta.width <= 0 || meta.height <= 0) return undefined;
  return { aspectRatio: `${meta.width} / ${meta.height}` };
}

export { BLOB_PLACEHOLDER_CLASS, BLOB_PLACEHOLDER_SPACING, blobPlaceholderAspect };
