/**
 * The attrs / marks / content checks: the AttrSpec value validation
 * (per kind), the object-fields spec, the registry-driven attrs of a
 * block type, the mark set rules, and the runs content array.
 */
import type { BlockType } from "../../block-union";
import { MARK_REGISTRY } from "../../registry";
import type { AttrSpec, BlockSpec } from "../../registry";
import type { MarkName } from "../../types";
import type { ValidationError } from "../models";
import { isHexColor, isLinkHref, isPlainObject, show } from "./common";

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
 * messages apply per field). An `object` attr WITHOUT declared `fields`
 * is a free-form object: the plain-object check already stands (in the
 * `object` case), and the structure is the caller's concern (the database
 * `filter` payload is checked by its recursive branch — the recursion is
 * not expressible in the flat AttrSpec).
 */
function validateObjectFields(
  name: string,
  spec: AttrSpec,
  value: Record<string, unknown>,
  path: string,
  errors: ValidationError[]
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

export { validateAttrs, validateContent, validateMarks };
