import type { BlockType } from "./block-union";
import { BLOCK_REGISTRY, MARK_REGISTRY } from "./registry";
import type { AttrSpec, BlockSpec } from "./registry";
import type { MarkName } from "./types";

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

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const show = (value: unknown): string => {
  if (value === undefined) return "missing";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular structures and BigInt are not JSON-stringifiable.
    return String(value);
  }
};

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const WEB_URL = /^https?:\/\//i;
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:/i;

const isIso8601 = (value: unknown): boolean =>
  typeof value === "string" && ISO_8601.test(value) && !Number.isNaN(Date.parse(value));

const isHexColor = (value: unknown): boolean => typeof value === "string" && HEX_COLOR.test(value);

/** `http://` / `https://` URLs and relative paths; other schemes are rejected. */
const isLinkHref = (value: string): boolean => value.length > 0 && (WEB_URL.test(value) || !SCHEME_PREFIX.test(value));

const DOC_FIELDS = ["v", "id", "title", "createdAt", "blocks"] as const;

function validateMeta(doc: Record<string, unknown>, errors: ValidationError[]): void {
  for (const field of DOC_FIELDS) {
    if (!(field in doc)) errors.push({ path: field, message: `Missing required field "${field}".` });
  }
  for (const field of Object.keys(doc)) {
    if (!(DOC_FIELDS as readonly string[]).includes(field)) {
      errors.push({ path: field, message: `Unknown field "${field}".` });
    }
  }

  if ("v" in doc && doc.v !== 1) {
    errors.push({ path: "v", message: `Unsupported schema version ${show(doc.v)} (expected 1).` });
  }
  if ("id" in doc && (typeof doc.id !== "string" || doc.id.length === 0)) {
    errors.push({ path: "id", message: `id must be a non-empty string (got ${show(doc.id)}).` });
  }
  if ("title" in doc && typeof doc.title !== "string") {
    errors.push({ path: "title", message: `title must be a string (got ${show(doc.title)}).` });
  }
  if ("createdAt" in doc && !isIso8601(doc.createdAt)) {
    errors.push({
      path: "createdAt",
      message: `createdAt must be an ISO 8601 date-time (got ${show(doc.createdAt)}).`,
    });
  }
}

function validateAttrValue(
  name: string,
  spec: AttrSpec,
  value: unknown,
  path: string,
  errors: ValidationError[]
): void {
  switch (spec.kind) {
    case "boolean":
      if (typeof value !== "boolean") {
        errors.push({ path, message: `Attribute "${name}" must be a boolean (got ${show(value)}).` });
      }
      break;
    case "string":
      if (typeof value !== "string") {
        errors.push({ path, message: `Attribute "${name}" must be a string (got ${show(value)}).` });
      } else if (spec.nonEmpty && value.length === 0) {
        errors.push({ path, message: `Attribute "${name}" must be a non-empty string.` });
      } else if (spec.hexColor && !isHexColor(value)) {
        errors.push({ path, message: `Attribute "${name}" must be a hex color #RRGGBB(AA) (got ${show(value)}).` });
      }
      break;
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) {
        errors.push({ path, message: `Attribute "${name}" must be a number (got ${show(value)}).` });
      } else {
        validateNumber(name, spec, value, path, errors);
      }
      break;
    case "nullable-number":
      if (value === null) break;
      if (typeof value !== "number" || Number.isNaN(value)) {
        errors.push({ path, message: `Attribute "${name}" must be a number or null (got ${show(value)}).` });
      } else {
        validateNumber(name, spec, value, path, errors);
      }
      break;
    case "enum":
      if (!(spec.values ?? ([] as readonly unknown[])).includes(value)) {
        errors.push({
          path,
          message: `Attribute "${name}" must be one of ${JSON.stringify(spec.values)} (got ${show(value)}).`,
        });
      }
      break;
    case "object":
      if (!isPlainObject(value)) {
        errors.push({ path, message: `Attribute "${name}" must be a plain object (got ${show(value)}).` });
        return;
      }
      validateObjectFields(name, spec, value, path, errors);
      break;
    case "array": {
      if (!Array.isArray(value)) {
        errors.push({ path, message: `Attribute "${name}" must be an array (got ${show(value)}).` });
        return;
      }
      const itemSpec = spec.items;
      if (itemSpec === undefined) break;
      value.forEach((item, index) => {
        validateAttrValue(name, itemSpec, item, `${path}[${index}]`, errors);
      });
      break;
    }
  }
}

