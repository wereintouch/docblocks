/**
 * The database block's payload contract checks: the cell value's contract
 * per column type (shared by the validator's database branch and the
 * setCell command) and the recursive and/or filter's payload shape (the
 * `filter` attribute).
 */
import { DATABASE_CELL_TYPES } from "../../constants";
import { MAX_DATABASE_FILTER_DEPTH } from "../constants";
import type { ValidationError } from "../models";
import { isPlainObject, show } from "./common";

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

/** The column type is a known v1 type (its value contract stands checked; a future type is the cross-minor additive — the lenient load skips its value check, the data stands). */
function isKnownDatabaseColumnType(type: string): boolean {
  return (DATABASE_CELL_TYPES as readonly string[]).includes(type);
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

export { checkDatabaseCellValue, checkDatabaseFilter, isKnownDatabaseColumnType };
