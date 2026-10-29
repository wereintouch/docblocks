/**
 * The column annotation: the operator catalog + the value input kind derived
 * from the column's Postgres type (the package's default catalog; the
 * consumer's `operators` override always wins) + the column's reference kind
 * (the enum / row-link columns stand the option-based catalog). The filter
 * builder renders from this; `queryRows` must apply exactly the declared
 * operators.
 */
import type { BridgeColumn, BridgeColumnAnnotation, BridgeValueInput } from "./models";

/** The operators that take no value (the emptiness checks). */
const VALUELESS_OPERATORS = new Set(["empty", "not empty"]);

/** The string operators (the text-like columns). */
const TEXT_OPERATORS = ["is", "is not", "contains", "not contains", "starts with", "ends with", "empty", "not empty"];
/** The comparison operators (the numeric columns). */
const NUMBER_OPERATORS = ["is", "is not", "<", "<=", ">", ">=", "between"];
/** The date / datetime operators. */
const DATE_OPERATORS = ["is", "before", "after", "between"];
/** The time-of-day operators. */
const TIME_OPERATORS = ["is", "is not", "before", "after", "between"];
/** The equality-only operators (the boolean / interval / unknown). */
const EQUALITY_OPERATORS = ["is", "is not"];

/** The standard PostgreSQL type names per operator / input group. The contract
 *  is type-agnostic — this is the package's DEFAULT catalog; a non-standard
 *  type name falls back to the minimal `is` / `is not` + the text input, and
 *  the consumer's `operators` override always wins. */
const TEXT_TYPES = new Set([
  "text",
  "varchar",
  "character varying",
  "char",
  "character",
  "citext",
  "name",
  "xml",
  "tsvector",
  "tsquery",
  "bytea",
  "inet",
  "cidr",
  "macaddr",
  "macaddr8",
  "point",
  "line",
  "lseg",
  "box",
  "path",
  "polygon",
  "circle",
]);
const NUMBER_TYPES = new Set([
  "number",
  "smallint",
  "integer",
  "int",
  "bigint",
  "real",
  "double precision",
  "numeric",
  "decimal",
  "money",
]);
const BOOLEAN_TYPES = new Set(["boolean", "bool"]);
const DATE_TYPES = new Set(["date"]);
const DATETIME_TYPES = new Set(["timestamp", "timestamptz", "timestamp with time zone", "timestamp without time zone"]);
const TIME_TYPES = new Set(["time", "timetz", "time with time zone", "time without time zone"]);
const INTERVAL_TYPES = new Set(["interval"]);

/** The base type of a (possibly array) type name: `integer[]` → `integer`. */
function baseType(type: string): string {
  return type.replace(/\[\]$/, "").trim();
}

/** The package's default operator catalog for a type name (undefined = the minimal fallback). */
function operatorCatalog(type: string): string[] | undefined {
  const base = baseType(type);
  if (TEXT_TYPES.has(base)) return TEXT_OPERATORS;
  if (NUMBER_TYPES.has(base)) return NUMBER_OPERATORS;
  if (BOOLEAN_TYPES.has(base) || INTERVAL_TYPES.has(base)) return EQUALITY_OPERATORS;
  if (DATE_TYPES.has(base) || DATETIME_TYPES.has(base)) return DATE_OPERATORS;
  if (TIME_TYPES.has(base)) return TIME_OPERATORS;
  return undefined;
}

/** The package's default value input kind for a type name (undefined = the text fallback). */
function valueInputFor(type: string): BridgeValueInput | undefined {
  const base = baseType(type);
  if (TEXT_TYPES.has(base)) return "text";
  if (NUMBER_TYPES.has(base)) return "number";
  if (BOOLEAN_TYPES.has(base)) return "boolean";
  if (DATE_TYPES.has(base)) return "date";
  if (DATETIME_TYPES.has(base)) return "datetime";
  if (TIME_TYPES.has(base) || INTERVAL_TYPES.has(base)) return "text";
  return undefined;
}

/**
 * Builds the column annotation from the `BridgeColumn`: the operator
 * catalog (the consumer's `operators` override, else the option-based
 * catalog for the option columns, else the package default for the
 * Postgres type, else the minimal `is` / `is not`) + the value input
 * kind. The filter builder renders from this; `queryRows` must apply
 * exactly the declared operators.
 */
function columnAnnotation(column: BridgeColumn): BridgeColumnAnnotation {
  let operators: string[];
  if (column.operators !== undefined) {
    operators = [...column.operators];
  } else if (column.refKind === "enum" || column.refKind === "row") {
    operators = column.refMany ? ["is", "is not", "empty", "not empty"] : ["is", "is not"];
  } else {
    operators = operatorCatalog(column.type) ?? ["is", "is not"];
  }
  let valueInput: BridgeValueInput;
  if (column.refKind === "enum") valueInput = "enum";
  else if (column.refKind === "row") valueInput = "row-link";
  else valueInput = valueInputFor(column.type) ?? "text";
  const valueless = new Set(operators.filter((operator) => VALUELESS_OPERATORS.has(operator)));
  return { operators, valueInput, valueless };
}

export { TEXT_TYPES, VALUELESS_OPERATORS, columnAnnotation };