/**
 * The fields of an `object` attr: required fields present, no unknown
 * fields, each field value validated by its own spec (the standard
 * messages apply per field).
 */
function validateObjectFields(
  name: string,
  spec: AttrSpec,
  value: Record<string, unknown>,
  path: string,
  errors: ValidationError[]
): void {
  const fields = spec.fields ?? {};
  for (const [fieldName, fieldSpec] of Object.entries(fields)) {
    if (fieldSpec.required && !(fieldName in value)) {
      errors.push({
        path: `${path}.${fieldName}`,
        message: `Field "${fieldName}" of attribute "${name}" is required.`,
      });
    }
  }
  for (const [fieldName, fieldValue] of Object.entries(value)) {
    const fieldSpec = fields[fieldName];
    if (fieldSpec === undefined) {
      errors.push({
        path: `${path}.${fieldName}`,
        message: `Unknown field "${fieldName}" for attribute "${name}".`,
      });
      continue;
    }
    validateAttrValue(fieldName, fieldSpec, fieldValue, `${path}.${fieldName}`, errors);
  }
}

function validateNumber(name: string, spec: AttrSpec, value: number, path: string, errors: ValidationError[]): void {
  if (spec.integer && !Number.isInteger(value)) {
    errors.push({ path, message: `Attribute "${name}" must be an integer (got ${value}).` });
    return;
  }
  if (spec.min !== undefined && value < spec.min) {
    errors.push({ path, message: `Attribute "${name}" must be >= ${spec.min} (got ${value}).` });
  }
  if (spec.max !== undefined && value > spec.max) {
    errors.push({ path, message: `Attribute "${name}" must be <= ${spec.max} (got ${value}).` });
  }
  if (spec.positive && value <= 0) {
    errors.push({ path, message: `Attribute "${name}" must be positive (got ${value}).` });
  }
}

/** The known geometry fields (the strict shape rejects the rest). */
const GEOMETRY_FIELDS = ["x", "y", "w", "h", "rotation"] as const;

/**
 * The strict shape of the optional `geometry` field of ANY block: a plain
 * object with finite x/y (and rotation when present) and w/h > 0, where
 * x/y/w/h are required and unknown fields are rejected. Runs from
 * validateDoc for every block that carries a geometry field.
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
  if ("rotation" in geometry) {
    const value = geometry.rotation;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push({
        path: `${path}.rotation`,
        message: `geometry.rotation must be a finite number (got ${show(value)}).`,
      });
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
 * cannot express — the spec passes any array), and the connector's
 * start/end weak refs each carry at least one of docId / blockId (the
 * object spec cannot express "at least one of two"). The enums and the
 * numeric bounds are checked by the registry attrs spec. Runs from
 * validateDoc, and from the insertBlock / updateBlock command checks.
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
      if (!("docId" in ref) && !("blockId" in ref)) {
        errors.push({
          path: `${path}.attrs.${key}`,
          message: `Connector ref "${key}" must carry at least one of docId / blockId.`,
        });
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
  const columns: Array<{ id: string; type: string; options?: string[] }> = [];
  if (attrs !== undefined && Array.isArray(attrs.columns)) {
    for (const column of attrs.columns) {
      if (!isPlainObject(column)) continue; // the column shape is reported by the attrs spec
      const id = typeof column.id === "string" ? column.id : "";
      if (id.length === 0) continue;
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

  const rows = isPlainObject(block.rows) ? block.rows : undefined;
  if (rows === undefined) {
    errors.push({
      path: `${path}.rows`,
      message:
        block.rows === undefined
          ? `Missing required field "rows".`
          : `rows must be a plain object (got ${show(block.rows)}).`,
    });
  }
  for (const [rowId, cells] of Object.entries(rows ?? {})) {
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

  const rowOrder = block.rowOrder;
  if (rowOrder === undefined) {
    errors.push({ path: `${path}.rowOrder`, message: `Missing required field "rowOrder".` });
    return;
  }
  if (!Array.isArray(rowOrder)) {
    errors.push({ path: `${path}.rowOrder`, message: `rowOrder must be an array of row ids (got ${show(rowOrder)}).` });
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

/** The block's effective indent; absent (or a non-integer, reported by the attrs spec) is 0. */
function indentOf(block: Record<string, unknown>): number {
  const attrs = isPlainObject(block.attrs) ? block.attrs : undefined;
  const indent = attrs?.indent;
  return typeof indent === "number" && Number.isInteger(indent) ? indent : 0;
}

