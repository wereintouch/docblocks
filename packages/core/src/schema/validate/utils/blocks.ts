/**
 * The block-level strict checks over a block's plain JSON shape: the
 * `geometry` field (ANY block), the canvas `shape` / `connector`
 * invariants, and the database block (the cell value contract, the
 * recursive filter payload, the dual-shape rows / rowOrder invariants).
 * Run from validateDoc and from the command checks.
 */
import type { BlockType } from "../../block-union";
import { isReservedId } from "../../id-safety";
import { GEOMETRY_FIELDS, MAX_DATABASE_FILTER_DEPTH } from "../models";
import type { ValidationError } from "../models";
import { isPlainObject, show } from "./common";

/**
 * The strict shape of the optional `geometry` field of ANY block: a plain
 * object with finite x/y and w/h > 0, where x/y/w/h are required and
 * unknown fields are rejected. Runs from validateDoc for every block that
 * carries a geometry field.
 */
function validateGeometry(geometry: unknown, path: string, errors: ValidationError[]): void {
  if (!isPlainObject(geometry)) {
    errors.push({ path, message: `geometry must be a plain object (got ${show(geometry)}).` });
    return;
  }
  for (const field of ["x", "y", "w", "h"] as const) {
    if (!(field in geometry)) {
      errors.push({ path: `${path}.${field}`, message: `Field "${field}" of geometry is required.` });
      continue;
    }
    const value = geometry[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push({
        path: `${path}.${field}`,
        message: `geometry.${field} must be a finite number (got ${show(value)}).`,
      });
      continue;
    }
    if ((field === "w" || field === "h") && value <= 0) {
      errors.push({ path: `${path}.${field}`, message: `geometry.${field} must be positive (got ${value}).` });
    }
  }
  for (const field of Object.keys(geometry)) {
    if (!(GEOMETRY_FIELDS as readonly string[]).includes(field)) {
      errors.push({ path: `${path}.${field}`, message: `Unknown field "${field}" for geometry.` });
    }
  }
}

/**
 * The canvas block-level invariants of `shape` / `connector` (strict),
 * over the block's plain JSON shape: the `points` attr is an array of
 * [x, y] pairs of finite numbers (a tuple shape the AttrSpec array kind
 * cannot express — the spec passes any array), and each connector
 * endpoint carries either a weak ref (at least one of docId / blockId,
 * with an optional port — the edge anchor) or a free point (both x and
 * y, finite — with an optional port, the FROZEN direction the line
 * leaves the point at — the last anchor's side, kept while the endpoint
 * stands off the blocks). The enums and the numeric kinds are checked by
 * the registry attrs spec. Runs from validateDoc, and from the
 * insertBlock / updateBlock command checks.
 */
function validateCanvasBlock(
  type: BlockType,
  block: Record<string, unknown>,
  path: string,
  errors: ValidationError[]
): void {
  const attrs = isPlainObject(block.attrs) ? block.attrs : undefined;

  if (attrs === undefined) return;

  const points = attrs.points;
  if (Array.isArray(points)) {
    points.forEach((item, index) => {
      const valid =
        Array.isArray(item) &&
        item.length === 2 &&
        item.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate));
      if (!valid) {
        errors.push({
          path: `${path}.attrs.points[${index}]`,
          message: `A points entry must be a [x, y] pair of finite numbers (got ${show(item)}).`,
        });
      }
    });
  }

  if (type === "connector") {
    for (const key of ["start", "end"] as const) {
      const ref = attrs[key];
      if (!isPlainObject(ref)) continue; // a malformed ref is reported by the object spec
      const isRef = "docId" in ref || "blockId" in ref;
      const isFree = "x" in ref || "y" in ref;
      if (!isRef && !isFree) {
        errors.push({
          path: `${path}.attrs.${key}`,
          message: `Connector endpoint "${key}" must carry a block ref (docId / blockId) or a free point (x and y).`,
        });
        continue;
      }
      if (isFree && "x" in ref !== "y" in ref) {
        errors.push({
          path: `${path}.attrs.${key}`,
          message: `Connector endpoint "${key}" free point: x and y must stand together.`,
        });
      }
      if ("port" in ref && !isRef && !("x" in ref && "y" in ref)) {
        errors.push({
          path: `${path}.attrs.${key}`,
          message: `Connector endpoint "${key}" port requires a block ref (docId / blockId) or a free point (x and y — the frozen direction).`,
        });
      }
      if ("portT" in ref) {
        // The edge anchor's fractional position : it stands on a BLOCK REF's port only (a free
        // point's port is the frozen direction — t stands no anchor
        // position there) and within the side's [0, 1].
        if (!isRef || !("port" in ref)) {
          errors.push({
            path: `${path}.attrs.${key}`,
            message: `Connector endpoint "${key}" portT requires the port on a block ref (the edge anchor's position along the side).`,
          });
        } else if (typeof ref.portT !== "number" || !Number.isFinite(ref.portT) || ref.portT < 0 || ref.portT > 1) {
          errors.push({
            path: `${path}.attrs.${key}.portT`,
            message: `The connector endpoint's portT must stand within the side's 0–1 (got ${show(ref.portT)}).`,
          });
        }
      }
    }
  }
}

