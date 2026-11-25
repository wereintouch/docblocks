/**
 * The structural guards over the merged regions: a column / row operation
 * that would cut a region is rejected — a region stands one cell over its
 * grid rectangle, so a reorder through it would silently move the region's
 * rectangle, and an insert inside it would land a cell on a covered
 * coordinate. The guards read the grid (`resolveTableGrid`), never the cell
 * positions.
 *
 * Removing a column / row the region SPANS shrinks the spans instead (the
 * routine removal stays available); removing the column / row the anchor
 * itself stands on is rejected (the anchor's identity has nowhere to stand).
 */
import * as Y from "yjs";

import type { GridAnchor } from "@docblocks-core/schema";

import { InvalidOperationError } from "../../errors";
import { resolveTableGrid } from "../../read/table-grid";
import { getBlocks } from "../structure";

/** The regions with a column span (the ones a column operation can cut). */
function columnRegions(grid: ReturnType<typeof resolveTableGrid>): GridAnchor[] {
  return (grid?.rows.flat() ?? []).filter((anchor) => anchor.colspan > 1);
}

/** The regions with a row span (the ones a row operation can cut). */
function rowRegions(grid: ReturnType<typeof resolveTableGrid>): GridAnchor[] {
  return (grid?.rows.flat() ?? []).filter((anchor) => anchor.rowspan > 1);
}

/** The region whose column rectangle touches the band `[first, last]` (null when none). */
function regionCrossingColumns(ydoc: Y.Doc, tableId: string, first: number, last: number): GridAnchor | null {
  const from = Math.min(first, last);
  const to = Math.max(first, last);
  return (
    columnRegions(resolveTableGrid(ydoc, tableId)).find(
      (anchor) => anchor.col <= to && anchor.col + anchor.colspan - 1 >= from
    ) ?? null
  );
}

/** The region whose row rectangle touches the band `[first, last]` (null when none). */
function regionCrossingRows(ydoc: Y.Doc, tableId: string, first: number, last: number): GridAnchor | null {
  const from = Math.min(first, last);
  const to = Math.max(first, last);
  return (
    rowRegions(resolveTableGrid(ydoc, tableId)).find(
      (anchor) => anchor.row <= to && anchor.row + anchor.rowspan - 1 >= from
    ) ?? null
  );
}

/** Rejects a column move whose band crosses a region (the moved column and the columns between). */
function assertColumnMoveAllowed(ydoc: Y.Doc, tableId: string, fromIndex: number, toIndex: number): void {
  const crossed = regionCrossingColumns(ydoc, tableId, fromIndex, toIndex);
  if (crossed !== null) {
    throw new InvalidOperationError(
      `The column move crosses a merged region (row ${crossed.row}, columns ${crossed.col}-${crossed.col + crossed.colspan - 1}); split the region before reordering its columns.`
    );
  }
}

/** Rejects a row move whose band crosses a region (the moved row and the rows between). */
function assertRowMoveAllowed(ydoc: Y.Doc, tableId: string, fromIndex: number, toIndex: number): void {
  const crossed = regionCrossingRows(ydoc, tableId, fromIndex, toIndex);
  if (crossed !== null) {
    throw new InvalidOperationError(
      `The row move crosses a merged region (columns ${crossed.col}-${crossed.col + crossed.colspan - 1}, row ${crossed.row}); split the region before reordering its rows.`
    );
  }
}

/** Rejects a column insert strictly inside a region's column span. */
function assertColumnInsertAllowed(ydoc: Y.Doc, tableId: string, index: number): void {
  const inside = columnRegions(resolveTableGrid(ydoc, tableId)).find(
    (anchor) => index > anchor.col && index < anchor.col + anchor.colspan
  );
  if (inside !== undefined) {
    throw new InvalidOperationError(
      `Column ${index} stands inside a merged region (row ${inside.row}, columns ${inside.col}-${inside.col + inside.colspan - 1}); split the region before inserting.`
    );
  }
}