/**
 * The indent-jump rule of a flat page sequence: a block's indent may
 * exceed the preceding block's indent by at most 1 (the first block anchors
 * at 0 — there is no block to attach to). Runs per sequence container
 * (registry `sequence` flag: root, table-cell, frame); structural order
 * (table-row grid, surface z-order) ignores indent.
 */
function validateSequences(blocks: Record<string, unknown>, errors: ValidationError[]): void {
  for (const block of Object.values(blocks)) {
    if (!isPlainObject(block)) continue;
    const type = block.type;
    if (typeof type !== "string" || !(type in BLOCK_REGISTRY) || !BLOCK_REGISTRY[type as BlockType].sequence) continue;
    if (!Array.isArray(block.children)) continue; // a missing/non-array order is reported above
    let prev = -1; // virtual: before the first block
    block.children.forEach((childId, index) => {
      if (typeof childId !== "string" || !(childId in blocks)) return; // reported above
      const child = blocks[childId];
      if (!isPlainObject(child)) return;
      const indent = indentOf(child);
      if (index === 0 && indent > 0) {
        errors.push({
          path: `blocks.${childId}.attrs.indent`,
          message: `The first block of a page sequence must have indent 0 (got ${indent}).`,
        });
      } else if (indent > prev + 1) {
        errors.push({
          path: `blocks.${childId}.attrs.indent`,
          message: `Attribute "indent" must not exceed the preceding block's indent (${prev}) by more than 1 (got ${indent}).`,
        });
      }
      prev = indent;
    });
  }
}

function validateAttrs(
  type: BlockType,
  spec: BlockSpec,
  attrs: unknown,
  path: string,
  errors: ValidationError[]
): void {
  const attrSpecs = spec.attrs;

  if (attrSpecs === undefined) {
    if (attrs !== undefined) {
      errors.push({ path, message: `Block type "${type}" has no attributes.` });
    }
    return;
  }

  for (const [name] of Object.entries(attrSpecs).filter(([, spec]) => spec.required)) {
    if (attrs === undefined || !isPlainObject(attrs) || !(name in attrs)) {
      errors.push({ path: `${path}.${name}`, message: `Attribute "${name}" is required for block type "${type}".` });
    }
  }

  if (attrs === undefined) return;
  if (!isPlainObject(attrs)) {
    errors.push({ path, message: `attrs must be a plain object (got ${show(attrs)}).` });
    return;
  }

  for (const [name, value] of Object.entries(attrs)) {
    const attrSpec = attrSpecs[name];
    if (!attrSpec) {
      errors.push({ path: `${path}.${name}`, message: `Unknown attribute "${name}" for block type "${type}".` });
      continue;
    }
    validateAttrValue(name, attrSpec, value, `${path}.${name}`, errors);
  }
}

