/** The in-memory bridge's pure helpers: the table-id derivation, the
 *  canonical form (the query fingerprint's input), and the physical-order
 *  comparison. */

/** The table id derived from the name (deterministic over the name — the
 * ASCII's slug, the non-ASCII's empty slug stands the name's hash). */
function tableIdFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug !== "") return `table-${slug}`;
  // The non-ASCII name's empty slug stands the djb2 hash's fallback (the
  // deterministic stand over the instances — the random's stand removed).
  let hash = 5381;
  for (let i = 0; i < name.length; i += 1) hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
  return `table-${(hash >>> 0).toString(36)}`;
}

/** The canonical form: objects with sorted keys, undefined values dropped,
 *  arrays in order (the fingerprint's input — a stable JSON key order). */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) continue;
      out[key] = canonicalize(entry);
    }
    return out;
  }
  return value;
}

/** The non-JSON's placeholder's replacer (function / symbol / BigInt stand
 * their string's form): the measurement's serializer must not stand its own
 * throw (the typed validation's rejection stands over the value itself). */
const NON_JSON_PLACEHOLDER = (_key: string, entry: unknown): unknown =>
  typeof entry === "bigint" || typeof entry === "function" || typeof entry === "symbol" ? String(entry) : entry;

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value), NON_JSON_PLACEHOLDER) ?? "";
}

/** The payload's size's measurement (the non-JSON's values stand their
 * string's placeholder over the throw — the measurement must not crash;
 * the bridge's validation stands the typed reject). */
function jsonSizeOf(value: unknown): number {
  return (JSON.stringify(value, NON_JSON_PLACEHOLDER) ?? "").length;
}

/** The physical order's comparator: the float order key, then the row id
 *  (the deterministic tie-break). */
function physicalCompare(a: { orderKey: number; id: string }, b: { orderKey: number; id: string }): number {
  if (a.orderKey !== b.orderKey) return a.orderKey - b.orderKey;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/** The wire stand's deep clone (the JSON round-trip — the reads / the
 *  receipts / the events stand plain copies, never the state's references).
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export { canonicalJson, clone, deepEqual, jsonSizeOf, physicalCompare, tableIdFor };
