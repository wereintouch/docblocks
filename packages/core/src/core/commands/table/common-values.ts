/** The table's value checks (the width / the cell colors) + the
 * `columnWidths`' identity-keyed map (the read-time derivation's stand) +
 * the cell color writes. They run inside the caller's transaction; none of
 * them opens a transaction of its own. The layout's accessors stand in the
 * sibling common-layout.ts, the subtree-copy's helpers in common-copy.ts
 * (the former common.ts's stand). */
import * as Y from "yjs";

import { validateBlockAttrs } from "@docblocks-core/schema";

import { InvalidAttrsError, formatValidationErrors } from "../../errors";
import { writeAttrValue } from "../../layout";
import { getBlockMap } from "../structure";

/** The minimum column width (the validator's `columnWidths` item min). */
const MIN_COLUMN_WIDTH = 50;

/** The width value check (the validator's item rule, no silent clamp). */
function assertWidth(width: number, tableId: string): void {
  if (typeof width !== "number" || !Number.isFinite(width) || width < MIN_COLUMN_WIDTH) {
    throw new InvalidAttrsError(
      `Invalid column width for table "${tableId}": a finite number >= ${MIN_COLUMN_WIDTH} (got ${width}).`
    );
  }
}

/** The cell color value check (the table-cell's hex color rule). */
function assertCellColor(key: "columnColor" | "rowColor", color: string, tableId: string): void {
  const errors = validateBlockAttrs("table-cell", { [key]: color });
  if (errors.length > 0) {
    throw new InvalidAttrsError(`Invalid ${key} for table "${tableId}": ${formatValidationErrors(errors)}`);
  }
}

/** The table's identity-keyed `columnWidths` map (columnId → width; null when absent — the defaults stand at read time). */
function widthsMap(table: Y.Map<unknown>): Y.Map<unknown> | null {
  const attrs = table.get("attrs");
  if (!(attrs instanceof Y.Map)) return null;
  const widths = attrs.get("columnWidths");
  return widths instanceof Y.Map ? (widths as Y.Map<unknown>) : null;
}

/** The stored (explicit) width of a column (null when absent — the default stands at read time). */
function readWidthOf(table: Y.Map<unknown>, columnId: string): number | null {
  const widths = widthsMap(table);
  if (widths === null) return null;
  const value = widths.get(columnId);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Ensures the identity-keyed width map exists on the table's attrs (creating the attrs map if absent; a foreign value — like a positional Y.Array — is replaced). */
function ensureWidthsMap(table: Y.Map<unknown>): Y.Map<unknown> {
  const existing = widthsMap(table);
  if (existing !== null) return existing;
  const attrs = table.get("attrs");
  if (attrs instanceof Y.Map) {
    const map = new Y.Map<unknown>();
    attrs.set("columnWidths", map);
    return map;
  }
  const freshAttrs = new Y.Map<unknown>();
  const map = new Y.Map<unknown>();
  freshAttrs.set("columnWidths", map);
  table.set("attrs", freshAttrs);
  return map;
}

/**
 * Writes the table's positional `columnWidths` patch (one entry per
 * `columnOrder` id) into the identity-keyed map inside the caller's
 * transaction. The generic attr writer must not run for this key: a
 * positional Y.Array would replace the identity map, and the read-time
 * derivation (identity map + columnOrder) would fall back to the default
 * width for every column.
 */
function writeColumnWidthsPatch(table: Y.Map<unknown>, columnIds: readonly string[], widths: readonly number[]): void {
  const map = ensureWidthsMap(table);
  columnIds.forEach((columnId, i) => {
    const value = widths[i];
    if (typeof value === "number" && Number.isFinite(value)) map.set(columnId, value);
  });
}

/** Sets (or removes) one color attr on a cell inside the caller's transaction. */
function setCellColor(ydoc: Y.Doc, cellId: string, key: "columnColor" | "rowColor", color: string | null): void {
  const cell = getBlockMap(ydoc, cellId);
  if (cell === null) return;
  const attrs = cell.get("attrs");
  if (color === null) {
    if (attrs instanceof Y.Map) (attrs as Y.Map<unknown>).delete(key);
    return;
  }
  if (attrs instanceof Y.Map) {
    writeAttrValue(attrs as Y.Map<unknown>, key, color);
    return;
  }
  const fresh = new Y.Map<unknown>();
  writeAttrValue(fresh, key, color);
  cell.set("attrs", fresh);
}

/** Reads one color attr of a cell (null when absent or invalid). */
function readCellColor(ydoc: Y.Doc, cellId: string, key: "rowColor" | "columnColor"): string | null {
  const cell = getBlockMap(ydoc, cellId);
  if (cell === null) return null;
  const attrs = cell.get("attrs");
  if (!(attrs instanceof Y.Map)) return null;
  const value = (attrs as Y.Map<unknown>).get(key);
  return typeof value === "string" ? value : null;
}

export {
  assertCellColor,
  assertWidth,
  ensureWidthsMap,
  readCellColor,
  readWidthOf,
  setCellColor,
  widthsMap,
  writeColumnWidthsPatch,
};
