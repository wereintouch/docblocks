/**
 * The layout's value writer: the primitive / nested-map / array storage of
 * one attr value (the block's attrs, the opaque block's fields, the geometry
 * subsets all go through it) and the plain-object guard the writers share.
 */
import * as Y from "yjs";

import type { AnyMap } from "./models";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Primitive attr values are stored directly; plain objects become nested Y.Maps, and arrays become Y.Arrays (array elements are stored as-is — the schema keeps them plain). */
function writeAttrValue(target: AnyMap, key: string, value: unknown): void {
  if (value === undefined) return;
  if (isPlainObject(value)) {
    const nested = new Y.Map<unknown>();
    for (const [nestedKey, nestedValue] of Object.entries(value)) writeAttrValue(nested, nestedKey, nestedValue);
    target.set(key, nested);
  } else if (Array.isArray(value)) {
    const array = new Y.Array<unknown>();
    // Clone the elements: a Yjs array holds plain values by reference, so
    // the caller's objects/arrays must not be aliased into the CRDT (a
    // post-call mutation would change the doc outside any transaction).
    for (const element of value) array.push([structuredClone(element)]);
    target.set(key, array);
  } else {
    target.set(key, value);
  }
}

export { isPlainObject, writeAttrValue };
