/** The schema's shared helpers: the plain-object check + the block's
 *  effective indent. */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The block's effective indent; absent (or a non-integer, reported by the
 *  attrs spec) is 0. */
function indentOf(block: Record<string, unknown>): number {
  const attrs = isPlainObject(block.attrs) ? block.attrs : undefined;
  const indent = attrs?.indent;
  return typeof indent === "number" && Number.isInteger(indent) ? indent : 0;
}

export { indentOf, isPlainObject };
