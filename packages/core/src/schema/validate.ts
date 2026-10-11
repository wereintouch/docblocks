import { BLOCK_REGISTRY, MARK_REGISTRY } from "./registry";
import type { AttrSpec, BlockSpec } from "./registry";
import type { BlockType, MarkName } from "./types";

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
  if (spec.positive && value <= 0) {
    errors.push({ path, message: `Attribute "${name}" must be positive (got ${value}).` });
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

    if (!spec.children && "children" in block) {
      errors.push({ path: `blocks.${id}.children`, message: `Block type "${blockType}" has no children.` });
    } else if ("children" in block && spec.children) {
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
            const allowed = spec.childrenTypes;
            if (allowed && !allowed.includes(childBlock.type as BlockType)) {
              errors.push({
                path: childPath,
                message: `Block type "${childBlock.type}" is not allowed as a child of "${blockType}".`,
              });
            }
          }
        });
      }
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

export { validateBlockAttrs, validateDoc, validateMarkSet };
export type { ValidationError };
