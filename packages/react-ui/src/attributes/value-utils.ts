// The panel's value logic (the pure reads — no JSX, no context): the
// mention reference's / the typed value's read, the preset key's read, the
// custom keys' display order over the stored `attributesOrder`, the value
// zone's display stand, the locale's dates, and the add flow's initial
// form.
import type { AttributeType, DocAttributeValue, MentionRef, TypedAttributeValue } from "docblocks-core";

import { PRESET_KEYS } from "./presets";

/** The mention reference's read (the id-only stand; the legacy label's
 *  snapshot stands tolerated). */
const mentionRefOf = (value: DocAttributeValue | undefined): MentionRef | null => {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && record.id !== "" ? (value as MentionRef) : null;
};

/** The typed attribute value's read (the custom attribute's storage form:
 *  the declared `type` + the `value` over its form). */
const typedValueOf = (value: DocAttributeValue | undefined): TypedAttributeValue | null => {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || typeof record.type !== "string" || !("value" in record)) return null;
  return (value as TypedAttributeValue) ?? null;
};

/** The preset key's read (the panel's fixed rows' vocabulary — the
 *  preset-ness is the UI's knowledge, the record's keys stand the
 *  generic data contract). */
const isPresetKey = (key: string): boolean => (PRESET_KEYS as readonly string[]).includes(key);

/** The custom keys' display order over the stored `attributesOrder`:
 *  the stale entries stand dropped, the duplicates stand first-occurrence,
 *  and the record's keys missing from the order append in the record's
 *  key order. An absent order stands the record's key order (the
 *  reader's fallback — the last-added's stand over the new docs). */
function orderedCustomKeys(order: string[] | undefined, customKeys: string[]): string[] {
  if (order === undefined) return customKeys;
  const keySet = new Set(customKeys);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const key of order) {
    if (keySet.has(key) && !seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  }
  for (const key of customKeys) {
    if (!seen.has(key)) ordered.push(key);
  }
  return ordered;
}

/** The value zone's stand over a display-only value (the typed value
 *  stands its inner value's display; the mention reference stands its id). */
function displayTextOf(value: DocAttributeValue | undefined): string | null {
  if (value === undefined) return null;
  const typed = typedValueOf(value);
  if (typed !== null) return displayTextOf(typed.value);
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return String(value);
  const mention = mentionRefOf(value);
  if (mention !== null) return mention.id;
  return String(value);
}

/** The locale's date stand (the date only, no time): the panel's locale
 *  (the consumer's `<html lang>` / the controlled `locale`) over the
 *  `Intl.DateTimeFormat`'s medium date; a non-parseable stand keeps the
 *  raw ISO. */
function formatDate(iso: string | undefined, locale: string): string {
  if (iso === undefined) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
  } catch {
    return iso;
  }
}

/** The published date's display stand: a parseable ISO stands the locale's
 *  date (the data keeps the raw value — the edit's input stands the raw
 *  stand); a non-parseable stand stands the raw string. */
function displayPublishedDate(value: string | undefined, locale: string): string | null {
  if (value === undefined || value === "") return null;
  return formatDate(value, locale);
}

/** The add flow's initial form (the type's default value over the typed
 *  wrapper — the mention's name stands the target's id). */
function initialFormOf(key: string, type: AttributeType): TypedAttributeValue {
  switch (type) {
    case "mention":
      return { type: "mention", value: { id: key } };
    case "number":
      return { type: "number", value: 0 };
    case "boolean":
      return { type: "boolean", value: false };
    case "list":
      return { type: "list", value: [] };
    case "string":
      return { type: "string", value: "" };
  }
}

export {
  displayPublishedDate,
  displayTextOf,
  formatDate,
  initialFormOf,
  isPresetKey,
  mentionRefOf,
  orderedCustomKeys,
  typedValueOf,
};
