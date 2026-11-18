/**
 * The document-attributes panel's preset catalog: the preset keys are
 * UI/import knowledge (the schema stays generic — every key shares the
 * `DocMeta.attributes` data contract). The system rows are the meta's
 * derivatives (id / createdAt / updatedAt), never stored in the record.
 */

/** The preset document-attribute keys (the panel's fixed rows). */
const PRESET_KEYS = [
  "description",
  "tags",
  "createdBy",
  "cover",
  "coverMode",
  "coverTint",
  "status",
  "publishedAt",
] as const;

/** A preset key (the panel's fixed-row identity). */
type PresetKey = (typeof PRESET_KEYS)[number];

/** The system read-only rows' keys (the meta's derivatives; `hiddenAttributes`'s vocabulary). */
const SYSTEM_KEYS = ["id", "createdAt", "updatedAt"] as const;

/** The `hiddenAttributes`'s full vocabulary (the system + the preset + the custom keys). */
type AttributeRowKey = (typeof SYSTEM_KEYS)[number] | PresetKey;

export { PRESET_KEYS, SYSTEM_KEYS };
export type { AttributeRowKey, PresetKey };
