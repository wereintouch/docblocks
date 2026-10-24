/** A single schema violation with its location in the document. */
interface ValidationError {
  /**
   * JSON path of the location: `""` (the document), `"v"`,
   * `"blocks.b01.attrs.level"`, `"blocks.b01.content[2].marks.link.href"`.
   */
  path: string;
  /** Description of the violation. */
  message: string;
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const WEB_URL = /^https?:\/\//i;
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:/i;

const DOC_FIELDS = ["v", "id", "title", "createdAt", "blocks"] as const;
/** The optional top-level document fields (known but not required). */
const DOC_OPTIONAL_FIELDS = ["avatar"] as const;
/** Every known top-level document field (the required plus the optional). */
const KNOWN_DOC_FIELDS: readonly string[] = [...DOC_FIELDS, ...DOC_OPTIONAL_FIELDS];

/** The known geometry fields (the strict shape rejects the rest). */
const GEOMETRY_FIELDS = ["x", "y", "w", "h"] as const;

/** The recursion depth cap for the filter payload (the package's UI
 *  builds no deeper; a backend may allow more, it validates on its own). */
const MAX_DATABASE_FILTER_DEPTH = 8;

export {
  DOC_FIELDS,
  DOC_OPTIONAL_FIELDS,
  GEOMETRY_FIELDS,
  HEX_COLOR,
  ISO_8601,
  KNOWN_DOC_FIELDS,
  MAX_DATABASE_FILTER_DEPTH,
  SCHEME_PREFIX,
  WEB_URL,
};
export type { ValidationError };