/**
 * The cell value contract of a database column type (text / date: a
 * non-empty string, date being a plain string in v1; number: a finite
 * number; checkbox: a boolean; select: a string from the column options;
 * multi-select: an array of the column options, possibly empty). Shared
 * by the validator's database branch and the setCell command. Returns the
 * violation clause, or null when the value is valid.
 */
function checkDatabaseCellValue(
  columnType: string,
  options: readonly string[] | undefined,
  value: unknown
): string | null {
  const optionList = JSON.stringify(options ?? []);
  switch (columnType) {
    case "text":
    case "date":
      return typeof value === "string" && value.length > 0 ? null : "must be a non-empty string";
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "must be a finite number";
    case "checkbox":
      return typeof value === "boolean" ? null : "must be a boolean";
    case "select":
      return typeof value === "string" && (options?.includes(value) ?? false)
        ? null
        : `must be one of the column options ${optionList}`;
    case "multi-select":
      return Array.isArray(value) &&
        value.every((item): item is string => typeof item === "string" && (options?.includes(item) ?? false))
        ? null
        : `must be an array of the column options ${optionList}`;
    default:
      return `cannot be checked (unknown column type ${show(columnType)})`;
  }
}

/**
 * The recursive and/or filter payload (the `filter` attr): a plain object
 * with the `logic` and/or + the `conditions` list (the column id, the
 * operator) + the optional `groups` recursion. The recursion is not
 * expressible in the flat AttrSpec, so the structure is checked here,
 * like the type-dependent options presence.
 */
function checkDatabaseFilter(value: unknown, path: string, errors: ValidationError[], depth = 0): void {
  if (!isPlainObject(value)) {
    errors.push({ path, message: `The filter must be a plain object (got ${show(value)}).` });
    return;
  }
  const logic = value.logic;
  if (logic !== "and" && logic !== "or") {
    errors.push({
      path: `${path}.logic`,
      message: `The filter logic must be "and" or "or" (got ${show(logic)}).`,
    });
  }
  const conditions = value.conditions;
  if (!Array.isArray(conditions)) {
    errors.push({
      path: `${path}.conditions`,
      message: `The filter conditions must be an array (got ${show(conditions)}).`,
    });
  } else {
    conditions.forEach((condition, index) => {
      const condPath = `${path}.conditions[${index}]`;
      if (!isPlainObject(condition)) {
        errors.push({ path: condPath, message: `A filter condition must be a plain object (got ${show(condition)}).` });
        return;
      }
      if (typeof condition.columnId !== "string" || condition.columnId.length === 0) {
        errors.push({
          path: `${condPath}.columnId`,
          message: `A filter condition requires a non-empty columnId (got ${show(condition.columnId)}).`,
        });
      }
      if (typeof condition.op !== "string" || condition.op.length === 0) {
        errors.push({
          path: `${condPath}.op`,
          message: `A filter condition requires a non-empty op (got ${show(condition.op)}).`,
        });
      }
    });
  }
  const groups = value.groups;
  if (groups === undefined || groups === null) return;
  if (!Array.isArray(groups)) {
    errors.push({
      path: `${path}.groups`,
      message: `The filter groups must be an array or null (got ${show(groups)}).`,
    });
    return;
  }
  groups.forEach((group, index) => {
    if (depth + 1 <= MAX_DATABASE_FILTER_DEPTH) {
      checkDatabaseFilter(group, `${path}.groups[${index}]`, errors, depth + 1);
    } else {
      errors.push({
        path: `${path}.groups[${index}]`,
        message: `The filter exceeds the maximum recursion depth (${MAX_DATABASE_FILTER_DEPTH}).`,
      });
    }
  });
}

/**
 * The rows / rowOrder invariants of a database block (strict), over the
 * block's plain JSON shape: each cell value matches its column type (a
 * select / multi-select value is one of the column options), every cell
 * key is a known column id, `rowOrder` is a string array whose set equals
 * the rows' key set (no missing, extra, or duplicated row), and `options`
 * is present exactly for the select / multi-select columns (the
 * type-dependent presence is a database-level rule, like the table's
 * `cols` row-count rule). The column shape itself is checked separately by
 * the registry attrs spec (the `array` kind with per-column `object`
 * items). Runs from validateDoc and from the updateBlock post-patch check.
 */
function validateDatabaseBlock(block: Record<string, unknown>, path: string, errors: ValidationError[]): void {
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
      // the rest.
      const type = column.type;
      if (type === "select" || type === "multi-select") {
        if (!Array.isArray(column.options) || column.options.length === 0) {
          errors.push({
            path: `${path}.attrs.columns`,
            message: `Column "${id}" of type "${type}" requires a non-empty options array.`,
          });
        }
      } else if ("options" in column) {
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

export { checkDatabaseCellValue, checkDatabaseFilter, validateCanvasBlock, validateDatabaseBlock, validateGeometry };