function validateMarks(blockType: BlockType, marks: unknown, path: string, errors: ValidationError[]): void {
  if (marks === undefined) {
    errors.push({ path, message: "run.marks is required (use {} when a run carries no marks)." });
    return;
  }
  if (!isPlainObject(marks)) {
    errors.push({ path, message: `marks must be a plain object (got ${show(marks)}).` });
    return;
  }

  const names = Object.keys(marks);
  if (blockType === "code" && names.length > 0) {
    errors.push({ path, message: "Runs in a code block must not carry marks." });
  }

  for (const name of names) {
    const spec = MARK_REGISTRY[name as MarkName];
    if (!spec) {
      errors.push({ path: `${path}.${name}`, message: `Unknown mark "${name}".` });
      continue;
    }
    const markPath = `${path}.${name}`;
    const value = marks[name];

    if (spec.kind === "toggle") {
      if (value !== true) {
        errors.push({ path: markPath, message: `Toggle mark "${name}" must be true (got ${show(value)}).` });
      }
      continue;
    }

    if (!isPlainObject(value)) {
      errors.push({ path: markPath, message: `Mark "${name}" must be an object with attribute "${spec.attr}".` });
      continue;
    }
    for (const key of Object.keys(value)) {
      if (key !== spec.attr) {
        errors.push({ path: `${markPath}.${key}`, message: `Unknown attribute "${key}" for mark "${name}".` });
      }
    }
    const attrValue = value[spec.attr ?? ""];
    if (spec.attr === "href") {
      if (typeof attrValue !== "string" || !isLinkHref(attrValue)) {
        errors.push({
          path: markPath,
          message: `Mark "link" requires an href: http/https URL or relative path (got ${show(attrValue)}).`,
        });
      }
    } else if (spec.attr === "tex") {
      if (typeof attrValue !== "string") {
        errors.push({ path: markPath, message: `Mark "math" requires a tex string (got ${show(attrValue)}).` });
      }
    } else if (spec.attr === "value") {
      if (attrValue === undefined) {
        if (!spec.attrOptional) {
          errors.push({ path: markPath, message: `Mark "${name}" requires a value: hex color #RRGGBB(AA).` });
        }
      } else if (!isHexColor(attrValue)) {
        errors.push({
          path: markPath,
          message: `Mark "${name}" value must be a hex color #RRGGBB(AA) (got ${show(attrValue)}).`,
        });
      }
    }
  }

  const exclusive = names.find((name) => MARK_REGISTRY[name as MarkName]?.exclusive);
  if (exclusive && names.length > 1) {
    errors.push({ path, message: `A run with exclusive mark "${exclusive}" must not carry other marks.` });
  }
}

function validateContent(blockType: BlockType, content: unknown, path: string, errors: ValidationError[]): void {
  if (!Array.isArray(content)) {
    errors.push({ path, message: `content must be an array of runs (got ${show(content)}).` });
    return;
  }
  content.forEach((run, index) => {
    const runPath = `${path}[${index}]`;
    if (!isPlainObject(run)) {
      errors.push({ path: runPath, message: `A run must be a plain object (got ${show(run)}).` });
      return;
    }
    if (typeof run.text !== "string") {
      errors.push({ path: `${runPath}.text`, message: `run.text must be a string (got ${show(run.text)}).` });
    }
    validateMarks(blockType, run.marks, `${runPath}.marks`, errors);
  });
}

/**
 * Validates a plain JSON document against schema v1.
 *
 * Strict posture: unknown block types, marks, attributes, and fields are
 * rejected — the validator protects data written by this engine. Lenient
 * fallback behavior is a reader/renderer concern.
 *
 * Collects all violations (does not stop at the first) and reports them in
 * document order. An empty result means the document is valid.
 */
