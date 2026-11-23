/**
 * The grid-facing's contract's shapes (the bridge column / table
 * description's view over the wire's schema — the display attributes
 * flattened, the cell annotation + the value's parse contract).
 */
/**
 * A bridge column (the grid's view over the wire's `Column` — the display
 * attributes flattened, the reference relation's fields in the wire's
 * `reference` stand). The `type` is a standard PostgreSQL type name (or
 * the consumer's own name): the contract is type-agnostic — the package
 * does not validate the set; the consumer maps type → DDL and type →
 * cell editor. `operators` is the consumer's operator catalog override;
 * when absent, the package's default catalog for the type stands (the
 * filter builders), and the query must apply exactly the declared
 * operators. The `decimals` / `thousands` / `prefix` / `suffix` /
 * `allowNegative` fields are the number column's display attributes (the
 * column's own data — the package's number formatter reads them). The
 * reference fields declare a RELATION over the plain column:
 * `refKind "enum"` — the cell value is the option row id of the dict
 * table (`refTableId`); `refKind "row"` — the cell value is the linked
 * table's row id (`refDisplayColumn` declares which column of the linked
 * table stands the display; the default is the first text column / the
 * pk). `refMany` is the many cardinality (the cell value is an ARRAY of
 * the option row ids / the row ids; the consumer maps the array to a
 * junction table behind the row's write).
 */
interface BridgeColumn {
  id: string;
  name: string;
  type: string;
  operators?: string[];
  /** The reference table (the dict table for the enum options / the
   *  linked table for the row links). */
  refTableId?: string;
  /** The reference kind: "enum" (the dict table's rows are the options)
   *  or "row" (the cell holds the linked row's row id). */
  refKind?: "enum" | "row";
  /** The many cardinality (the cell value is an array). */
  refMany?: boolean;
  /** The display column of the linked table (the row-link display; the
   *  default is the first text column / the pk). */
  refDisplayColumn?: string;
  /** The number's digit count after the point (default 0 = integer). */
  decimals?: number;
  /** The thousands' separator (the space grouping: `1 000 000`). */
  thousands?: boolean;
  /** The display's prefix stand (e.g. the currency sign). */
  prefix?: string;
  /** The display's suffix stand. */
  suffix?: string;
  /** Whether negative values are allowed (the edit rejects them otherwise). */
  allowNegative?: boolean;
}

/**
 * The table description (the grid's view over the wire's
 * `TableDescription`): the table's name + the grid's columns.
 */
interface BridgeTableDescription {
  name: string;
  columns: BridgeColumn[];
}

/** The cell value input kind the annotation derives from the column type. */
type BridgeValueInput = "text" | "number" | "boolean" | "date" | "datetime" | "enum" | "row-link" | "none";

/** The column annotation the filter builder renders from. */
interface BridgeColumnAnnotation {
  /** The operator catalog (the consumer's `operators` override or the package default for the type). */
  operators: string[];
  /** The value input kind (none = no value is taken: empty / not-empty). */
  valueInput: BridgeValueInput;
  /** Whether the operators take no value (empty / not-empty). */
  valueless: Set<string>;
}

/**
 * The parse result of a typed cell / filter value: the committed value
 * (`null` for the empty string) or the validation error (the input is not
 * committed — the editor keeps / reverts to the last valid value).
 */
type CellValueParse = { ok: true; value: unknown } | { ok: false; error: string };

export type { BridgeColumn, BridgeColumnAnnotation, BridgeTableDescription, BridgeValueInput, CellValueParse };
