/**
 * The wire's data model's types (the opaque ids, the table / column's
 * schema entries, the query's inputs — the filter / the sort / the page,
 * the ordered row's wire + the page / table's snapshots).
 */
/** An opaque stable identifier (the table / row / field / operation id). */
type Id = string;
/** The consumer's revision stand (the row / column / table's version). */
type Revision = string;
/** The ISO-8601 instant (the mutation's issue time). */
type IsoInstant = string;
/** A row's cells: the field id → the stored value. `null` clears a
 *  nullable cell; an absent key stands "do not change"; `undefined` is
 *  never a stored value (it is dropped before the JSON serialization). */
type CellMap = Record<Id, unknown>;

/** The table's catalog entry (the picker / the block's reference). */
interface TableRef {
  id: Id;
  name: string;
  revision: Revision;
  /** The hidden system table (the enum's options' catalog): absent from
   *  `listTables`, reachable by id. */
  system?: boolean;
}

/** The column's schema entry (the consumer's field registry row). */
interface Column {
  id: Id;
  name: string;
  type: string;
  /** The position in the schema order (the 0-based seat). */
  position: number;
  nullable: boolean;
  revision: Revision;
  /** The operator catalog override; the consumer's default catalog for
   *  the type stands when absent. */
  operators?: string[];
  /** The reference relation over the plain column: the cell holds the
   *  referenced row's stable id (an option row id for the enum, a linked
   *  row id for the row link); `many` = the cell holds the array. */
  reference?: {
    kind: "enum" | "row";
    tableId: Id;
    many: boolean;
    /** The display column of the linked table (the row-link's stand; the
     *  default is the first text column / the pk). */
    displayColumnId?: Id;
  };
  /** The number column's display attributes. */
  numberDisplay?: {
    decimals?: number;
    thousands?: boolean;
    prefix?: string;
    suffix?: string;
    allowNegative?: boolean;
  };
}

/** The table's schema + the table reference. */
interface TableDescription {
  table: TableRef;
  columns: Column[];
  schemaRevision: Revision;
}

/** A query operator descriptor (the value's kind the filter builder
 *  renders). */
interface QueryOperator {
  id: string;
  valueKind: "none" | "scalar" | "list";
}

/** The server's query semantics (the canonicalization stand the filter /
 *  sort values normalize to). */
interface QuerySemantics {
  semanticsVersion: string;
  collation: string;
  timezone: string;
  nullOrdering: "first" | "last";
  operatorsByColumnType: Record<string, QueryOperator[]>;
}

/** One filter condition (the column + the operator + the value; the value
 *  is absent only for the valueless operators). */
interface FilterConditionInput {
  columnId: Id;
  op: string;
  value?: unknown;
}

/** The recursive and/or filter input (the block's `filter` view state; the
 *  server canonicalizes and validates it against the declared operators —
 *  the unknown column / operator / type rejects). */
interface FilterInput {
  logic: "and" | "or";
  conditions: FilterConditionInput[];
  groups?: FilterInput[] | null;
}

/** The sort input: the ordered sort keys (the null ordering per key). */
type SortInput = { fieldId: Id; direction: "asc" | "desc"; nulls?: "first" | "last" }[];

/** The page query (the filter + the sort + the page size). */
interface PageQuery {
  filter?: FilterInput;
  sort?: SortInput;
  limit?: number;
}

/** A wire row: the stable id + the canonical physical order key (a finite
 *  IEEE-754 number — never a string, NaN or infinity; the canonical total
 *  order is `(orderKey, rowId)`) + the revision + the cells. The page's
 *  row order is the array's order. */
interface RowWire {
  id: Id;
  orderKey: number;
  revision: Revision;
  cells: Record<string, unknown>;
}

/** An ordered row page: the rows in the server's order + the opaque next
 *  cursor (null = the last page) + the snapshot's top event boundary +
 *  the schema revision + the query fingerprint (the server's signed
 *  canonical form — the client never constructs one). */
interface RowPage {
  rows: RowWire[];
  nextCursor: string | null;
  asOfSeq: number;
  schemaRevision: Revision;
  queryFingerprint: string;
}

/** The page + the query semantics. */
type PageSnapshot = RowPage & { semantics: QuerySemantics };

/** The initial load: the schema and the first page from one consistent
 *  snapshot (the `page.asOfSeq` is the R both represent). */
type TableSnapshot = TableDescription & { page: PageSnapshot };

export type {
  CellMap,
  Column,
  FilterConditionInput,
  FilterInput,
  Id,
  IsoInstant,
  PageQuery,
  PageSnapshot,
  QueryOperator,
  QuerySemantics,
  Revision,
  RowPage,
  RowWire,
  SortInput,
  TableDescription,
  TableRef,
  TableSnapshot,
};
