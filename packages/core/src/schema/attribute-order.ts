/**
 * Normalization of the `attributesOrder` (the attribute keys' display
 * order) over a JSON snapshot: a concurrent write of the record and the
 * order (a peer's set / remove against the other's reorder) leaves the
 * order stale — keys dropped from the record or duplicated. This helper
 * rebuilds the order against the record: the stale entries are dropped,
 * the duplicates stand first-occurrence, and the record's keys missing
 * from the order append in the record's key order. A non-array stand is
 * dropped (the validator's strict posture flags it; the lenient load
 * keeps the record's key order's fallback).
 *
 * Pure JSON → JSON (no CRDT); idempotent and byte-stable on a normalized
 * input. Unchanged input shares its object with the caller.
 */
import type { DocJSON } from "./types";
import { isPlainObject } from "./utils";

function attributeOrderNormalized(json: DocJSON): DocJSON {
  if (!("attributesOrder" in json)) return json;
  const attributes = json.attributes;
  const attributeKeys =
    attributes !== undefined && isPlainObject(attributes) ? (Object.keys(attributes) as string[]) : [];
  if (attributeKeys.length === 0) {
    // An order without a record is off (the writer's parity: the field
    // stands only over a non-empty record).
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(json)) {
      if (key !== "attributesOrder") rest[key] = value;
    }
    return rest as unknown as DocJSON;
  }
  if (!Array.isArray(json.attributesOrder)) return json;
  const seen = new Set<string>();
  const order: string[] = [];
  for (const key of json.attributesOrder) {
    if (typeof key !== "string" || !attributeKeys.includes(key) || seen.has(key)) continue;
    seen.add(key);
    order.push(key);
  }
  for (const key of attributeKeys) {
    if (!seen.has(key)) order.push(key);
  }
  const changed =
    json.attributesOrder.length !== order.length || json.attributesOrder.some((key, index) => key !== order[index]);
  return changed ? { ...json, attributesOrder: order } : json;
}

export { attributeOrderNormalized };
