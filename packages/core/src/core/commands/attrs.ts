/**
 * The attribute/title/avatar write commands: updateBlock, setTitle,
 * setAvatar, and the document-attribute commands (setAttribute /
 * removeAttribute). A command validates first (typed errors,
 * no silent no-ops) and then mutates in one transaction with the local
 * origin.
 */
import * as Y from "yjs";

import {
  BLOCK_REGISTRY,
  RESERVED_DOC_ATTRIBUTE_KEYS,
  isDocAttributeValue,
  isReservedId,
  isSafeEmbedSrc,
  setOwn,
  validateBlockAttrs,
  validateCanvasBlock,
} from "@docblocks-core/schema";
import type { BlockAttrsPatch, DocAttributeValue, ValidationError } from "@docblocks-core/schema";

import {
  InvalidAttributeError,
  InvalidAttrsError,
  InvalidOperationError,
  UnknownBlockError,
  formatValidationErrors,
} from "../errors";
import { localTransact, writeAttrValue } from "../layout";
import { readBlock, readPlainValue } from "../read";
import { assertValidDatabasePatch } from "./database";
import {
  blockTypeOf,
  childrenOf,
  findParent,
  getBlockMap,
  indentJumpViolation,
  indentOfBlock,
  isPageSequence,
} from "./structure";
import { columnOrderOf, writeColumnWidthsPatch } from "./table/common";

/** A plain array of numbers (the table's positional columnWidths). */
const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((element) => typeof element === "number");

/** Sets or overwrites the given attrs; other attrs stay, attrs are never removed. */
function updateBlock(ydoc: Y.Doc, id: string, patch: BlockAttrsPatch): void {
  const type = blockTypeOf(ydoc, id);
  if (type === null) throw new UnknownBlockError(`Unknown block "${id}".`);
  if (BLOCK_REGISTRY[type].attrs === undefined) throw new InvalidAttrsError(`Block type "${type}" has no attributes.`);

  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return; // no-op

  // Validate the post-patch attrs as a whole (current attrs + patch) so the
  // registry rules and messages are reused as-is. The lenient stand (the
  // writer's hybrid posture): unknown keys (a future minor's
  // data over the live sync) stand preserved and un-rejected; a known
  // attr's value rules — incl. its enum — stand strict either way, so the
  // post-patch doc keeps the writer's invariants over the keys we own.
  const snapshot = readBlock(ydoc, id);
  const current = snapshot !== null && "attrs" in snapshot ? snapshot.attrs : undefined;
  const merged: Record<string, unknown> = {};
  // The open keys come from the snapshot / the caller's patch: the
  // reserved-key stand (the own data key, no prototype reassignment).
  for (const [key, value] of Object.entries(current ?? {})) setOwn(merged, key, value);
  for (const [key, value] of entries) setOwn(merged, key, value);
  // The writer's hybrid stand: the lenient posture over the
  // post-patch attrs (the live document's unknown keys / the future minor's
  // enum values stand preserved — the block stays editable over the live
  // sync), with the caller's patch keys strict (the caller owns the patch —
  // its unknown key or invalid value is a rejection).
  const errors = validateBlockAttrs(type, merged, true, new Set(entries.map(([key]) => key)));
  if (errors.length > 0) {
    throw new InvalidAttrsError(`Invalid attrs for block "${id}": ${formatValidationErrors(errors)}`);
  }

  // The embed's kind x src cross-field rule over the post-patch attrs (the
  // unsafe scheme stands the XSS over the consumer's sandbox grant / the
  // phishing surface).
  if (type === "embed" && typeof merged.src === "string") {
    const kind = typeof merged.kind === "string" ? merged.kind : "iframe";
    if (!isSafeEmbedSrc(kind, merged.src)) {
      throw new InvalidAttrsError(
        `Invalid attrs for block "${id}": the src is not a safe URL for kind "${kind}" (absolute http/https only; the html kind stands the data:text/html snippet additionally).`
      );
    }
  }

  // The table's positional columnWidths must mirror the column set (one
  // width per column — the strict validator's rule at load; the command
  // keeps the live document valid too). The ids stand for the identity-keyed
  // write below.
  let tableColumnIds: string[] | null = null;
  if (type === "table" && patch.columnWidths !== undefined) {
    const table = getBlockMap(ydoc, id);
    if (table === null) throw new UnknownBlockError(`Unknown block "${id}".`);
    const columnIds = columnOrderOf(table, id)
      .toArray()
      .filter((value): value is string => typeof value === "string");
    if (patch.columnWidths.length !== columnIds.length) {
      throw new InvalidAttrsError(
        `Invalid attrs for block "${id}": the table's columnWidths must hold exactly ${columnIds.length} width(s); found ${patch.columnWidths.length}.`
      );
    }
    tableColumnIds = columnIds;
  }

  // A database's post-patch columns must keep the strict invariants against
  // the existing rows (like a table's cols against its row cell counts);
  // a post-patch `tableId` (the external form) must keep them too — the
  // inline form's columns cannot stand next to the reference.
  if (type === "database" && (patch.columns !== undefined || patch.tableId !== undefined)) {
    assertValidDatabasePatch(snapshot, merged, id);
  }

  // A canvas type's post-patch attrs must keep the block-level invariants
  // (the points tuples, the connector refs) — like the database's patch
  // check against its existing rows.
  if (type === "shape" || type === "connector") {
    const canvasErrors: ValidationError[] = [];
    validateCanvasBlock(type, { type, attrs: merged }, `blocks.${id}`, canvasErrors);
    if (canvasErrors.length > 0) {
      throw new InvalidAttrsError(`Invalid attrs for block "${id}": ${formatValidationErrors(canvasErrors)}`);
    }
  }

  // The flat page model: a post-patch indent must keep the
  // sequence's jump rule (the validator enforces it at load; the commands
  // keep a live document valid too).
  if (merged.indent !== undefined) {
    const parent = findParent(ydoc, id);
    if (parent !== null && isPageSequence(ydoc, parent)) {
      const seq = childrenOf(ydoc, parent);
      const childIds = seq !== null ? seq.toArray() : [];
      const index = childIds.indexOf(id);
      const newIndent = merged.indent as number;
      const violation = indentJumpViolation(ydoc, childIds, index, newIndent);
      if (violation !== null) {
        throw new InvalidAttrsError(`Invalid attrs for block "${id}": ${violation}.`);
      }
      // The TO side: a lowered indent can dangle the next block (its
      // predecessor just got shallower). Rejected like the moveBlock /
      // insertBlock TO-side strandings — and like them the check stands
      // only for a command that commits its own transaction: the UI's
      // segment outdent composes the whole stretch in one transact, so a
      // mid-transact dangle is a transient the composition resolves (the
      // Yjs transaction's atomicity keeps it off the wire and off every
      // listener). The next block's pair is checked against the NEW
      // indent — the patch is not applied yet, so the doc still stands
      // the old one.
      const next = childIds[index + 1];
      const oldIndent = indentOfBlock(ydoc, id);
      if (next !== undefined && newIndent < oldIndent) {
        const nextIndent = indentOfBlock(ydoc, next);
        const inBatch = (ydoc as unknown as { _transaction?: unknown })._transaction !== null;
        if (!inBatch && nextIndent > newIndent + 1) {
          throw new InvalidOperationError(
            `Block "${id}" cannot be outdented to indent ${newIndent}: block "${next}" (indent ${nextIndent}) would be stranded. Outdent the whole derived segment in one transact.`
          );
        }
      }
    }
  }

  localTransact(ydoc, () => {
    const block = getBlockMap(ydoc, id);
    if (block === null) return;
    const existing = block.get("attrs");
    const attrsMap = existing instanceof Y.Map ? existing : new Y.Map<unknown>();
    if (!(existing instanceof Y.Map)) block.set("attrs", attrsMap);
    for (const [key, value] of entries) {
      // The table's positional columnWidths stand identity-keyed (columnId →
      // width): the generic attr writer would leave a positional Y.Array that
      // the read-time derivation (identity map + columnOrder) cannot see.
      if (key === "columnWidths" && tableColumnIds !== null && isNumberArray(value)) {
        writeColumnWidthsPatch(block, tableColumnIds, value);
        continue;
      }
      writeAttrValue(attrsMap, key, value);
    }
  });
}