/** Rejects a row insert strictly inside a region's row span. */
function assertRowInsertAllowed(ydoc: Y.Doc, tableId: string, index: number): void {
  const inside = rowRegions(resolveTableGrid(ydoc, tableId)).find(
    (anchor) => index > anchor.row && index < anchor.row + anchor.rowspan
  );
  if (inside !== undefined) {
    throw new InvalidOperationError(
      `Row ${index} stands inside a merged region (rows ${inside.row}-${inside.row + inside.rowspan - 1}, column ${inside.col}); split the region before inserting.`
    );
  }
}

/** The regions a column removal touches: the ones that shrink and the one that blocks. */
interface RemovalStand {
  /** The regions whose column span shrinks by one (the removed column stands inside them). */
  shrink: GridAnchor[];
  /** The region whose own cell stands on the removed column / row (the removal is rejected). */
  blocking: GridAnchor | null;
}

/** The regions a column removal touches (see the command's stand). */
function columnRemovalStand(ydoc: Y.Doc, tableId: string, index: number): RemovalStand {
  const anchors = resolveTableGrid(ydoc, tableId)?.rows.flat() ?? [];
  return {
    shrink: anchors.filter((anchor) => anchor.colspan > 1 && index > anchor.col && index < anchor.col + anchor.colspan),
    blocking: anchors.find((anchor) => anchor.col === index && (anchor.colspan > 1 || anchor.rowspan > 1)) ?? null,
  };
}

/** The regions a row removal touches (see the command's stand). */
function rowRemovalStand(ydoc: Y.Doc, tableId: string, index: number): RemovalStand {
  const anchors = resolveTableGrid(ydoc, tableId)?.rows.flat() ?? [];
  return {
    shrink: anchors.filter((anchor) => anchor.rowspan > 1 && index > anchor.row && index < anchor.row + anchor.rowspan),
    blocking: anchors.find((anchor) => anchor.row === index && (anchor.rowspan > 1 || anchor.colspan > 1)) ?? null,
  };
}

/** The regions a column duplicate would cut (the copy lands inside a span). */
function assertColumnDuplicateAllowed(ydoc: Y.Doc, tableId: string, index: number): void {
  const crossed = regionCrossingColumns(ydoc, tableId, index, index + 1);
  if (crossed !== null) {
    throw new InvalidOperationError(
      `Duplicating column ${index} cuts a merged region (row ${crossed.row}, columns ${crossed.col}-${crossed.col + crossed.colspan - 1}); split the region first.`
    );
  }
}

/** The regions a row duplicate would cut. */
function assertRowDuplicateAllowed(ydoc: Y.Doc, tableId: string, index: number): void {
  const crossed = regionCrossingRows(ydoc, tableId, index, index + 1);
  if (crossed !== null) {
    throw new InvalidOperationError(
      `Duplicating row ${index} cuts a merged region (rows ${crossed.row}-${crossed.row + crossed.rowspan - 1}, column ${crossed.col}); split the region first.`
    );
  }
}

/** The span write a shrink stands on (a span of 1 is the absent key). */
function writeShrunkSpan(ydoc: Y.Doc, anchorId: string, key: "colspan" | "rowspan", value: number): void {
  const cell = getBlocks(ydoc).get(anchorId);
  if (!(cell instanceof Y.Map)) return;
  const attrs = cell.get("attrs");
  if (!(attrs instanceof Y.Map)) return;
  const map = attrs as Y.Map<unknown>;
  if (value <= 1) map.delete(key);
  else map.set(key, value);
}

/** Shrinks the region's column span by one (the caller runs it inside its transaction). */
function shrinkColumnSpan(ydoc: Y.Doc, anchor: GridAnchor): void {
  writeShrunkSpan(ydoc, anchor.id, "colspan", anchor.colspan - 1);
}

/** Shrinks the region's row span by one (the caller runs it inside its transaction). */
function shrinkRowSpan(ydoc: Y.Doc, anchor: GridAnchor): void {
  writeShrunkSpan(ydoc, anchor.id, "rowspan", anchor.rowspan - 1);
}

export {
  assertColumnDuplicateAllowed,
  assertColumnInsertAllowed,
  assertColumnMoveAllowed,
  assertRowDuplicateAllowed,
  assertRowInsertAllowed,
  assertRowMoveAllowed,
  columnRemovalStand,
  rowRemovalStand,
  shrinkColumnSpan,
  shrinkRowSpan,
};
export type { RemovalStand };
