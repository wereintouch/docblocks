/**
 * The table block's invariants: the `columnOrder`'s set + the
 * `columnWidths` mirror, and the row/cell grid — the cells' column bindings
 * and the merged regions' spans. Run from validateDoc.
 */
import { isReservedId } from "../../id-safety";
import { buildTableGrid } from "../../table-grid";
import type { GridCellInput } from "../../table-grid";
import type { ValidationError } from "../models";
import { isPlainObject } from "./common";

/**
 * The table's invariants: the column set + the width mirror, and the grid —
 * every row holds at most the table's column order cells, each bound to a
 * column of it, and the merged regions fit the table's free coordinates.
 */
function validateTableInvariants(blocks: Record<string, unknown>, errors: ValidationError[]): void {
  // The table's columnOrder invariants (once each): the column set (unique
  // non-empty ids), and the columnWidths mirror the set (one width per column).
  for (const [id, block] of Object.entries(blocks)) {
    if (!isPlainObject(block) || block.type !== "table") continue;
    const columnOrder = (block as { columnOrder?: unknown }).columnOrder;
    if (!Array.isArray(columnOrder)) {
      errors.push({
        path: `blocks.${id}.columnOrder`,
        message: "A table must carry a columnOrder array of column ids.",
      });
      continue;
    }
    const columnIds = columnOrder as unknown[];
    // The column set is unique (no duplicate column ids).
    const seen = new Set<string>();
    let setValid = true;
    for (const columnId of columnIds) {
      if (typeof columnId !== "string" || columnId === "" || seen.has(columnId)) {
        errors.push({
          path: `blocks.${id}.columnOrder`,
          message: "The table's columnOrder must be an array of unique non-empty column ids.",
        });
        setValid = false;
        break;
      }
      // A reserved column id (an Object.prototype key) would be lost on the
      // JSON export (the id-keyed-map trap): reject it.
      if (isReservedId(columnId)) {
        errors.push({
          path: `blocks.${id}.columnOrder`,
          message: `The column id "${columnId}" is reserved (it collides with Object.prototype) and cannot be used.`,
        });
        setValid = false;
        break;
      }
      seen.add(columnId);
    }
    const cols = columnIds.length;
    const widths = (block as { attrs?: { columnWidths?: unknown } }).attrs?.columnWidths;
    if (setValid && Array.isArray(widths) && widths.length !== cols) {
      errors.push({
        path: `blocks.${id}.attrs.columnWidths`,
        message: `The table's columnWidths must hold exactly ${cols} width(s); found ${widths.length}.`,
      });
    }
  }

  // The rows' cells: each cell binds to a column of the table's columnOrder,
  // and each merged region (the anchor cell's spans) stands inside the table
  // over free coordinates. The grid resolver is the placement's single
  // source: a row is legitimately shorter than the column set — the covered
  // cells and the race residue leave gaps.
  for (const block of Object.values(blocks)) {
    if (!isPlainObject(block) || block.type !== "table") continue;
    const columnOrder = (block as { columnOrder?: unknown }).columnOrder;
    if (!Array.isArray(columnOrder)) continue; // reported above
    const columnIds = columnOrder.filter((columnId): columnId is string => typeof columnId === "string");
    if (columnIds.length !== columnOrder.length) continue; // reported above
    const columnSet = new Set(columnIds);
    const rowIds = Array.isArray((block as { children?: unknown }).children)
      ? (block as { children: unknown[] }).children.filter((rowId): rowId is string => typeof rowId === "string")
      : [];
    const rows: GridCellInput[][] = [];
    for (const rowId of rowIds) {
      const row = blocks[rowId];
      if (!isPlainObject(row) || row.type !== "table-row") {
        rows.push([]); // a missing / mis-typed row stands the structure pass's report
        continue;
      }
      const children = (row as { children?: unknown }).children;
      if (!Array.isArray(children)) {
        errors.push({
          path: `blocks.${rowId}.children`,
          message: "A table row must carry a children array of cell ids.",
        });
        rows.push([]);
        continue;
      }
      if (children.length > columnIds.length) {
        errors.push({
          path: `blocks.${rowId}.children`,
          message: `A table row must not hold more than ${columnIds.length} cell(s); found ${children.length}.`,
        });
      }
      const cells: GridCellInput[] = [];
      for (const cellId of children) {
        if (typeof cellId !== "string") continue;
        const cell = blocks[cellId];
        if (!isPlainObject(cell) || cell.type !== "table-cell") continue; // the structure pass's stand
        const attrs = isPlainObject(cell.attrs) ? (cell.attrs as Record<string, unknown>) : {};
        const columnId = typeof attrs.columnId === "string" && attrs.columnId !== "" ? attrs.columnId : null;
        if (columnId !== null && !columnSet.has(columnId)) {
          errors.push({
            path: `blocks.${cellId}.attrs.columnId`,
            message: `The cell's columnId must stand a column of the table's columnOrder; found ${JSON.stringify(columnId)}.`,
          });
        }
        cells.push({
          id: cellId,
          columnId,
          colspan: typeof attrs.colspan === "number" ? attrs.colspan : 1,
          rowspan: typeof attrs.rowspan === "number" ? attrs.rowspan : 1,
        });
      }
      rows.push(cells);
    }
    const { clamped, collisions, overflow } = buildTableGrid(columnIds, rows);
    for (const anchor of clamped) {
      errors.push({
        path: `blocks.${anchor.id}.attrs`,
        message: `The cell's merged region must stand inside the table and over free cells; the span ${anchor.colspan} x ${anchor.rowspan} is what fits.`,
      });
    }
    for (const cellId of collisions) {
      errors.push({
        path: `blocks.${cellId}.attrs.columnId`,
        message: "Two cells stand in the same column of a table row (a merged region covers the cell's column).",
      });
    }
    for (const cellId of overflow) {
      errors.push({
        path: `blocks.${cellId}.attrs`,
        message: "The row's cells do not fit the table's free columns.",
      });
    }
  }
}

export { validateTableInvariants };
