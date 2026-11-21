/**
 * The rows / rowOrder / columns invariants of a database block
 * (validateDatabaseBlock): the dual inline / external shape, the
 * type-dependent options presence, and the cell values over the column
 * types.
 */
import { isReservedId } from "../../id-safety";
import type { ValidationError } from "../models";
import { isPlainObject, show } from "./common";
import { checkDatabaseCellValue, checkDatabaseFilter, isKnownDatabaseColumnType } from "./database-contract";

/**
 * The rows / rowOrder invariants of a database block, over the block's
 * plain JSON shape: each cell value matches its column type (a
 * select / multi-select value is one of the column options), every cell
 * key is a known column id, `rowOrder` is a string array whose set equals
 * the rows' key set (no missing, extra, or duplicated row), and `options`
 * is present exactly for the select / multi-select columns (the
 * type-dependent presence is a database-level rule, like the table's
 * `cols` row-count rule). The column shape itself is checked separately by
 * the registry attrs spec (the `array` kind with per-column `object`
 * items). The lenient stand (the cross-minor load) skips the checks that
 * depend on a future (unknown) column type: its value contract and its
 * options presence cannot be known to this reader (the data stands).
 * Runs from validateDoc (the lenient flag) and from the updateBlock
 * post-patch check (strict).
 */
