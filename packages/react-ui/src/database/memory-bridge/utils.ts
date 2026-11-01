/** The in-memory bridge's pure helpers: the table-id derivation, the
 *  canonical form (the query fingerprint), the keyset cursor's encoding, and
 *  the physical-order comparison. */
import type { FilterInput, SortInput } from "../bridge";

interface CursorPayload {
  v: number;
  tableId: string;
  /** The snapshot boundary `R` the page was cut at (the envelope `seq`). */
  R: number;
  /** The query fingerprint the page was cut under. */
  fp: string;
  filter: FilterInput | null;
  sort: SortInput | null;
  limit: number;
  /** The last row of the page: the continuation position (exclusive);
   *  null stands the sequence head (the first page was empty). */
  afterOrderKey: number | null;
  afterRowId: string | null;
}

/** The table id derived from the name (deterministic across the instances). */
function tableIdFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `table-${slug || Math.random().toString(36).slice(2, 8)}`;
}

/** FNV-1a over the string, hex-encoded (the fingerprint's stand). */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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
/** The page continuation cursor (the opaque stand: a `v2:`-prefixed JSON
 *  payload). */
function encodeCursor(payload: Omit<CursorPayload, "v">): string {
  return `v2:${encodeURIComponent(JSON.stringify({ v: 2, ...payload }))}`;
}

/** Parses the cursor payload (null = malformed or a foreign `v`); the caller
 *  stands the expiry / fingerprint / boundary checks. */
function decodeCursor(cursor: string): CursorPayload | null {
  if (!cursor.startsWith("v2:")) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(cursor.slice(3)));
    if (typeof parsed !== "object" || parsed === null) return null;
    const payload = parsed as Partial<CursorPayload>;
    if (
      payload.v !== 2 ||
      typeof payload.tableId !== "string" ||
      typeof payload.R !== "number" ||
      typeof payload.fp !== "string" ||
      typeof payload.limit !== "number" ||
      (payload.afterOrderKey !== null && typeof payload.afterOrderKey !== "number") ||
      (payload.afterRowId !== null && typeof payload.afterRowId !== "string")
    ) {
      return null;
    }
    return payload as CursorPayload;
  } catch {
    return null;
  }
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

export { canonicalJson, deepEqual, decodeCursor, encodeCursor, fnv1aHex, physicalCompare, tableIdFor };