/** Replaces the whole document title. */
function setTitle(ydoc: Y.Doc, text: string): void {
  localTransact(ydoc, () => {
    const meta = ydoc.getMap("meta");
    const title = meta.get("title");
    if (title instanceof Y.Text) {
      title.delete(0, title.length);
      title.insert(0, text);
    } else {
      meta.set("title", new Y.Text(text));
    }
  });
}

/**
 * Sets the document's avatar (a short string / a few emoji). `null` and the
 * empty string clear it (the field stands off). A set of the current value
 * is the no-op stand (no write, no undo step, no wire update).
 */
function setAvatar(ydoc: Y.Doc, avatar: string | null): void {
  const next = avatar === null ? "" : avatar;
  const meta = ydoc.getMap("meta");
  const current = meta.get("avatar");
  const currentValue = typeof current === "string" ? current : "";
  if (currentValue === next) return;
  localTransact(ydoc, () => {
    if (next === "") {
      meta.delete("avatar");
    } else {
      meta.set("avatar", next);
    }
  });
}

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
 * The document-attribute value: `string | number | boolean |
 * string[] | MentionRef` (the `author` snapshot's form). Throws the typed
 * `InvalidAttributeError`.
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

/** Whether the stored raw value (a scalar or a Y.Array) equals the given typed value. */
function attributeValueEquals(stored: unknown, value: DocAttributeValue): boolean {
  if (Array.isArray(value)) {
    if (!(stored instanceof Y.Array)) return false;
    const items = stored.toArray();
    if (items.length !== value.length) return false;
    return items.every((item, index) => item === value[index]);
  }
  return stored === value;
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

export {
  assertAttributeKey,
  assertAttributeValue,
  removeAttribute,
  renameAttribute,
  reorderAttributes,
  setAttribute,
  setAvatar,
  setTitle,
  updateBlock,
};
