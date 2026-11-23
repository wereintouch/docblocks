/**
 * The mark set checks of a run: the per-mark shape over the mark registry
 * (toggle, the object-with-fields, the known single-attr marks), the
 * cross-minor leniency, and the exclusive-mark rule.
 */
import type { BlockType } from "../../block-union";
import { MARK_REGISTRY, isRegisteredMarkName } from "../../registry";
import type { MarkFieldSpec } from "../../registry";
import type { MarkName } from "../../text";
import type { ValidationError } from "../models";
import { isHexColor, isLinkHref, isPlainObject, show } from "./common";

/** The known fields of a multi-field `attrs` mark: each field's shape + no
 *  unknown keys. The lenient stand (the cross-minor load): a new field
 *  (a future minor's additive data) and a new enum value on a known field's
 *  enum are preserved as-is (the data stands); the known fields' contracts
 *  (presence, string shape, non-emptiness) stand either way — a future
 *  minor cannot change a known field's contract (that would be a major).
 */
function validateMarkFields(
  name: MarkName,
  fields: Record<string, MarkFieldSpec>,
  value: Record<string, unknown>,
  markPath: string,
  errors: ValidationError[],
  lenient = false
): void {
  for (const [key, field] of Object.entries(fields)) {
    const fieldValue = value[key];
    if (fieldValue === undefined) {
      if (field.required) {
        errors.push({ path: `${markPath}.${key}`, message: `Mark "${name}" requires a "${key}" attribute.` });
      }
      continue;
    }
    if (typeof fieldValue !== "string") {
      errors.push({
        path: `${markPath}.${key}`,
        message: `Mark "${name}" field "${key}" must be a string (got ${show(fieldValue)}).`,
      });
      continue;
    }
    if (field.enum !== undefined && !field.enum.includes(fieldValue)) {
      // Lenient (cross-minor load): a new enum value (a future minor's
      // data) is preserved as-is, not rejected; the strict posture
      // rejects it (the writer's stand).
      if (!lenient) {
        errors.push({
          path: `${markPath}.${key}`,
          message: `Mark "${name}" field "${key}" must be one of ${field.enum.join(" | ")} (got ${show(fieldValue)}).`,
        });
      }
    } else if (field.nonEmptyString && fieldValue.length === 0) {
      errors.push({ path: `${markPath}.${key}`, message: `Mark "${name}" field "${key}" must be a non-empty string.` });
    }
  }
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(fields, key)) {
      // Lenient (cross-minor load): an unknown field (a future minor's
      // additive data) is preserved as-is, not rejected; the strict
      // posture rejects it.
      if (!lenient) {
        errors.push({ path: `${markPath}.${key}`, message: `Unknown attribute "${key}" for mark "${name}".` });
      }
    }
  }
}

function validateMarks(
  blockType: BlockType,
  marks: unknown,
  path: string,
  errors: ValidationError[],
  lenient = false
): void {
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
    // A future minor's mark on a code block: the cross-minor stand — the
    // marks are not the engine's data to judge (only the known-mark shape
    // rules stand); the strict posture rejects any mark on a code run.
    if (!lenient || names.some((name) => isRegisteredMarkName(name))) {
      errors.push({ path, message: "Runs in a code block must not carry marks." });
    }
  }

  for (const name of names) {
    if (!isRegisteredMarkName(name)) {
      // Lenient (cross-minor load): an unknown mark (a future minor's data)
      // is preserved as-is (the text stands without it); the strict posture
      // rejects it.
      if (!lenient) {
        errors.push({ path: `${path}.${name}`, message: `Unknown mark "${name}".` });
      }
      continue;
    }
    const spec = MARK_REGISTRY[name];
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
    if (spec.fields !== undefined) {
      validateMarkFields(name as MarkName, spec.fields, value, markPath, errors, lenient);
      continue;
    }
    for (const key of Object.keys(value)) {
      if (key !== spec.attr) {
        // Lenient (cross-minor load): an unknown attribute (a future
        // minor's additive data) is preserved as-is, not rejected; the
        // strict posture rejects it.
        if (!lenient) {
          errors.push({ path: `${markPath}.${key}`, message: `Unknown attribute "${key}" for mark "${name}".` });
        }
      }
    }
    const attrValue = value[spec.attr ?? ""];
    if (spec.attr === "href") {
      if (typeof attrValue !== "string") {
        errors.push({
          path: markPath,
          message: `Mark "link" requires a string href (got ${show(attrValue)}).`,
        });
      } else if (!lenient && !isLinkHref(attrValue)) {
        // The writer's stand (the unsafe-scheme rejection). The lenient
        // (reader) posture preserves the value as data — the reader's
        // contract is to stand the data, not to judge the scheme (the
        // renderer's gate stands the href; a rejected snapshot here would
        // be a persistence DoS over a poisoned document).
        errors.push({
          path: markPath,
          message: `Mark "link" requires an href: http/https URL, mailto: email, tel: phone, or relative path (got ${show(attrValue)}).`,
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

  const exclusive = names.find((name) => isRegisteredMarkName(name) && MARK_REGISTRY[name].exclusive);
  if (exclusive && names.length > 1) {
    errors.push({ path, message: `A run with exclusive mark "${exclusive}" must not carry other marks.` });
  }
}

export { validateMarks };
