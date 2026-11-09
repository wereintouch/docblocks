/**
 * Object.prototype-reserved keys (`__proto__`, `constructor`, and the rest
 * of Object.prototype's own names) must not become data keys of the
 * snapshot's plain objects by an open-ended `target[key] = value`
 * assignment: such a key reassigns the target's prototype (an attacker's
 * object whose getters run on property access) instead of creating a data
 * key, and the JSON export loses the data (the prototype is not
 * serialized). The id-keyed dictionaries already reject these keys
 * outright at the input boundaries (id-safety); the key-open boundaries
 * (the read's snapshot assembly, the command's merge, the mark/attr
 * conversions) stand the key as an OWN property over defineProperty
 * instead — the data survives the round trip neutralized, the prototype
 * stands untouched.
 */
import { RESERVED_ID_KEYS } from "./id-safety";

/**
 * Sets `key` on `target` as an own property. The reserved keys stand the
 * defineProperty stand (the own data key shadows the prototype accessor,
 * no reassignment); the ordinary keys the plain assignment.
 */
function setOwn(target: object, key: string, value: unknown): void {
  if (RESERVED_ID_KEYS.has(key)) {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
    return;
  }
  (target as Record<string, unknown>)[key] = value;
}

export { setOwn };
