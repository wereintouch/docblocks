/**
 * The id-keyed dictionaries (the blocks map, the database rows and cells)
 * are plain JS objects in the JSON format. An id that collides with an
 * `Object.prototype` key (or the `__proto__` accessor) does not create an
 * own data key when assigned on a plain object — it reassigns the prototype
 * (or is a no-op), so such an id is silently lost on the JSON round trip.
 *
 * The engine therefore rejects the reserved keys as ids at every input
 * boundary (createDoc, the insert commands, fromJSON) with a clear error, so
 * no id-keyed dictionary ever carries one. The generated ids (the default
 * randomId) never collide; a user-provided explicit id, a custom generateId,
 * or a hand-built JSON document are the only sources of a collision.
 */
const RESERVED_ID_KEYS: ReadonlySet<string> = new Set([...Object.getOwnPropertyNames(Object.prototype), "__proto__"]);

/** True when `id` is one of the Object.prototype-reserved keys (unsafe as an id-keyed-map key). */
function isReservedId(id: string): boolean {
  return RESERVED_ID_KEYS.has(id);
}

export { isReservedId, RESERVED_ID_KEYS };