function validateDoc(json: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!isPlainObject(json)) {
    return [{ path: "", message: `The document must be a plain object (got ${show(json)}).` }];
  }

  validateMeta(json, errors);
  if (!isPlainObject(json.blocks)) {
    if ("blocks" in json)
      errors.push({ path: "blocks", message: `blocks must be a plain object (got ${show(json.blocks)}).` });
    return errors;
  }
  const blocks = json.blocks;

  let rootId: string | undefined;
  const firstParent = new Map<string, { parentId: string; path: string }>();
  const referenceCount = new Map<string, number>();

  for (const [id, block] of Object.entries(blocks)) {
    if (!isPlainObject(block)) {
      errors.push({ path: `blocks.${id}`, message: `A block must be a plain object (got ${show(block)}).` });
      continue;
    }

    const type = block.type;
    if (typeof type !== "string" || !(type in BLOCK_REGISTRY)) {
      errors.push({ path: `blocks.${id}`, message: `Unknown block type ${show(type)}.` });
      continue;
    }
    const blockType = type as BlockType;
    const spec = BLOCK_REGISTRY[blockType];

    if (blockType === "root") {
      // An invalid or missing id is reported on the meta field already.
      if (typeof json.id === "string" && id !== json.id) {
        errors.push({
          path: `blocks.${id}`,
          message: `The root block must be keyed by the document id "${json.id}" (got "${id}").`,
        });
      }
      if (rootId !== undefined) {
        errors.push({
          path: `blocks.${id}`,
          message: `The document must contain exactly one root block (first is "${rootId}").`,
        });
      } else {
        rootId = id;
      }
      if (!Array.isArray(block.children)) {
        errors.push({ path: `blocks.${id}.children`, message: "The root block must have a children array." });
      }
    }

    if (!spec.content && "content" in block) {
      errors.push({ path: `blocks.${id}.content`, message: `Block type "${blockType}" has no content.` });
    } else if ("content" in block && spec.content) {
      validateContent(blockType, block.content, `blocks.${id}.content`, errors);
    }

    // Writer contract vs legacy form: structural containers keep `children`
    // (their order); the remodeled page types carry it only in the legacy
    // nesting form (still valid v1, the same child-type rules apply). Both
    // shapes are accepted; the strictness is about the rules, not the shape.
    const allowedChildTypes = spec.childrenTypes ?? spec.legacyChildrenTypes;
    if ("children" in block && allowedChildTypes === undefined) {
      errors.push({ path: `blocks.${id}.children`, message: `Block type "${blockType}" has no children.` });
    } else if ("children" in block && allowedChildTypes !== undefined) {
      if (!Array.isArray(block.children)) {
        errors.push({
          path: `blocks.${id}.children`,
          message: `children must be an array of block ids (got ${show(block.children)}).`,
        });
      } else {
        block.children.forEach((childId, index) => {
          const childPath = `blocks.${id}.children[${index}]`;
          if (typeof childId !== "string") {
            errors.push({ path: childPath, message: `A child id must be a string (got ${show(childId)}).` });
            return;
          }
          if (childId === id) {
            errors.push({ path: childPath, message: `Block "${id}" cannot be its own child.` });
          }
          if (!(childId in blocks)) {
            errors.push({ path: childPath, message: `Dangling child id "${childId}" (no such block).` });
            return;
          }
          const first = firstParent.get(childId);
          referenceCount.set(childId, (referenceCount.get(childId) ?? 0) + 1);
          if (first) {
            errors.push({
              path: childPath,
              message: `Block "${childId}" is referenced more than once (already a child of "${first.parentId}" at ${first.path}).`,
            });
          } else {
            firstParent.set(childId, { parentId: id, path: childPath });
          }
          const childBlock = blocks[childId];
          if (isPlainObject(childBlock) && typeof childBlock.type === "string" && childBlock.type in BLOCK_REGISTRY) {
            if (!allowedChildTypes.includes(childBlock.type as BlockType)) {
              errors.push({
                path: childPath,
                message: `Block type "${childBlock.type}" is not allowed as a child of "${blockType}".`,
              });
            }
          }
        });
      }
    }

    if (!spec.rows && "rows" in block) {
      errors.push({ path: `blocks.${id}.rows`, message: `Block type "${blockType}" has no rows.` });
    }
    if (!spec.rows && "rowOrder" in block) {
      errors.push({ path: `blocks.${id}.rowOrder`, message: `Block type "${blockType}" has no rowOrder.` });
    }
    if (spec.rows) validateDatabaseBlock(block, `blocks.${id}`, errors);

    if ("geometry" in block) validateGeometry(block.geometry, `blocks.${id}.geometry`, errors);
    if (blockType === "shape" || blockType === "connector") {
      validateCanvasBlock(blockType, block, `blocks.${id}`, errors);
    }

    validateAttrs(blockType, spec, block.attrs, `blocks.${id}.attrs`, errors);
  }

  if (rootId === undefined) {
    errors.push({ path: "blocks", message: "The document must contain a root block." });
    return errors;
  }

  // Every block except the root must be reachable from the root.
  const visited = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const block = blocks[id];
    if (!isPlainObject(block) || !Array.isArray(block.children)) continue;
    for (const childId of block.children) {
      if (typeof childId === "string" && childId in blocks && !visited.has(childId)) {
        visited.add(childId);
        queue.push(childId);
      }
    }
  }
  for (const id of Object.keys(blocks)) {
    if (id !== rootId && !visited.has(id)) {
      errors.push({ path: `blocks.${id}`, message: `Orphan block "${id}" (unreachable from root).` });
    }
  }

  // The flat page sequences: the indent-jump rule per sequence container.
  validateSequences(blocks, errors);

  // Every table row holds exactly the parent table's `cols` cells.
  for (const [id, block] of Object.entries(blocks)) {
    if (!isPlainObject(block) || block.type !== "table-row") continue;
    if (referenceCount.get(id) !== 1) continue; // missing/multiple parents are reported above
    const reference = firstParent.get(id);
    if (!reference) continue;
    const parent = blocks[reference.parentId];
    if (!isPlainObject(parent) || parent.type !== "table") continue;
    const cols = (parent as { attrs?: { cols?: unknown } }).attrs?.cols;
    if (typeof cols !== "number" || !Number.isInteger(cols) || cols < 1) continue; // invalid cols is reported on the table
    const children = block.children;
    if (!Array.isArray(children) || children.length !== cols) {
      errors.push({
        path: `blocks.${id}.children`,
        message: `A table row must have exactly ${cols} cell(s); found ${Array.isArray(children) ? children.length : 0}.`,
      });
    }
  }

  // The tables' columnWidths invariants (one entry per column), once each.
  for (const [id, block] of Object.entries(blocks)) {
    if (!isPlainObject(block) || block.type !== "table") continue;
    const cols = (block as { attrs?: { cols?: unknown } }).attrs?.cols;
    if (typeof cols !== "number" || !Number.isInteger(cols) || cols < 1) continue; // invalid cols is reported on the table
    const widths = (block as { attrs?: { columnWidths?: unknown } }).attrs?.columnWidths;
    if (Array.isArray(widths) && widths.length !== cols) {
      errors.push({
        path: `blocks.${id}.attrs.columnWidths`,
        message: `The table's columnWidths must hold exactly ${cols} width(s); found ${widths.length}.`,
      });
    }
  }

  return errors;
}

/**
 * Validates block attrs against the registry rules of the type: unknown
 * keys, missing required attrs, and value rules. `undefined` is valid only
 * for types without attrs. An empty result means the attrs are valid.
 */
function validateBlockAttrs(type: BlockType, attrs: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  validateAttrs(type, BLOCK_REGISTRY[type], attrs, "attrs", errors);
  return errors;
}

/**
 * Validates a mark set for a run of the given block type: known marks with
 * well-formed values, no marks in a code block, no coexistence with an
 * exclusive mark. An empty result means the marks are valid.
 */
function validateMarkSet(blockType: BlockType, marks: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  validateMarks(blockType, marks, "marks", errors);
  return errors;
}

export {
  checkDatabaseCellValue,
  validateBlockAttrs,
  validateCanvasBlock,
  validateDatabaseBlock,
  validateDoc,
  validateMarkSet,
};
export type { ValidationError };
