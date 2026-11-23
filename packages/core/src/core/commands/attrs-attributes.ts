/**
 * The document-attribute write commands: setAttribute, removeAttribute,
 * renameAttribute, reorderAttributes. A command validates the key and the
 * value first (the typed InvalidAttributeError, no silent no-ops) and then
 * mutates the meta's attributes record + display order in one transaction
 * with the local origin.
 */
import * as Y from "yjs";

import { RESERVED_DOC_ATTRIBUTE_KEYS, isDocAttributeValue, isReservedId } from "@docblocks-core/schema";
import type { DocAttributeValue } from "@docblocks-core/schema";

import { InvalidAttributeError } from "../errors";
import { localTransact, writeAttrValue } from "../layout";
import { readPlainValue } from "../read";

/**
 * The document-attribute key: a non-empty string that is not
 * reserved (a doc meta field or an Object.prototype key — such a key would
 * be silently lost on the JSON round-trip). Throws the typed
 * `InvalidAttributeError`.
 */
function assertAttributeKey(key: string): void {
  if (typeof key !== "string" || key === "") {
    throw new InvalidAttributeError(`The attribute key must be a non-empty string.`);
  }
  if (RESERVED_DOC_ATTRIBUTE_KEYS.has(key)) {
    throw new InvalidAttributeError(
      `The attribute key "${key}" is reserved (a document meta field) and cannot be used.`
    );
  }
  if (isReservedId(key)) {
    throw new InvalidAttributeError(
      `The attribute key "${key}" is reserved (it collides with Object.prototype) and cannot be used.`
    );
  }
}

/**
 * The document-attribute value: `string | number | boolean | string[] |
 * MentionRef (the id-only reference; the legacy `{ id, label }` snapshot
 * is tolerated) | TypedAttributeValue` (the `{ type, value }` over the
 * `ATTRIBUTE_TYPES` enum — the declared value type is the data). Throws
 * the typed `InvalidAttributeError`.
 */
function assertAttributeValue(key: string, value: unknown): asserts value is DocAttributeValue {
  if (!isDocAttributeValue(value)) {
    throw new InvalidAttributeError(
      `The attribute value for "${key}" must be a string, a number, a boolean, an array of strings, a mention reference, or a typed value.`
    );
  }
}

/** The live attributes record (absent = the field stands off). */
function attributesRecordOf(ydoc: Y.Doc): Y.Map<unknown> | undefined {
  const record = ydoc.getMap("meta").get("attributes");
  return record instanceof Y.Map ? record : undefined;
}

/** The stored attributes' display order (the `meta.attributesOrder` Y.Array's
 *  strings); null when the field stands off (the reader's fallback is the
 *  record's key order). */
function attributeOrderOf(ydoc: Y.Doc): string[] | null {
  const order = ydoc.getMap("meta").get("attributesOrder");
  if (!(order instanceof Y.Array)) return null;
  const keys = order.toArray().filter((key): key is string => typeof key === "string");
  return keys.length > 0 ? keys : null;
}

/**
 * Write the attributes' display order (the whole-array LWW — the
 * whole-record LWW's parity over the record): an empty / null stand
 * deletes the field (the writer's parity: an absent field is never
 * written as an empty array). Runs inside the caller's transaction.
 */
function writeAttributeOrder(ydoc: Y.Doc, order: string[] | null): void {
  const meta = ydoc.getMap("meta");
  if (order === null || order.length === 0) {
    meta.delete("attributesOrder");
    return;
  }
  const array = new Y.Array<string>();
  array.push(order);
  meta.set("attributesOrder", array);
}

/**
 * The record's keys over the stored order (the order's stand over the
 * record's keys — the stale entries are dropped, the missing keys append
 * in the record's key order): the writer's order rebuild after a
 * concurrent record change.
 */
