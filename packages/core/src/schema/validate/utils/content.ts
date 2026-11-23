/**
 * The attrs / content checks: the AttrSpec value validation
 * (per kind), the object-fields spec, the registry-driven attrs of a
 * block type, and the runs content array.
 */
import type { BlockType } from "../../block-union";
import type { AttrSpec, BlockSpec } from "../../registry";
import type { ValidationError } from "../models";
import { isHexColor, isPlainObject, show } from "./common";
import { validateMarks } from "./content-marks";

function validateAttrValue(
  name: string,
  spec: AttrSpec,
  value: unknown,
  path: string,
  errors: ValidationError[],
  lenient = false
): void {
  switch (spec.kind) {
    case "boolean":
      if (typeof value !== "boolean") {
        errors.push({ path, message: `Attribute "${name}" must be a boolean (got ${show(value)}).` });
      }
      break;
    case "string":
      if (value === null) {
        if (!spec.nullable) {
          errors.push({ path, message: `Attribute "${name}" must be a string (got null).` });
        }
        break;
      }
      if (typeof value !== "string") {
        errors.push({ path, message: `Attribute "${name}" must be a string (got ${show(value)}).` });
      } else if (spec.nonEmpty && value.length === 0) {
        errors.push({ path, message: `Attribute "${name}" must be a non-empty string.` });
      } else if (spec.hexColor && !isHexColor(value)) {
        errors.push({ path, message: `Attribute "${name}" must be a hex color #RRGGBB(AA) (got ${show(value)}).` });
      }
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push({ path, message: `Attribute "${name}" must be a finite number (got ${show(value)}).` });
      } else {
        validateNumber(name, spec, value, path, errors);
      }
      break;
    case "nullable-number":
      if (value === null) break;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push({ path, message: `Attribute "${name}" must be a finite number or null (got ${show(value)}).` });
      } else {
        validateNumber(name, spec, value, path, errors);
      }
      break;
    case "enum":
      if (value === null) {
        if (!spec.nullable) {
          errors.push({
            path,
            message: `Attribute "${name}" must be one of ${JSON.stringify(spec.values)} (got null).`,
          });
        }
        break;
      }
      if (!(spec.values ?? ([] as readonly unknown[])).includes(value)) {
        // Lenient (cross-minor load): a new enum value (a future minor's
        // data) is preserved as-is, not rejected; the strict posture
        // rejects it (the writer's stand).
        if (!lenient) {
          errors.push({
            path,
            message: `Attribute "${name}" must be one of ${JSON.stringify(spec.values)} (got ${show(value)}).`,
          });
        }
      }
      break;
    case "object":
      if (!isPlainObject(value)) {
        errors.push({ path, message: `Attribute "${name}" must be a plain object (got ${show(value)}).` });
        return;
      }
      validateObjectFields(name, spec, value, path, errors, lenient);
      break;
    case "array": {
      if (!Array.isArray(value)) {
        errors.push({ path, message: `Attribute "${name}" must be an array (got ${show(value)}).` });
        return;
      }
      const itemSpec = spec.items;
      if (itemSpec === undefined) break;
      value.forEach((item, index) => {
        validateAttrValue(name, itemSpec, item, `${path}[${index}]`, errors, lenient);
      });
      break;
    }
  }
}

/**
 * The fields of an `object` attr: required fields present, no unknown
 * fields (the strict posture; the lenient cross-minor load preserves an
 * additive field as-is — it carries no spec to check), each field value
 * validated by its own spec (the standard messages apply per field). An
 * `object` attr WITHOUT declared `fields` is a free-form object: the
 * plain-object check already stands (in the `object` case), and the
 * structure is the caller's concern (the database `filter` payload is
 * checked by its recursive branch — the recursion is not expressible in
 * the flat AttrSpec).
 */
function validateObjectFields(
  name: string,
  spec: AttrSpec,
  value: Record<string, unknown>,
  path: string,
  errors: ValidationError[],
  lenient = false
): void {
  const fields = spec.fields;
  if (fields === undefined) return; // a free-form object (no declared fields)
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
      // Lenient (cross-minor load): an additive field (a future minor's
      // data) is preserved as-is, not rejected; the known fields keep
      // their value checks either way.
      if (!lenient) {
        errors.push({
          path: `${path}.${fieldName}`,
          message: `Unknown field "${fieldName}" for attribute "${name}".`,
        });
      }
      continue;
    }
    validateAttrValue(fieldName, fieldSpec, fieldValue, `${path}.${fieldName}`, errors, lenient);
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

function validateAttrs(
  type: BlockType,
  spec: BlockSpec,
  attrs: unknown,
  path: string,
  errors: ValidationError[],
  lenient = false,
  strictKeys?: ReadonlySet<string>
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
    // The hasOwn stand: an inherited Object.prototype member (the reserved
    // key or the `toString`-class name) stands no spec — the unknown-attr
    // branch decides it (a plain `attrSpecs[name]` would read the inherited
    // member and stand the reserved key "known").
    const attrSpec = Object.hasOwn(attrSpecs, name) ? attrSpecs[name] : undefined;
    // The writer's hybrid stand: the keys the caller's patch touches stand
    // the strict posture even under the lenient posture (the caller owns
    // the patch — its unknown key or invalid value is a rejection); the
    // untouched keys stand the lenient posture (the live document's data).
    const keyLenient = lenient && !strictKeys?.has(name);
    if (!attrSpec) {
      // Lenient (cross-minor load / the writer's untouched keys): an
      // unknown attr (a future minor's data) is preserved as-is, not
      // rejected; the known attrs keep their value checks either way.
      if (!keyLenient) {
        errors.push({ path: `${path}.${name}`, message: `Unknown attribute "${name}" for block type "${type}".` });
      }
      continue;
    }
    validateAttrValue(name, attrSpec, value, `${path}.${name}`, errors, keyLenient);
  }
}

function validateContent(
  blockType: BlockType,
  content: unknown,
  path: string,
  errors: ValidationError[],
  lenient = false
): void {
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
    validateMarks(blockType, run.marks, `${runPath}.marks`, errors, lenient);
  });
}

export { validateAttrs, validateContent };
export { validateMarks } from "./content-marks";
