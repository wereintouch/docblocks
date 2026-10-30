/** The registry's structural specs: the attr spec, the block spec, and the
 *  mark (field) specs. */
import type { BlockType } from "./block-union";

interface AttrSpec {
  kind: "boolean" | "string" | "number" | "nullable-number" | "enum" | "object" | "array";
  /** Allowed values for `enum`. */
  values?: readonly (string | number)[];
  /** `object`: the nested field specs, each validated as its own AttrSpec. */
  fields?: Record<string, AttrSpec>;
  /** `array`: the item spec, each array element validated against it. */
  items?: AttrSpec;
  /** Must be present in `attrs`. */
  required?: boolean;
  /** `number`: must be an integer. */
  integer?: boolean;
  /** `number`: inclusive lower bound. */
  min?: number;
  /** `number`: inclusive upper bound. */
  max?: number;
  /** `number`: must be > 0. */
  positive?: boolean;
  /** `string`: must be non-empty. */
  nonEmpty?: boolean;
  /** `string`: must be a hex color #RRGGBB(AA). */
  hexColor?: boolean;
  /** `string` / `enum`: `null` is a valid value (the "override cleared" idiom). */
  nullable?: boolean;
}

/** Structural description of a block type. */
interface BlockSpec {
  /** The block carries inline text content (runs). */
  content: boolean;
  /** The block carries child blocks in the WRITER contract (the field is read and written). */
  children: boolean;
  /** The block carries row data (the `rows` map + the `rowOrder` order). */
  rows: boolean;
  /** The block carries the column identities + order (`columnOrder` array, table only). */
  columnOrder?: boolean;
  /** Allowed child block types (present whenever `children` is true). */
  childrenTypes?: readonly BlockType[];
  /**
   * The LEGACY child types: the `children` field of these remodeled page
   * types stays VALID v1 data (the nesting form that predates the flat
   * page model), with this child-type rule; `flattenDoc` normalizes it to
   * `indent`, and the writer never emits it. Absent — `children` is
   * rejected on the type.
   */
  legacyChildrenTypes?: readonly BlockType[];
  /**
   * The children array is a FLAT PAGE SEQUENCE: `indent`
   * applies and the indent-jump rule is checked over it. Structural order
   * without this flag: `table-row` (grid positions), `surface` (z-order).
   */
  sequence?: boolean;
  /** Attribute schema; absent — the type has no attributes. */
  attrs?: Record<string, AttrSpec>;
}

/**
 * The callout's icon catalog: the fixed set of icon names a callout's
 * `icon` attr may stand (a kebab-case lucide name). The preset icon per
 * variant (info → info, warning → triangle-alert, danger → circle-x) and
 * any override name come from this set; the reader is lenient (an unknown
 * name renders the preset) and the strict validator rejects it.
 */

interface MarkFieldSpec {
  /** The field must be present. */
  required: boolean;
  /** The value must be a non-empty string. */
  nonEmptyString?: boolean;
  /** The value must be one of the given names (an enum). */
  enum?: readonly string[];
}

/** Structural description of a mark. */
interface MarkSpec {
  /** `toggle`: the mark value is `true`; `attrs`: the value is an object. */
  kind: "toggle" | "attrs";
  /** Exclusive marks never coexist with other marks on a run. */
  exclusive: boolean;
  /** Attribute name for `attrs` marks. */
  attr?: "href" | "value";
  /** Whether the attribute may be absent (highlight). */
  attrOptional?: boolean;
  /** The known fields for a multi-field `attrs` mark (e.g. `mention`). */
  fields?: Record<string, MarkFieldSpec>;
}

/** The v1 marks registry. */

export type { AttrSpec, BlockSpec, MarkFieldSpec, MarkSpec };