function validateDatabaseBlock(
  block: Record<string, unknown>,
  path: string,
  errors: ValidationError[],
  lenient = false
): void {
  const attrs = isPlainObject(block.attrs) ? block.attrs : undefined;
  // The dual shape: the external form (a non-empty `tableId` reference)
  // carries no inline schema or rows — the rows and the columns live in
  // the consumer's relational table; the inline form requires `columns`.
  // The mutual exclusion is a database-level rule, like the type-dependent
  // options presence.
  const tableId = attrs !== undefined ? attrs.tableId : undefined;
  const external = typeof tableId === "string" && tableId.length > 0;
  if (attrs !== undefined && attrs.filter !== undefined) {
    checkDatabaseFilter(attrs.filter, `${path}.attrs.filter`, errors);
  }
  const columns: Array<{ id: string; type: string; options?: string[] }> = [];
  if (external && attrs !== undefined && attrs.columns !== undefined) {
    errors.push({
      path: `${path}.attrs.columns`,
      message: `The external form (the "tableId" reference) must not carry the inline "columns" schema.`,
    });
  } else if (attrs !== undefined && Array.isArray(attrs.columns)) {
    for (const column of attrs.columns) {
      if (!isPlainObject(column)) continue; // the column shape is reported by the attrs spec
      const id = typeof column.id === "string" ? column.id : "";
      if (id.length === 0) continue;
      // A reserved column id (an Object.prototype key) would be lost on the
      // JSON export (the id-keyed-map trap): reject it.
      if (isReservedId(id)) {
        errors.push({
          path: `${path}.attrs.columns`,
          message: `The column id "${id}" is reserved (it collides with Object.prototype) and cannot be used.`,
        });
        continue;
      }
      if (columns.some((existing) => existing.id === id)) {
        errors.push({ path: `${path}.attrs.columns`, message: `Duplicate column id "${id}".` });
        continue;
      }
      const options = Array.isArray(column.options)
        ? column.options.filter((option): option is string => typeof option === "string")
        : undefined;
      columns.push({ id, type: typeof column.type === "string" ? column.type : "", options });

      // The type-dependent options presence: required for the option-based
      // types (an empty option list would admit no valid value), absent for
      // the rest. A future (unknown) column type stands unchecked over a
      // lenient load — its options contract is unknown to this reader.
      const type = typeof column.type === "string" ? column.type : "";
      const knownType = isKnownDatabaseColumnType(type);
      if (type === "select" || type === "multi-select") {
        if (!Array.isArray(column.options) || column.options.length === 0) {
          errors.push({
            path: `${path}.attrs.columns`,
            message: `Column "${id}" of type "${type}" requires a non-empty options array.`,
          });
        }
      } else if ("options" in column && (!lenient || knownType)) {
        errors.push({
          path: `${path}.attrs.columns`,
          message: `Column "${id}" of type "${show(type)}" must not carry options (select / multi-select only).`,
        });
      }
    }
  }
  if (!external && attrs !== undefined && attrs.columns === undefined) {
    errors.push({
      path: `${path}.attrs.columns`,
      message: `Missing required field "columns" (the inline form); the external form sets "tableId".`,
    });
  }

  const rows = isPlainObject(block.rows) ? block.rows : undefined;
  if (rows === undefined) {
    if (!external && block.rows === undefined) {
      errors.push({ path: `${path}.rows`, message: `Missing required field "rows".` });
    } else if (block.rows !== undefined) {
      errors.push({
        path: `${path}.rows`,
        message: `rows must be a plain object (got ${show(block.rows)}).`,
      });
    }
  } else if (external && Object.keys(rows).length > 0) {
    errors.push({
      path: `${path}.rows`,
      message: `The external form (the "tableId" reference) must not carry inline rows.`,
    });
  }
  if (!external) {
    for (const [rowId, cells] of Object.entries(rows ?? {})) {
      // A reserved row id (an Object.prototype key) would be lost on the JSON
      // export (the id-keyed-map trap): reject it.
      if (isReservedId(rowId)) {
        errors.push({
          path: `${path}.rows.${rowId}`,
          message: `The row id "${rowId}" is reserved (it collides with Object.prototype) and cannot be used.`,
        });
        continue;
      }
      if (!isPlainObject(cells)) {
        errors.push({
          path: `${path}.rows.${rowId}`,
          message: `Row "${rowId}" must be a plain object of cell values (got ${show(cells)}).`,
        });
        continue;
      }
      for (const [colId, value] of Object.entries(cells)) {
        const column = columns.find((entry) => entry.id === colId);
        if (column === undefined) {
          errors.push({
            path: `${path}.rows.${rowId}.${colId}`,
            message: `Unknown column id "${colId}" in row "${rowId}".`,
          });
          continue;
        }
        // The future column type (the cross-minor additive): its value
        // contract cannot be checked over a lenient load (the data stands).
        if (lenient && !isKnownDatabaseColumnType(column.type)) continue;
        const violation = checkDatabaseCellValue(column.type, column.options, value);
        if (violation !== null) {
          errors.push({
            path: `${path}.rows.${rowId}.${colId}`,
            message: `Cell (row "${rowId}", column "${colId}") ${violation} (got ${show(value)}).`,
          });
        }
      }
    }
  }

  const rowOrder = block.rowOrder;
  if (rowOrder === undefined) {
    if (!external) errors.push({ path: `${path}.rowOrder`, message: `Missing required field "rowOrder".` });
    return;
  }
  if (!Array.isArray(rowOrder)) {
    errors.push({ path: `${path}.rowOrder`, message: `rowOrder must be an array of row ids (got ${show(rowOrder)}).` });
    return;
  }
  if (external) {
    if (rowOrder.length > 0) {
      errors.push({
        path: `${path}.rowOrder`,
        message: `The external form (the "tableId" reference) must not carry inline row order.`,
      });
    }
    return;
  }
  const orderIds: string[] = [];
  rowOrder.forEach((rowId, index) => {
    if (typeof rowId !== "string" || rowId.length === 0) {
      errors.push({
        path: `${path}.rowOrder[${index}]`,
        message: `A row id must be a non-empty string (got ${show(rowId)}).`,
      });
      return;
    }
    if (isReservedId(rowId)) {
      errors.push({
        path: `${path}.rowOrder[${index}]`,
        message: `The row id "${rowId}" is reserved (it collides with Object.prototype) and cannot be used.`,
      });
      return;
    }
    orderIds.push(rowId);
  });
  const seen = new Set<string>();
  for (const rowId of orderIds) {
    if (seen.has(rowId))
      errors.push({ path: `${path}.rowOrder`, message: `rowOrder lists row "${rowId}" more than once.` });
    seen.add(rowId);
  }
  for (const rowId of Object.keys(rows ?? {})) {
    if (!seen.has(rowId)) {
      errors.push({ path: `${path}.rowOrder`, message: `rowOrder is missing row "${rowId}" (present in rows).` });
    }
  }
  for (const rowId of orderIds) {
    if (rows === undefined || !(rowId in rows)) {
      errors.push({ path: `${path}.rowOrder`, message: `rowOrder lists row "${rowId}" (no cells entry in rows).` });
    }
  }
}

export { validateDatabaseBlock };
