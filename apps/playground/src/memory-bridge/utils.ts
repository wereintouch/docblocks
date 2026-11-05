/** The in-memory bridge's pure helpers: the table-id derivation, the
 *  canonical form (the query fingerprint's input), and the physical-order
 *  comparison. */

/** The table id derived from the name (deterministic across the instances). */
function tableIdFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `table-${slug || Math.random().toString(36).slice(2, 8)}`;
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

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
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

export { canonicalJson, deepEqual, physicalCompare, tableIdFor };
