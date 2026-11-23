/**
 * The table block's invariants: the `columnOrder`'s set + the
 * `columnWidths` mirror; the table-row's cell binding over the column's
 * position. Run from validateDoc.
 */
import { isReservedId } from "../../id-safety";
import type { ValidationError } from "../models";
import { isPlainObject } from "./common";

/**
 * The table's invariants (once each): the column set + the width mirror;
 * every table row holds AT MOST the parent table's columnOrder cells, each
 * bound to its column by `columnId`.
 */
function validateTableInvariants(
  blocks: Record<string, unknown>,
  firstParent: Map<string, { parentId: string; path: string }>,
  referenceCount: Map<string, number>,
  errors: ValidationError[]
): void {
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

  // Every table row holds AT MOST the parent table's columnOrder cells,
  // each bound to its column by `columnId`. A short row (fewer cells than
  // columns) is a valid CRDT race residue: a row created before a
  // concurrent column insert keeps its cell set, and the read/UI stands the
  // missing cells as placeholders (the cells stand by id, not position). An
  // overfull row is corrupt (a cell can exist only for a column that was in
  // the columnOrder when it was written). On a full row, each cell's
  // columnId must match its position in the columnOrder (the cells stand in
  // columnOrder order).
  for (const [id, block] of Object.entries(blocks)) {
    if (!isPlainObject(block) || block.type !== "table-row") continue;
    if (referenceCount.get(id) !== 1) continue; // missing/multiple parents are reported above
    const reference = firstParent.get(id);
    if (!reference) continue;
    const parent = blocks[reference.parentId];
    if (!isPlainObject(parent) || parent.type !== "table") continue;
    const columnOrder = (parent as { columnOrder?: unknown }).columnOrder;
    if (!Array.isArray(columnOrder)) continue; // invalid columnOrder is reported on the table
    const columnIds = columnOrder as unknown[];
    const children = block.children;
    if (!Array.isArray(children)) {
      errors.push({
        path: `blocks.${id}.children`,
        message: "A table row must carry a children array of cell ids.",
      });
      continue;
    }
    if (children.length > columnIds.length) {
      errors.push({
        path: `blocks.${id}.children`,
        message: `A table row must not hold more than ${columnIds.length} cell(s); found ${children.length}.`,
      });
      continue;
    }
    if (children.length < columnIds.length) continue; // race residue: the read stands the missing cells as placeholders
    // Full row: each cell's columnId matches its position in the columnOrder.
    children.forEach((cellId, position) => {
      const cell = blocks[cellId as string];
      if (!isPlainObject(cell) || cell.type !== "table-cell") return; // missing/mis-typed cells are reported above
      const columnId = (cell as { attrs?: { columnId?: unknown } }).attrs?.columnId;
      const expected = columnIds[position];
      if (columnId !== expected) {
        errors.push({
          path: `blocks.${cellId as string}.attrs.columnId`,
          message: `The cell's columnId must stand ${JSON.stringify(expected)} (its position in the table's columnOrder); found ${JSON.stringify(columnId)}.`,
        });
      }
    });
  }
}

export { validateTableInvariants };
