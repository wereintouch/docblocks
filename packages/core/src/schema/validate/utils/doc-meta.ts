/**
 * The document meta's validation pass: the required / unknown fields, the
 * `v` / `id` / `title` / `avatar` / `createdAt` forms, the doc-attributes'
 * record, and the attributesOrder's permutation. Run from validateDoc.
 */
import { RESERVED_DOC_ATTRIBUTE_KEYS } from "../../constants";
import { isReservedId } from "../../id-safety";
import { DOC_FIELDS, KNOWN_DOC_FIELDS } from "../constants";
import type { ValidationError } from "../models";
import { isDocAttributeValue, isIso8601, isPlainObject, show } from "./common";

function validateMeta(doc: Record<string, unknown>, lenient: boolean, errors: ValidationError[]): void {
  for (const field of DOC_FIELDS) {
    if (!(field in doc)) errors.push({ path: field, message: `Missing required field "${field}".` });
  }
  for (const field of Object.keys(doc)) {
    if (!KNOWN_DOC_FIELDS.includes(field)) {
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
  if ("avatar" in doc && typeof doc.avatar !== "string") {
    errors.push({ path: "avatar", message: `avatar must be a string (got ${show(doc.avatar)}).` });
  }
  if ("createdAt" in doc && !isIso8601(doc.createdAt)) {
    errors.push({
      path: "createdAt",
      message: `createdAt must be an ISO 8601 date-time (got ${show(doc.createdAt)}).`,
    });
  }
  // The doc-attributes record (the only doc-level additive channel):
  // the strict posture checks the key / value forms; the lenient
  // (cross-minor) load preserves the unsupported values as-is (the
  // reader's contract).
  if ("attributes" in doc) validateDocAttributes(doc.attributes, lenient, errors);
  // The attributes' display order (the custom attribute's reorder's
  // persistence): the strict posture checks the permutation's form;
  // the lenient (cross-minor) load stands the array's shape only (the
  // reader's fallback over a broken stand).
  if ("attributesOrder" in doc) validateAttributeOrder(doc, lenient, errors);
}

/**
 * The `DocMeta.attributes` record: a plain object of `DocAttributeValue`
 * values (a plain `string | number | boolean | string[]`, the id-only
 * mention reference, or the typed value's `{ type, value }` wrapper).
 * Strict posture: the key form (non-empty, not a doc meta field, not an
 * Object.prototype key) and the value form stand the typed errors. Lenient
 * posture: the values stand preserved as-is (the cross-minor stand — the
 * reader's contract).
 */
function validateDocAttributes(attributes: unknown, lenient: boolean, errors: ValidationError[]): void {
  if (!isPlainObject(attributes)) {
    errors.push({ path: "attributes", message: `attributes must be a plain object (got ${show(attributes)}).` });
    return;
  }
  if (lenient) return;
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "") {
      errors.push({ path: "attributes", message: `An attribute key must not be empty.` });
      continue;
    }
    if (RESERVED_DOC_ATTRIBUTE_KEYS.has(key)) {
      errors.push({
        path: `attributes.${key}`,
        message: `The attribute key "${key}" is reserved (a document meta field) and cannot be used.`,
      });
      continue;
    }
    if (isReservedId(key)) {
      errors.push({
        path: `attributes.${key}`,
        message: `The attribute key "${key}" is reserved (it collides with Object.prototype) and cannot be used.`,
      });
      continue;
    }
    if (!isDocAttributeValue(value)) {
      errors.push({
        path: `attributes.${key}`,
        message: `The attribute value must be a string, a number, a boolean, an array of strings, a mention reference, or a typed value (got ${show(value)}).`,
      });
    }
  }
}

/**
 * The `DocMeta.attributesOrder` array: the `attributes` record's keys'
 * display order. Strict posture: an array of unique strings, every key
 * present in the record (the writer's permutation stand), and absent
 * over an empty / absent record. Lenient posture: the array's shape
 * only (the elements' stand over the reader's normalization).
 */
function validateAttributeOrder(doc: Record<string, unknown>, lenient: boolean, errors: ValidationError[]): void {
  const order = doc.attributesOrder;
  if (!Array.isArray(order)) {
    errors.push({
      path: "attributesOrder",
      message: `attributesOrder must be an array of strings (got ${show(order)}).`,
    });
    return;
  }
  const record = doc.attributes;
  const attributeKeys = record !== undefined && isPlainObject(record) ? (Object.keys(record) as string[]) : [];
  if (attributeKeys.length === 0 && order.length > 0) {
    errors.push({
      path: "attributesOrder",
      message: `attributesOrder must be absent over an empty attributes record.`,
    });
    return;
  }
  if (lenient) return;
  const seen = new Set<string>();
  for (const key of order) {
    if (typeof key !== "string") {
      errors.push({
        path: "attributesOrder",
        message: `An attributesOrder entry must be a string (got ${show(key)}).`,
      });
      continue;
    }
    if (seen.has(key)) {
      errors.push({ path: "attributesOrder", message: `The attributesOrder entry "${key}" is duplicated.` });
      continue;
    }
    seen.add(key);
    if (!attributeKeys.includes(key)) {
      errors.push({
        path: `attributesOrder.${key}`,
        message: `The attributesOrder entry "${key}" is not an attribute key.`,
      });
    }
  }
  for (const key of attributeKeys) {
    if (!seen.has(key)) {
      errors.push({
        path: `attributesOrder.${key}`,
        message: `The attributes key "${key}" is missing from the attributesOrder.`,
      });
    }
  }
}

export { validateAttributeOrder, validateDocAttributes, validateMeta };