function attributeOrderAgainstRecord(ydoc: Y.Doc, record: Y.Map<unknown>): string[] {
  const recordKeys = [...record.keys()];
  const stored = attributeOrderOf(ydoc);
  if (stored === null) return recordKeys;
  const seen = new Set<string>();
  const order: string[] = [];
  for (const key of stored) {
    if (record.has(key) && !seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
  }
  for (const key of recordKeys) {
    if (!seen.has(key)) order.push(key);
  }
  return order;
}

/** The live attributes record, created lazily (the first write's stand). */
function ensureAttributesRecord(ydoc: Y.Doc): Y.Map<unknown> {
  const record = attributesRecordOf(ydoc);
  if (record !== undefined) return record;
  const fresh = new Y.Map<unknown>();
  ydoc.getMap("meta").set("attributes", fresh);
  return fresh;
}

/** The plain-shape structural equality (the read path's stand): the stored
 *  value over its plain snapshot, the input's plain shape (the JSON-like
 *  forms: the scalars, the string arrays, the object forms). */
function plainValueEquals(stored: unknown, value: unknown): boolean {
  if (Array.isArray(stored) || Array.isArray(value)) {
    if (!Array.isArray(stored) || !Array.isArray(value)) return false;
    if (stored.length !== value.length) return false;
    return stored.every((item, index) => plainValueEquals(item, value[index]!));
  }
  if (stored === null || value === null || typeof stored !== "object" || typeof value !== "object") {
    return stored === value;
  }
  const storedEntries = Object.entries(stored);
  const valueEntries = Object.entries(value);
  if (storedEntries.length !== valueEntries.length) return false;
  return valueEntries.every(
    ([key, input]) => Object.hasOwn(stored, key) && plainValueEquals((stored as Record<string, unknown>)[key], input)
  );
}

/** Whether the stored raw value (a scalar, a Y.Array / a plain array, a nested Y.Map) equals the given typed value. */
function attributeValueEquals(stored: unknown, value: DocAttributeValue): boolean {
  // The read path's stand: the stored raw value over its plain snapshot, the
  // structural equality over the plain shapes — the reference's stand over
  // the object forms would stand a real transaction over the same value
  // (the no-op's stand's breach over the mention / the typed forms).
  return plainValueEquals(readPlainValue(stored), value);
}

/**
 * Sets one document attribute (one transaction — one undo step, one wire
 * update; the attributes record is created lazily on the first write). A
 * set of the current value is the no-op stand (no write, no undo step, no
 * wire update). A reserved key or an unsupported value throws the typed
 * `InvalidAttributeError`.
 */
function setAttribute(ydoc: Y.Doc, key: string, value: DocAttributeValue): void {
  assertAttributeKey(key);
  assertAttributeValue(key, value);
  const record = attributesRecordOf(ydoc);
  const isNewKey = record === undefined || !record.has(key);
  const current = record?.get(key);
  if (attributeValueEquals(current, value)) return; // no-op
  localTransact(ydoc, () => {
    writeAttrValue(ensureAttributesRecord(ydoc), key, value);
    // The new key appends to the display order (the last-added's stand):
    // the order's rebuild over the record keeps the stand valid over a
    // concurrent record change (the stale entries' drop, the missing'
    // append).
    if (isNewKey) {
      const ordered = attributeOrderAgainstRecord(ydoc, ensureAttributesRecord(ydoc));
      if (!ordered.includes(key)) ordered.push(key);
      writeAttributeOrder(ydoc, ordered);
    }
  });
}

/**
 * Removes a document attribute (one transaction — one undo step, one wire
 * update). An absent key is the no-op stand (no write, no undo step, no
 * wire update). A reserved key throws the typed `InvalidAttributeError`.
 */
function removeAttribute(ydoc: Y.Doc, key: string): void {
  assertAttributeKey(key);
  const record = attributesRecordOf(ydoc);
  if (record === undefined || !record.has(key)) return; // no-op
  localTransact(ydoc, () => {
    record.delete(key);
    // The key's removal over the display order (the empty order's field
    // stands deleted — the writer's parity).
    const stored = attributeOrderOf(ydoc);
    if (stored !== null)
      writeAttributeOrder(
        ydoc,
        stored.filter((k) => k !== key)
      );
  });
}

/**
 * Renames a document attribute (one transaction — one undo step, one wire
 * update): the value's form (the plain / the typed wrapper) moves as-is
 * under the new key. The display order keeps the key's position (the
 * entry's replacement — the record's tail stand dropped). An absent
 * source key and a rename of the same key are the no-op stands (no
 * write, no undo step, no wire update — the `removeAttribute`'s parity).
 * The target key runs the full key validation (the reserved's / the
 * prototype's rejection over the typed `InvalidAttributeError`); a rename
 * onto an existing key throws the typed `InvalidAttributeError` (the
 * record is key-addressed — the rename would clobber the target's value).
 */
function renameAttribute(ydoc: Y.Doc, fromKey: string, toKey: string): void {
  const record = attributesRecordOf(ydoc);
  if (record === undefined || !record.has(fromKey)) return; // no-op
  if (fromKey === toKey) return; // no-op
  assertAttributeKey(toKey);
  if (record.has(toKey)) {
    throw new InvalidAttributeError(`The attribute key "${toKey}" already exists.`);
  }
  localTransact(ydoc, () => {
    // The value's form moves as-is over the read → write path (the Yjs's
    // type move is not a supported stand — the nested type's re-parenting
    // breaks its integration; the plain round-trip keeps the form).
    const value = readPlainValue(record.get(fromKey));
    record.delete(fromKey);
    writeAttrValue(record, toKey, value);
    // The order's entry's replacement (the position's keep): the stored
    // order's stand only — over the field's absence the read's key order
    // is the display's stand and the rename changes nothing over it.
    const stored = attributeOrderOf(ydoc);
    if (stored !== null) {
      writeAttributeOrder(
        ydoc,
        stored.map((k) => (k === fromKey ? toKey : k))
      );
    }
  });
}

/**
 * Reorders the document's attributes (the custom attribute's drag-reorder's
 * persistence): the `order` must stand a permutation of the record's keys
 * (the strict permutation's validation — the missing / the extra / the
 * duplicated key throws the typed `InvalidAttributeError`). One
 * transaction — one undo step, one wire update. An order equal to the
 * current stand is the no-op (the stored order, or the record's key order
 * over the field's absence).
 */
function reorderAttributes(ydoc: Y.Doc, order: string[]): void {
  if (!Array.isArray(order) || !order.every((key) => typeof key === "string")) {
    throw new InvalidAttributeError("The attributes order must be an array of strings.");
  }
  const record = attributesRecordOf(ydoc);
  if (record === undefined || record.size === 0) {
    throw new InvalidAttributeError("The document has no attributes to reorder.");
  }
  const recordKeys = [...record.keys()];
  if (order.length !== recordKeys.length) {
    throw new InvalidAttributeError(
      `The attributes order must hold exactly ${recordKeys.length} key(s) (one per attribute); found ${order.length}.`
    );
  }
  const seen = new Set<string>();
  for (const key of order) {
    if (seen.has(key)) {
      throw new InvalidAttributeError(`The attributes order entry "${key}" is duplicated.`);
    }
    seen.add(key);
    if (!recordKeys.includes(key)) {
      throw new InvalidAttributeError(`The attributes order entry "${key}" is not an attribute key.`);
    }
  }
  const current = attributeOrderOf(ydoc) ?? recordKeys;
  if (current.every((key, index) => key === order[index])) return; // no-op
  localTransact(ydoc, () => {
    writeAttributeOrder(ydoc, order);
  });
}

export { assertAttributeKey, assertAttributeValue, removeAttribute, renameAttribute, reorderAttributes, setAttribute };
