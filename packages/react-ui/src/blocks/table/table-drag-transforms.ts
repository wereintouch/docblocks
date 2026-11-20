/** The table's drag-preview math (pure): the dragged row / column's live
 * dx / dy, the stationary rows / columns' parting shift, the handle
 * geometry (the column centers, the seam x's). View state only — the doc
 * stands the commit on the release. */
import { HANDLE_ZONE } from "./constants";
import type { HandleKind, TableDragPreview } from "./models";

/** The handle's preview stand (the live drag over this row / column). */
function isTablePreview(preview: TableDragPreview | null, kind: HandleKind, index: number): boolean {
  return preview !== null && preview.kind === kind && preview.index === index;
}

/** The parting preview: the stationary rows / columns' shift (px) over the
 * live drop index (the dragged row / column's own cells stand the
 * pointer's dx / dy). */
function previewShiftOf(preview: TableDragPreview, index: number): number {
  if (preview.toIndex === null || index === preview.index) return 0;
  const to = preview.toIndex;
  const shift = index < preview.index ? (index >= to ? 1 : 0) : index - 1 < to ? -1 : 0;
  return shift * preview.startSize;
}

/** The per-column drag transform (the cells' dx): the dragged column's live dx, the stationary columns' parting shift. */
function columnDragTransformOf(preview: TableDragPreview | null, index: number): { dx: number; shifted: boolean } {
  if (preview === null || preview.kind !== "column") return { dx: 0, shifted: false };
  if (index === preview.index) return { dx: preview.dx, shifted: false };
  return { dx: previewShiftOf(preview, index), shifted: true };
}

/** The per-row drag transform (the rows' dy): the dragged row's live dy, the stationary rows' parting shift. */
function rowDragTransformOf(preview: TableDragPreview | null, index: number): { dy: number; shifted: boolean } {
  if (preview === null || preview.kind !== "row") return { dy: 0, shifted: false };
  if (index === preview.index) return { dy: preview.dy, shifted: false };
  return { dy: previewShiftOf(preview, index), shifted: true };
}

/** The column handles' horizontal centers (the widths are the layout
 * source — no DOM measurement for the columns). */
function columnCentersOf(widths: number[]): number[] {
  const centers: number[] = [];
  let acc = HANDLE_ZONE;
  for (const width of widths) {
    centers.push(acc + width / 2);
    acc += width;
  }
  return centers;
}

/** The column seams' x (seam i stands at the LEFT edge of column i — the
 * boundary between column i-1 and i; a seam resizes the column to its
 * LEFT, the first column's left edge has no seam). The rendered seams
 * stand at every column's RIGHT edge (the boundary of col + 1, or the
 * table's right edge for the last column). */
function seamXsOf(widths: number[]): number[] {
  const seams: number[] = [];
  let acc = HANDLE_ZONE;
  for (const width of widths) {
    seams.push(acc);
    acc += width;
  }
  return seams;
}

export { columnCentersOf, columnDragTransformOf, isTablePreview, rowDragTransformOf, seamXsOf };
